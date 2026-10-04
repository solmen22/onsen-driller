// BL-114: ステージの大きさが変わるたびに ScaleManager を測り直して描き直す（view/parent-size.ts の watchParentSize。view/game.ts が使う）
import { describe, expect, it } from 'vitest';
import { watchParentSize, type ParentScale, type ResizeObserverFactory } from '../../src/view/parent-size.ts';

function fakes(): { calls: string[]; scale: ParentScale; factory: ResizeObserverFactory; fire: () => void; observed: unknown[] } {
  const calls: string[] = [];
  const observed: unknown[] = [];
  let cb: (() => void) | null = null;
  const scale = {
    getParentBounds: () => {
      calls.push('getParentBounds');
      return false; // バグの状態: parentSize はもう新しい値で「差がない」と答える
    },
    refresh: () => {
      calls.push('refresh');
      return scale;
    },
  } as unknown as ParentScale;
  const factory: ResizeObserverFactory = (f) => {
    cb = f;
    return {
      observe: (el) => void observed.push(el),
      disconnect: () => {
        calls.push('disconnect');
        cb = null;
      },
    };
  };
  return { calls, scale, factory, fire: () => cb?.(), observed };
}

describe('BL-114 watchParentSize', () => {
  it('ステージを観察し、大きさが変わるたびに getParentBounds → refresh の順に呼ぶ（getParentBounds が「差がない」と答えても refresh する）', () => {
    const f = fakes();
    const parent = { id: 'stage' } as unknown as Element;
    watchParentSize(parent, f.scale, f.factory);
    expect(f.observed).toEqual([parent]);
    f.fire();
    f.fire();
    expect(f.calls).toEqual(['getParentBounds', 'refresh', 'getParentBounds', 'refresh']);
  });

  it('止める関数で観察をやめ、その後は描き直さない', () => {
    const f = fakes();
    const stop = watchParentSize({} as Element, f.scale, f.factory);
    stop();
    f.fire();
    expect(f.calls).toEqual(['disconnect']);
  });
});
