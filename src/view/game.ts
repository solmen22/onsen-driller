// Phaser.Game を 1 つ作る（arch §14）。Phaser の入力・音は使わない
import Phaser from 'phaser';
import { MineScene, type ViewBridge } from './scenes/mine-scene.ts';

export interface View {
  readonly game: Phaser.Game;
  readonly scene: MineScene;
  rendererName(): string;
  aliveParticles(): number;
  /** テスト用: WebGL のコンテキストを失わせる／戻す */
  loseContext(): boolean;
  restoreContext(): boolean;
}

export function createView(parent: HTMLElement, bridge: ViewBridge): Promise<View> {
  const scene = new MineScene(bridge);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
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
  });
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
