// 採掘シーン（arch §14。BL-035）: 1 枚のキャンバスに地上（上 25%）と地下（下 75%）の 2 層を置き、カメラを分ける。
// - 地上のカメラ: 固定。世界座標 y < 0（地表より上）を映す
// - 地下のカメラ（main）: 道具の先を追う。地表より上は映さない
// - 道具・破片・数字は両方のカメラに映す（地表の境目で道具が切れないように。2 つのカメラの世界の範囲は重ならない）
// 入力は受けない（DOM で受けて core に渡す）。毎フレーム、ストアのイベント列と selectors を読むだけで、状態を書き換えない
import Phaser from 'phaser';
import atlasPng from '../../generated/atlas.png?url';
import atlasJson from '../../generated/atlas.json';
import { bandOfDepth, blockProgress } from '../../core/selectors.ts';
import type { GameState } from '../../core/state.ts';
import type { ViewEvent } from '../../app/store.ts';
import { interpolateDepth, layerRects, projectRect, TILE, tileGridSize, undergroundCenterY, zoomFor } from '../layout.ts';

const T = TILE;
const SURFACE_WORLD_H = 72; // 地上の世界の高さ（画素。これより上は空）
const BAND_TILES = ['tile-topsoil', 'tile-clay', 'tile-sandstone', 'tile-tuff', 'tile-tuff', 'tile-clay'] as const;
const BAND_TINT = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xd8b8c0, 0x6a5a5a] as const;
const CHIP_TINT = [0x8a5a3a, 0x9a4a36, 0xc9a050, 0x77866d, 0xb09098, 0x4a3a3a] as const;
const SHAFT_TINT = 0x3a2a24;
/** ステップの間の補間にかける時間（ms。論理の刻みと同じ） */
const INTERP_MS = 100;

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

export class MineScene extends Phaser.Scene {
  private readonly bridge: ViewBridge;
  private surfaceLayer!: Phaser.GameObjects.Layer;
  private groundLayer!: Phaser.GameObjects.Layer;
  private surfaceCam!: Phaser.Cameras.Scene2D.Camera;
  private tiles: Phaser.GameObjects.Image[][] = [];
  private tool!: Phaser.GameObjects.Image;
  private chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter;
  private stress: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private pops: Phaser.GameObjects.Text[] = [];
  private popIdx = 0;
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
    // 数字のポップ（20 個まで）
    for (let i = 0; i < 20; i++) {
      const t = this.add
        .text(0, 0, '', { fontFamily: 'DotGothic16, monospace', fontSize: '8px', color: '#fff0a8', stroke: '#1b1420', strokeThickness: 2 })
        .setOrigin(0.5)
        .setDepth(9)
        .setVisible(false);
      t.setResolution(4);
      this.pops.push(t);
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
  }

  /** 表示の倍率（ステージの高さから整数。Q-18）と 2 つのカメラのビューポート、タイルの数を決め直す */
  private relayout(force: boolean): void {
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    const zoom = zoomFor(h);
    const key = `${w}x${h}@${zoom}`;
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    this.zoom = zoom;
    const rects = layerRects(h);
    const ug = this.cameras.main;
    ug.setViewport(0, rects.underground.y, w, rects.underground.h).setZoom(zoom);
    this.surfaceCam.setViewport(0, 0, w, rects.surface.h).setZoom(zoom);
    // 地上のカメラは地表（y=0）がビューポートの下端に来るよう固定
    this.surfaceCam.centerOn(0, -rects.surface.h / zoom / 2);
    const viewW = w / zoom;
    const { cols, rows } = tileGridSize(viewW, rects.underground.h / zoom);
    for (const row of this.tiles) for (const im of row) im.destroy();
    this.tiles = [];
    for (let j = 0; j < rows; j++) {
      const row: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < cols; i++) {
        const im = this.add.image(0, 0, 'atlas', 'tile-topsoil').setOrigin(0, 0);
        this.groundLayer.add(im);
        row.push(im);
      }
      this.tiles.push(row);
    }
    this.sky.setSize(viewW + T * 4, SURFACE_WORLD_H).setPosition(0, -SURFACE_WORLD_H / 2);
    this.ground.setSize(viewW + T * 4, 3);
  }

  override update(time: number, _delta: number): void {
    const s = this.bridge.state();
    const depth = s.run.depth;
    const ug = this.cameras.main;
    const viewH = ug.height / ug.zoom;

    // 道具の位置: 深さ＋ブロックの進み具合を、変わった時点から INTERP_MS で線形に補間する（arch §14）
    const target = depth + blockProgress(s);
    if (target !== this.posTo) {
      this.posFrom = this.posShown;
      this.posTo = target;
      this.posAt = time;
    }
    this.posShown = interpolateDepth(this.posFrom, this.posTo, (time - this.posAt) / INTERP_MS);
    const toolY = this.posShown * T;
    const cy = Math.round(undergroundCenterY(toolY, viewH));
    ug.centerOn(0, cy);

    // タイルの並べ直し（見えている行だけ）
    const top = cy - viewH / 2;
    const firstRow = Math.floor(top / T) - 1;
    const cols = this.tiles[0]?.length ?? 0;
    const firstCol = -Math.floor(cols / 2);
    this.tiles.forEach((row, j) => {
      const r = firstRow + j;
      row.forEach((im, i) => {
        const c = firstCol + i;
        if (r < 0) {
          im.setVisible(false);
          return;
        }
        const band = bandOfDepth(r);
        im.setVisible(true).setPosition(c * T - T / 2, r * T).setFrame(BAND_TILES[band] ?? 'tile-tuff');
        if (c === 0 && r < depth) im.setTint(SHAFT_TINT);
        else im.setTint(BAND_TINT[band] ?? 0xffffff);
      });
    });

    // 道具
    const toolFrame = s.run.drill.tool >= 1 ? 'tool-pickaxe' : 'tool-shovel';
    if (this.tool.frame.name !== toolFrame) this.tool.setFrame(toolFrame);
    if (!this.swing) this.tool.setPosition(0, toolY + 2).setAngle(0);

    // イベント → 演出
    const band = bandOfDepth(depth);
    for (const e of this.bridge.drain()) {
      if (e.type === 'Hits') {
        this.hit(toolY, band, e.n);
        if (e.fromTap) this.renderedInputPending = true;
      } else if (e.type === 'BlockBroken') {
        this.pop(e.depth, e.ore !== null);
        if (!this.bridge.reduceMotion) ug.shake(60, 0.004);
      } else if (e.type === 'SpringFound') {
        this.steam.explode(12, 36, -20);
      }
    }
    if (this.bridge.hasPendingInput()) this.renderedInputPending = true;
    if (this.stress) this.stress.setPosition(0, Math.round(toolY));
  }

  private hit(y: number, band: number, n: number): void {
    this.chips.setParticleTint(CHIP_TINT[band] ?? 0xffffff);
    this.chips.explode(Math.min(3 + n * 2, 12), 0, y + 1);
    this.swing?.stop();
    this.tool.setPosition(0, y - 3).setAngle(-18);
    this.swing = this.tweens.add({
      targets: this.tool,
      y: y + 2,
      angle: 0,
      duration: 90,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.swing = null;
      },
    });
  }

  private pop(depth: number, ore: boolean): void {
    const t = this.pops[this.popIdx];
    this.popIdx = (this.popIdx + 1) % this.pops.length;
    if (!t) return;
    t.setText(ore ? 'ORE!' : '+').setPosition(10 + ((depth * 7) % 16), depth * T).setVisible(true).setAlpha(1);
    this.tweens.add({ targets: t, y: depth * T - 18, alpha: 0, duration: 700, onComplete: () => t.setVisible(false) });
  }

  aliveParticles(): number {
    return this.chips.getAliveParticleCount() + this.steam.getAliveParticleCount() + (this.stress?.getAliveParticleCount() ?? 0);
  }

  /** テスト用フックの renderStats() の描画の部分 */
  renderStats(): { zoom: number; tileSprites: number; particles: number; popups: number } {
    return {
      zoom: this.zoom,
      tileSprites: this.tiles.reduce((a, row) => a + row.length, 0),
      particles: this.aliveParticles(),
      popups: this.pops.filter((p) => p.visible).length,
    };
  }

  /** 道具のスプライトの画面上の矩形（ビューポートの CSS ピクセル）。道具の先が地表より上なら地上のカメラで測る */
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
