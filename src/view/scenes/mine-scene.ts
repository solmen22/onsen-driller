// 採掘シーン（arch §14。BL-035・BL-036）: 1 枚のキャンバスに地上（上 25%）と地下（下 75%）の 2 層を置き、カメラを分ける。
// - 地上のカメラ: 固定。世界座標 y < 0（地表より上）を映す
// - 地下のカメラ（main）: 道具の先を追う（上から 30%。下の 70% に「これから掘るところ」を見せる）。地表より上は映さない
// - 道具・破片・数字は両方のカメラに映す（地表の境目で道具が切れないように。2 つのカメラの世界の範囲は重ならない）
// - 地下: 地層タイル（帯ごとに 4 種の変化形）・飾り・縦穴の先の鉱石のきらめき・次の源泉の気配・ひび 4 段・数字のポップ（20 まで）
// 入力は受けない（DOM で受けて core に渡す）。毎フレーム、ストアのイベント列と selectors を読むだけで、状態を書き換えない
import Phaser from 'phaser';
import atlasPng from '../../generated/atlas.png?url';
import atlasJson from '../../generated/atlas.json';
import { ORE_BY_ID } from '../../content/ores.ts';
import { STRATA } from '../../content/strata.ts';
import { bandOfDepth, blockProgress, oreAt } from '../../core/selectors.ts';
import type { GameState } from '../../core/state.ts';
import type { ViewEvent } from '../../app/store.ts';
import { t } from '../../i18n/index.ts';
import { CrackTracker, crackFrame } from '../cracks.ts';
import { interpolateDepth, layerRects, projectRect, TILE, tileGridSize, undergroundCenterY, zoomFor } from '../layout.ts';
import { mergeBreaks, POPUP_MAX, POPUP_TTL_MS, PopupQueue, popupText, type BreakPop } from '../popups.ts';
import { decoAt, glintAlpha, nextSpringHint, ORE_TINT, SPRING_BUBBLE_ROWS, tileFrame, tileVariant } from '../strata-look.ts';
import { TilePool, type CellLook } from '../tile-pool.ts';
import { applyToolTexture, toolSwings } from '../tools.ts';

const T = TILE;
const SURFACE_WORLD_H = 72; // 地上の世界の高さ（画素。これより上は空）
const CHIP_TINT = [0x8a5a3a, 0x9a4a36, 0xc9a050, 0x77866d, 0xa7b8c6, 0x525b68] as const;
/** 掘り終えた縦穴のタイルの色 */
const SHAFT_TINT = 0x3a2a24;
/** ステップの間の補間にかける時間（ms。論理の刻みと同じ） */
const INTERP_MS = 100;
/** 帯の名前のカード（仮。本実装は S3 の BL-041）を出す時間 */
const CARD_MS = 1500;
const POP_STYLE = { fontFamily: 'DotGothic16, monospace', fontSize: '8px', color: '#fff0a8', stroke: '#1b1420', strokeThickness: 2 };

export interface ViewBridge {
  state(): Readonly<GameState>;
  drain(): ViewEvent[];
  /** 入力を反映したフレームを描き終えた */
  onInputRendered(now: number): void;
  hasPendingInput(): boolean;
  stressParticles: number;
  reduceMotion: boolean;
  onContext(ev: 'lost' | 'restored'): void;
  /** DOM のレイアウト（renderStats 用） */
  layout?(): string | undefined;
}

type Img = Phaser.GameObjects.Image;

export class MineScene extends Phaser.Scene {
  private readonly bridge: ViewBridge;
  private surfaceLayer!: Phaser.GameObjects.Layer;
  private groundLayer!: Phaser.GameObjects.Layer;
  private surfaceCam!: Phaser.Cameras.Scene2D.Camera;
  private tiles!: TilePool<Img>;
  private decos!: TilePool<Img>;
  /** 縦穴（0 列目）の先の鉱石のきらめき・源泉の気配 */
  private shaftMarks!: TilePool<Img>;
  private crack!: Img;
  private readonly cracks = new CrackTracker();
  private tool!: Img;
  private chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 次の源泉が近いときに下から立ち上る泡（源泉の気配） */
  private bubbles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private stress: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private readonly popQueue = new PopupQueue<BreakPop>(POPUP_MAX, POPUP_TTL_MS);
  private pops: Phaser.GameObjects.Text[] = [];
  private popTweens: (Phaser.Tweens.Tween | null)[] = [];
  private card!: Phaser.GameObjects.Text;
  private cardUntil = 0;
  private sky!: Phaser.GameObjects.Rectangle;
  private ground!: Phaser.GameObjects.Rectangle;
  private zoom = 3;
  private layoutKey = '';
  private swing: Phaser.Tweens.Tween | null = null;
  private renderedInputPending = false;
  /** 道具の位置（深さ＋ブロックの進み具合）の補間: 前の値・次の値・切り替えた時刻 */
  private posFrom = 0;
  private posTo = 0;
  private posAt = 0;
  private posShown = 0;

  constructor(bridge: ViewBridge) {
    super({ key: 'mine' });
    this.bridge = bridge;
  }

  preload(): void {
    this.load.atlas('atlas', atlasPng, atlasJson);
  }

  create(): void {
    this.surfaceLayer = this.add.layer().setDepth(-10);
    this.groundLayer = this.add.layer().setDepth(0);
    // 地上: 空・地面・湯船・タヌキ・湯けむり（縦画面の幅 130 画素ほどにも収まるよう、タヌキは縦穴の左、湯船は右）
    this.sky = this.add.rectangle(0, -SURFACE_WORLD_H / 2, 10, SURFACE_WORLD_H, 0x9fc7e6);
    this.ground = this.add.rectangle(0, -1, 10, 3, 0x5f8f3a);
    this.steam = this.add.particles(0, 0, 'atlas', {
      frame: 'p-steam',
      x: { min: 22, max: 50 },
      y: -20,
      lifespan: 1800,
      speedY: { min: -14, max: -7 },
      speedX: { min: -3, max: 3 },
      alpha: { start: 0.8, end: 0 },
      scale: { start: 1, end: 2 },
      frequency: 220,
      maxAliveParticles: 20,
    });
    this.surfaceLayer.add([
      this.sky,
      this.ground,
      this.add.image(36, -12, 'atlas', 'bath-tub').setDepth(2),
      this.add.image(-24, -12, 'atlas', 'guest-tanuki').setDepth(3),
      this.steam.setDepth(4),
    ]);
    // 地下: 地層タイル → 飾り → 縦穴の目印 → ひび の順に重ねる
    const pooled = (depth: number) => (): Img => {
      const im = this.add.image(0, 0, 'atlas', 'tile-topsoil-0').setOrigin(0, 0).setDepth(depth).setVisible(false);
      this.groundLayer.add(im);
      return im;
    };
    this.tiles = new TilePool(pooled(0));
    this.decos = new TilePool(pooled(1));
    this.shaftMarks = new TilePool(pooled(2));
    this.crack = this.add.image(0, 0, 'atlas', 'crack-1').setOrigin(0, 0).setDepth(3).setVisible(false);
    this.card = this.add
      .text(0, 0, '', { ...POP_STYLE, fontSize: '10px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);
    this.card.setResolution(4);
    this.bubbles = this.add.particles(0, 0, 'atlas', {
      frame: 'p-steam',
      x: { min: -6, max: 6 },
      lifespan: 1600,
      speedY: { min: -26, max: -14 },
      speedX: { min: -4, max: 4 },
      scale: { start: 0.35, end: 0.7 },
      alpha: { start: 0.7, end: 0 },
      tint: 0x9ae0dc,
      frequency: 260,
      maxAliveParticles: 12,
      emitting: false,
    });
    this.groundLayer.add([this.crack, this.card, this.bubbles.setDepth(4)]);
    // 道具（両方のカメラに映す）
    this.tool = this.add.image(0, 0, 'atlas', 'tool-shovel').setDepth(6).setOrigin(0.5, 0.9);
    // 破片
    this.chips = this.add.particles(0, 0, 'atlas', {
      frame: 'p-chip',
      lifespan: 650,
      speed: { min: 40, max: 120 },
      angle: { min: 200, max: 340 },
      gravityY: 320,
      emitting: false,
      maxAliveParticles: 150,
    });
    this.chips.setDepth(7);
    // 数字のポップ（20 個まで。PopupQueue の枠の番号と同じ添字のテキストを使う）
    for (let i = 0; i < POPUP_MAX; i++) {
      const tx = this.add.text(0, 0, '', POP_STYLE).setOrigin(0.5).setDepth(9).setVisible(false);
      tx.setResolution(4);
      this.pops.push(tx);
      this.popTweens.push(null);
    }
    // 負荷試験用（?particles=N）: N 個が常に生きている状態を作る
    const n = this.bridge.stressParticles;
    if (n > 0) {
      this.stress = this.add.particles(0, 0, 'atlas', {
        frame: ['p-spark', 'p-coin', 'p-chip', 'p-steam'],
        lifespan: 1000,
        frequency: 1000 / n,
        quantity: 1,
        maxAliveParticles: n,
        speed: { min: 10, max: 60 },
        gravityY: 40,
        alpha: { start: 1, end: 0.2 },
        emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-80, -40, 160, 80), quantity: n },
      });
      this.stress.setDepth(8);
    }
    // カメラ: main は地下、地上は追加のカメラ。互いの層を映さない
    this.surfaceCam = this.cameras.add(0, 0, 10, 10, false, 'surface');
    this.surfaceCam.ignore(this.groundLayer);
    this.cameras.main.ignore(this.surfaceLayer);

    this.game.events.on(Phaser.Core.Events.POST_RENDER, () => {
      if (this.renderedInputPending) {
        this.renderedInputPending = false;
        this.bridge.onInputRendered(performance.now());
      }
    });
    const r = this.game.renderer;
    if (r instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      r.on(Phaser.Renderer.Events.LOSE_WEBGL, () => this.bridge.onContext('lost'));
      r.on(Phaser.Renderer.Events.RESTORE_WEBGL, () => this.bridge.onContext('restored'));
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.relayout(true));
    this.relayout(true);
    const s = this.bridge.state();
    this.posFrom = this.posTo = this.posShown = s.run.depth + blockProgress(s);
    applyToolTexture(this.tool, s.run.drill.tool);
  }

  /** 表示の倍率（ステージの高さから整数。Q-18）と 2 つのカメラのビューポート、見える分のタイルの数を決め直す */
  private relayout(force: boolean): void {
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    const zoom = zoomFor(h);
    const key = `${w}x${h}@${zoom}`;
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    this.zoom = zoom;
    const rects = layerRects(h);
    this.cameras.main.setViewport(0, rects.underground.y, w, rects.underground.h).setZoom(zoom);
    this.surfaceCam.setViewport(0, 0, w, rects.surface.h).setZoom(zoom);
    // 地上のカメラは地表（y=0）がビューポートの下端に来るよう固定
    this.surfaceCam.centerOn(0, -rects.surface.h / zoom / 2);
    const viewW = w / zoom;
    const { cols, rows } = tileGridSize(viewW, rects.underground.h / zoom);
    this.tiles.resize(cols, rows);
    this.decos.resize(cols, rows);
    this.shaftMarks.resize(1, rows);
    this.sky.setSize(viewW + T * 4, SURFACE_WORLD_H).setPosition(0, -SURFACE_WORLD_H / 2);
    this.ground.setSize(viewW + T * 4, 3);
  }

  override update(time: number, _delta: number): void {
    const s = this.bridge.state();
    const depth = s.run.depth;
    const seed = s.run.seed;
    const ug = this.cameras.main;
    const viewH = ug.height / ug.zoom;

    // 道具の位置: 深さ＋ブロックの進み具合を、変わった時点から INTERP_MS で線形に補間する（arch §14）
    const progress = blockProgress(s);
    const target = depth + progress;
    if (target !== this.posTo) {
      this.posFrom = this.posShown;
      this.posTo = target;
      this.posAt = time;
    }
    this.posShown = interpolateDepth(this.posFrom, this.posTo, (time - this.posAt) / INTERP_MS);
    const toolY = this.posShown * T;
    const cy = Math.round(undergroundCenterY(toolY, viewH));
    ug.centerOn(0, cy);

    // 見えている行だけを並べ直す（スプライトは使い回し）
    const firstRow = Math.floor((cy - viewH / 2) / T) - 1;
    const firstCol = -Math.floor(this.tiles.cols / 2);
    this.tiles.layout(firstRow, firstCol, T, -T / 2, (row, col): CellLook | null => {
      if (row < 0) return null;
      const band = bandOfDepth(row);
      return { frame: tileFrame(band, tileVariant(seed, row, col)), tint: col === 0 && row < depth ? SHAFT_TINT : 0xffffff };
    });
    this.decos.layout(firstRow, firstCol, T, -T / 2, (row, col): CellLook | null => {
      if (row < 0 || (col === 0 && row < depth)) return null;
      const f = decoAt(seed, row, col, bandOfDepth(row));
      return f ? { frame: f } : null;
    });
    // 縦穴のこれから掘るところ: 鉱石のきらめき（種類ごとの色）と、次の源泉の気配
    const hint = nextSpringHint((id) => s.run.springs[id] !== undefined);
    this.shaftMarks.layout(firstRow, 0, T, -T / 2, (row): CellLook | null => {
      if (row < depth) return null;
      const ore = oreAt(s, row);
      if (ore) return { frame: 'ore-gem', tint: ORE_TINT[ore], alpha: Math.round(glintAlpha(time, row) * 8) / 8 };
      if (hint && row === hint.depth) return { frame: 'spring-hint', alpha: Math.round(glintAlpha(time * 0.5, row) * 8) / 8 };
      return null;
    });
    // 源泉の気配: 次の源泉が近づいたら、源泉（か画面の下端）から泡を立ち上らせる
    const near = hint !== null && hint.depth - depth <= SPRING_BUBBLE_ROWS && hint.depth >= depth;
    if (near && hint) {
      this.bubbles.setPosition(0, Math.min(hint.depth * T + T / 2, cy + viewH / 2));
      if (!this.bubbles.emitting) this.bubbles.start();
    } else if (this.bubbles.emitting) this.bubbles.stop();
    // ひび（同じブロックの間は段を下げない。Q-19）
    const cf = crackFrame(this.cracks.update(depth, progress));
    if (cf) this.crack.setFrame(cf).setPosition(-T / 2, depth * T).setVisible(true);
    else this.crack.setVisible(false);

    // 道具（段ごとの見た目。ToolEvolved でも差し替わる）
    const tool = s.run.drill.tool;
    applyToolTexture(this.tool, tool);
    if (!this.swing) this.tool.setPosition(0, toolY + 2).setAngle(0);

    // イベント → 演出
    const band = bandOfDepth(depth);
    const breaks: BreakPop[] = [];
    for (const e of this.bridge.drain()) {
      if (e.type === 'Hits') {
        this.hit(toolY, band, e.n, tool);
        if (e.fromTap) this.renderedInputPending = true;
      } else if (e.type === 'BlockBroken') {
        breaks.push({ depth: e.depth, coins: e.coins, ore: e.ore, count: 1 });
      } else if (e.type === 'SpringFound') {
        this.steam.explode(12, 36, -20);
      } else if (e.type === 'ToolEvolved') {
        applyToolTexture(this.tool, e.tool);
      } else if (e.type === 'StratumEntered') {
        const b = STRATA[e.band];
        if (b) this.showCard(t(b.nameKey), time);
      }
    }
    if (breaks.length > 0) {
      this.pop(breaks, time);
      if (!this.bridge.reduceMotion) ug.shake(60, 0.004);
    }
    for (const i of this.popQueue.expire(time)) this.pops[i]?.setVisible(false);
    if (this.card.visible) {
      this.card.setPosition(0, cy + viewH * 0.12); // 道具（上から 30%）より下、画面の中ほど
      if (time >= this.cardUntil) this.card.setVisible(false);
      else this.card.setAlpha(Math.min(1, (this.cardUntil - time) / 300));
    }
    if (this.bridge.hasPendingInput()) this.renderedInputPending = true;
    if (this.stress) this.stress.setPosition(0, Math.round(toolY));
  }

  private showCard(text: string, now: number): void {
    this.card.setText(text).setVisible(true).setAlpha(1);
    this.cardUntil = now + CARD_MS;
  }

  private hit(y: number, band: number, n: number, tool: number): void {
    this.chips.setParticleTint(CHIP_TINT[band] ?? 0xffffff);
    this.chips.explode(Math.min(3 + n * 2, 12), 0, y + 1);
    this.swing?.stop();
    // スコップ・ツルハシ・やぐらは振り下ろす。ドリルは縦に震わせる
    const swings = toolSwings(tool);
    this.tool.setPosition(0, y - 3).setAngle(swings ? -18 : 0);
    this.swing = this.tweens.add({
      targets: this.tool,
      y: y + 2,
      angle: 0,
      duration: swings ? 90 : 50,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.swing = null;
      },
    });
  }

  /** このフレームに壊れたブロックの数字（4 個以上はまとめて 1 つ。20 を超えたら最も古いものを使い回す。Q-19） */
  private pop(breaks: BreakPop[], now: number): void {
    for (const { slot, item } of this.popQueue.addFrame(breaks, now, mergeBreaks)) {
      const tx = this.pops[slot];
      if (!tx) continue;
      this.popTweens[slot]?.stop();
      const oreName = item.ore ? t(ORE_BY_ID[item.ore as keyof typeof ORE_BY_ID].nameKey) : null;
      const y = item.depth * T;
      tx.setText(popupText(item, oreName))
        .setColor(item.ore ? '#9ae0dc' : '#fff0a8')
        .setPosition(10 + ((item.depth * 7) % 16), y)
        .setVisible(true)
        .setAlpha(1);
      this.popTweens[slot] = this.tweens.add({ targets: tx, y: y - 18, alpha: 0, duration: POPUP_TTL_MS });
    }
  }

  aliveParticles(): number {
    return (
      this.chips.getAliveParticleCount() +
      this.steam.getAliveParticleCount() +
      this.bubbles.getAliveParticleCount() +
      (this.stress?.getAliveParticleCount() ?? 0)
    );
  }

  /** テスト用フックの renderStats() の描画の部分 */
  renderStats(): { zoom: number; tileSprites: number; particles: number; popups: number } {
    return { zoom: this.zoom, tileSprites: this.tiles.size, particles: this.aliveParticles(), popups: this.popQueue.active };
  }

  /** 道具のスプライトの画面上の矩形（ビューポートの CSS ピクセル）。道具が地表より上なら地上のカメラで測る */
  toolScreenRect(canvasRect: { left: number; top: number }, scale: number): { x: number; y: number; w: number; h: number } | null {
    if (!this.tool.visible) return null;
    const b = this.tool.getBounds();
    const ug = this.cameras.main;
    const cam = b.bottom <= ug.worldView.y ? this.surfaceCam : ug;
    return projectRect(
      { x: b.x, y: b.y, w: b.width, h: b.height },
      { x: cam.x, y: cam.y, worldX: cam.worldView.x, worldY: cam.worldView.y, zoom: cam.zoom },
      canvasRect,
      scale,
    );
  }
}
