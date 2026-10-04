// @vitest-environment jsdom
// BL-035 TS-035-02（BL-089 の棚卸し traceability §6-3）: view/game.ts の gameConfig() が Phaser の設定を arch §14 のとおりに返す。
// Phaser は読み込みの時点でキャンバスの 2D の機能を調べる（CanvasFeatures）が、jsdom にはキャンバスの描画がないので、
// getContext('2d') を何もしない偽物に差し替えてから読み込む（設定の値を読むだけで、描画はしない）。
import type Phaser from 'phaser';
import { beforeAll, describe, expect, it } from 'vitest';

type GameConfigFn = typeof import('../../src/view/game.ts').gameConfig;

/** 実行時の Phaser（getContext を差し替えた後に読み込む。型は上の import type） */
let P: typeof Phaser;
let gameConfig: GameConfigFn;

/** 何を呼んでも何もしない 2D のコンテキスト（getImageData などは形だけ返す） */
function fake2d(): unknown {
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'getImageData' || k === 'createImageData')
        return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h });
      if (k === 'measureText') return () => ({ width: 0 });
      return () => undefined;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    return type === '2d' ? fake2d() : null;
  } as typeof HTMLCanvasElement.prototype.getContext;
  P = (await import('phaser')).default;
  ({ gameConfig } = await import('../../src/view/game.ts'));
});

describe('TS-035-02 gameConfig()（arch §14）', () => {
  it('type: AUTO（WebGL、だめなら Canvas）・pixelArt・roundPixels・scale.mode: RESIZE', () => {
    // 比べる定数が本当にある（undefined 同士の一致で通らない）
    expect([P.AUTO, P.WEBGL, P.CANVAS].every((v) => typeof v === 'number')).toBe(true);
    expect(typeof P.Scale.RESIZE).toBe('number');
    const parent = document.createElement('div');
    const scene = {} as Phaser.Scene;
    const cfg = gameConfig(parent, scene);
    expect(cfg.type).toBe(P.AUTO);
    expect(cfg.type).not.toBe(P.WEBGL);
    expect(cfg.type).not.toBe(P.CANVAS);
    expect(cfg.pixelArt).toBe(true);
    expect(cfg.roundPixels).toBe(true);
    const scale = cfg.scale as Phaser.Types.Core.ScaleConfig;
    expect(scale.mode).toBe(P.Scale.RESIZE);
    expect(scale.mode).not.toBe(P.Scale.FIT);
    // 渡した親と場面をそのまま使う
    expect(cfg.parent).toBe(parent);
    expect(cfg.scene).toHaveLength(1);
    expect((cfg.scene as unknown[])[0]).toBe(scene);
  });
});
