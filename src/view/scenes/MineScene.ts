// 採掘シーン（arch §14）: 地上（湯船・タヌキ・湯けむり）と地下（地層タイル・道具・破片・数字）を 1 枚のキャンバスに描く。
// 入力は受けない（DOM で受けて core に渡す）。毎フレーム、ストアのイベント列を読んで演出を出すだけ
import Phaser from 'phaser';
import atlasPng from '../../generated/atlas.png?url';
import atlasJson from '../../generated/atlas.json';
import { bandOfDepth, type GameState } from '../../core/index.ts';
import type { ViewEvent } from '../../app/store.ts';

const T = 16; // タイルの大きさ（アートの画素）
const SURFACE_H = 72; // 地上の高さ
const BAND_TILES = ['tile-topsoil', 'tile-clay', 'tile-sandstone', 'tile-tuff', 'tile-tuff', 'tile-clay'] as const;
const BAND_TINT = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xd8b8c0, 0x6a5a5a] as const;
const CHIP_TINT = [0x8a5a3a, 0x9a4a36, 0xc9a050, 0x77866d, 0xb09098, 0x4a3a3a] as const;
const SHAFT_TINT = 0x3a2a24;

export interface ViewBridge {
  state(): Readonly<GameState>;
  drain(): ViewEvent[];
  /** 入力を反映したフレームを描き終えた */
  onInputRendered(now: number): void;
  hasPendingInput(): boolean;
  stressParticles: number;
  reduceMotion: boolean;
  onContext(ev: 'lost' | 'restored'): void;
}

export class MineScene extends Phaser.Scene {
  private readonly bridge: ViewBridge;
  private tiles: Phaser.GameObjects.Image[][] = [];
  private tool!: Phaser.GameObjects.Image;
  private chips!: Phaser.GameObjects.Particles.ParticleEmitter;
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter;
  private stress: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private pops: Phaser.GameObjects.Text[] = [];
  private popIdx = 0;
  private sky!: Phaser.GameObjects.Rectangle;
  private ground!: Phaser.GameObjects.Rectangle;
  private camY = 0;
  private layoutKey = '';
  private swing: Phaser.Tweens.Tween | null = null;
  private renderedInputPending = false;

  constructor(bridge: ViewBridge) {
    super({ key: 'mine' });
    this.bridge = bridge;
  }

  preload(): void {
    this.load.atlas('atlas', atlasPng, atlasJson);
  }

  create(): void {
    this.sky = this.add.rectangle(0, -SURFACE_H / 2, 10, SURFACE_H, 0x9fc7e6).setOrigin(0.5, 0.5).setDepth(-10);
    this.ground = this.add.rectangle(0, -1, 10, 3, 0x5f8f3a).setDepth(-5);
    // 地上: 湯船・タヌキ・湯けむり
    // 縦画面（幅 130 画素ほど）にも収まるように、タヌキは縦穴の左、湯船は右に置く
    this.add.image(36, -12, 'atlas', 'bath-tub').setDepth(2);
    this.add.image(-24, -12, 'atlas', 'guest-tanuki').setDepth(3);
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
    this.steam.setDepth(4);
    // 道具
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
  }

  /** 表示の倍率（ステージの高さから整数を選ぶ）とタイルの数を決め直す */
  private relayout(force: boolean): void {
    const w = this.scale.gameSize.width;
    const h = this.scale.gameSize.height;
    const zoom = h >= 560 ? 4 : h >= 260 ? 3 : 2;
    const key = `${w}x${h}@${zoom}`;
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    const cam = this.cameras.main;
    cam.setZoom(zoom);
    const viewW = w / zoom;
    const viewH = h / zoom;
    const cols = Math.ceil(viewW / T) + 3;
    const rows = Math.ceil(viewH / T) + 3;
    for (const row of this.tiles) for (const im of row) im.destroy();
    this.tiles = [];
    for (let j = 0; j < rows; j++) {
      const row: Phaser.GameObjects.Image[] = [];
      for (let i = 0; i < cols; i++) row.push(this.add.image(0, 0, 'atlas', 'tile-topsoil').setOrigin(0, 0).setDepth(0));
      this.tiles.push(row);
    }
    this.sky.setSize(viewW + T * 4, SURFACE_H).setPosition(0, -SURFACE_H / 2);
    this.ground.setSize(viewW + T * 4, 3);
    this.stress?.setPosition(0, 0);
  }

  override update(_time: number, delta: number): void {
    const s = this.bridge.state();
    const depth = s.run.depth;
    const cam = this.cameras.main;
    const viewH = cam.height / cam.zoom;
    const viewW = cam.width / cam.zoom;

    // カメラ: 掘っているブロックを画面の 60% の高さに置く。浅いうちは地上が見える
    const target = Math.max(depth * T + T / 2 - 0.1 * viewH, -SURFACE_H + viewH / 2 - 8);
    this.camY += (target - this.camY) * Math.min(1, delta / 120);
    cam.centerOn(0, Math.round(this.camY));

    // タイルの並べ直し（見えている行だけ）
    const top = this.camY - viewH / 2;
    const firstRow = Math.floor(top / T) - 1;
    const firstCol = -Math.floor(this.tiles[0]?.length ?? 0) / 2;
    this.tiles.forEach((row, j) => {
      const r = firstRow + j;
      row.forEach((im, i) => {
        const c = Math.floor(firstCol) + i;
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
    if (!this.swing) this.tool.setPosition(0, depth * T + 2).setAngle(0);

    // イベント → 演出
    const band = bandOfDepth(depth);
    for (const e of this.bridge.drain()) {
      if (e.type === 'Hits') {
        this.hit(depth, band, e.n);
        if (e.fromTap) this.renderedInputPending = true;
      } else if (e.type === 'BlockBroken') {
        this.pop(e.depth, e.ore);
        if (!this.bridge.reduceMotion) cam.shake(60, 0.004);
      } else if (e.type === 'SpringFound') {
        this.steam.explode(12, 36, -20);
      }
    }
    if (this.bridge.hasPendingInput()) this.renderedInputPending = true;
    if (this.stress) this.stress.setPosition(0, Math.round(this.camY));
    this.sky.width = viewW + T * 4;
  }

  private hit(depth: number, band: number, n: number): void {
    const y = depth * T;
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
}
