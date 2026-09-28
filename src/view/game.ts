// Phaser.Game を 1 つ作る（arch §14。BL-035）。Phaser の入力・音は使わない（入力は DOM、音は ZzFX）
import Phaser from 'phaser';
import { MineScene, type ViewBridge } from './scenes/mine-scene.ts';

export interface RenderStats {
  /** 表示の倍率（整数。zoomFor） */
  zoom: number;
  /** 地層のタイルのスプライトの数（使い回しているので深さによらない） */
  tileSprites: number;
  /** 生きているパーティクルの数 */
  particles: number;
  /** 表示中の数字のポップの数（20 まで） */
  popups: number;
  /** DOM のレイアウト（app の #app の data-layout） */
  layout: 'landscape' | 'portrait';
}

export interface View {
  readonly game: Phaser.Game;
  readonly scene: MineScene;
  rendererName(): string;
  aliveParticles(): number;
  /** テスト用フックの renderStats()（Q-16） */
  renderStats(): RenderStats;
  /** キャンバス内の要素の画面上の矩形（ビューポートの CSS ピクセル。S1 は 'drill' だけ。ほかは null） */
  rectOf(id: string): { x: number; y: number; w: number; h: number } | null;
  /** テスト用: WebGL のコンテキストを失わせる／戻す */
  loseContext(): boolean;
  restoreContext(): boolean;
}

/** Game の設定（TS-035-02 で中身を確かめられるように分けた） */
export function gameConfig(parent: HTMLElement, scene: Phaser.Scene): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO, // WebGL、だめなら Canvas
    parent,
    backgroundColor: '#1b1420',
    pixelArt: true,
    roundPixels: true,
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 800, height: parent.clientHeight || 450 },
    scene: [scene],
  };
}

export function createView(parent: HTMLElement, bridge: ViewBridge): Promise<View> {
  const scene = new MineScene(bridge);
  const game = new Phaser.Game(gameConfig(parent, scene));
  let loseExt: WEBGL_lose_context | null = null;
  const view: View = {
    game,
    scene,
    rendererName: () => {
      const r = game.renderer;
      if (r instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
        const gl = r.gl;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL';
        return `WebGL(${name})`;
      }
      return 'Canvas';
    },
    aliveParticles: () => scene.aliveParticles(),
    renderStats: () => ({ ...scene.renderStats(), layout: bridge.layout?.() === 'portrait' ? 'portrait' : 'landscape' }),
    rectOf: (id) => {
      if (id !== 'drill') return null;
      const canvas = game.canvas;
      const r = canvas.getBoundingClientRect();
      const scale = game.scale.width > 0 ? r.width / game.scale.width : 1;
      return scene.toolScreenRect({ left: r.left, top: r.top }, scale);
    },
    loseContext: () => {
      const r = game.renderer;
      if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return false;
      loseExt = r.gl.getExtension('WEBGL_lose_context');
      loseExt?.loseContext();
      return !!loseExt;
    },
    restoreContext: () => {
      if (!loseExt) return false;
      loseExt.restoreContext();
      return true;
    },
  };
  return new Promise((resolve) => {
    game.events.once(Phaser.Core.Events.READY, () => resolve(view));
  });
}
