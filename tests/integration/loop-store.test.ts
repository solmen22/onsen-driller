// BL-010: 固定ステップのループと store の通知（TS-010-03〜06・10・11・15）。rAF と時計は偽物を注入する
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../src/app/clock.ts';
import { startLoop } from '../../src/app/loop.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState } from '../../src/core/index.ts';

/** 偽の requestAnimationFrame: frame(dt) で時計を進めてから 1 フレーム分のコールバックを呼ぶ */
function harness() {
  const clock = createFakeClock(0, 0);
  const store = new GameStore(createInitialState(1));
  let cb: (() => void) | null = null;
  let steps = 0;
  const origStep = store.step.bind(store);
  store.step = (dt, now) => {
    steps++;
    expect(dt).toBe(100);
    return origStep(dt, now);
  };
  const loop = startLoop(store, clock, {
    raf: (f) => {
      cb = f;
      return 1;
    },
    caf: () => {
      cb = null;
    },
  });
  const frame = (dt: number): void => {
    clock.advance(dt);
    const f = cb;
    cb = null;
    f?.();
  };
  /** 時計を好きな値にしてから 1 フレーム（NaN・逆戻りの試験用） */
  const frameAt = (monoMs: number): void => {
    const c = clock as unknown as { monoNow: () => number };
    const orig = c.monoNow;
    c.monoNow = () => monoMs;
    const f = cb;
    cb = null;
    f?.();
    c.monoNow = orig;
  };
  return { clock, store, loop, frame, frameAt, steps: () => steps, hasFrame: () => cb !== null };
}

describe('TS-010-03 100ms ごとに step', () => {
  it('16.7ms 間隔で 1 秒ぶん → 10 回', () => {
    const h = harness();
    for (let i = 0; i < 60; i++) h.frame(1000 / 60);
    expect(h.steps()).toBe(10);
  });
});

describe('TS-010-04 端数は次のフレームに持ち越す', () => {
  it('99ms → 0 回、次の 1ms → 1 回、100ms → 1 回、250ms → 2 回（50ms 持ち越し）', () => {
    const h = harness();
    h.frame(99);
    expect(h.steps()).toBe(0);
    h.frame(1);
    expect(h.steps()).toBe(1);
    h.frame(100);
    expect(h.steps()).toBe(2);
    h.frame(250);
    expect(h.steps()).toBe(4);
    h.frame(50);
    expect(h.steps()).toBe(5);
  });
});

describe('TS-010-05 1 フレームで追いつくのは最大 1 秒分（超えた分は捨てる。Q-12）', () => {
  it('1,000ms → 10 回、1,001ms・5,000ms → 10 回で、捨てた時間を droppedMs に数える', () => {
    const h = harness();
    h.frame(1000);
    expect(h.steps()).toBe(10);
    h.frame(1001);
    expect(h.steps()).toBe(20);
    expect(h.loop.droppedMs).toBe(1);
    h.frame(5000);
    expect(h.steps()).toBe(30);
    expect(h.loop.droppedMs).toBe(4001);
    h.frame(100); // 捨てた分は次のフレームに回さない
    expect(h.steps()).toBe(31);
  });
});

describe('TS-010-06 時計が戻る・NaN・同じ値', () => {
  it('ステップせず例外にならず、次の正常なフレームから再開する', () => {
    const h = harness();
    h.frame(500);
    expect(h.steps()).toBe(5);
    expect(() => h.frameAt(100)).not.toThrow(); // 戻った
    expect(() => h.frameAt(Number.NaN)).not.toThrow();
    expect(() => h.frameAt(100)).not.toThrow(); // 同じ値
    expect(h.steps()).toBe(5);
    h.frameAt(300); // 戻った基準（100）から 200ms
    expect(h.steps()).toBe(7);
    expect(h.hasFrame()).toBe(true);
  });
});

describe('TS-010-15 止めている間は進めず、再開後に早送りしない', () => {
  it('pause → 2 秒 → resume', () => {
    const h = harness();
    h.frame(300);
    h.loop.pause();
    expect(h.loop.running).toBe(false);
    h.clock.advance(2000);
    expect(h.steps()).toBe(3);
    h.loop.resume();
    h.frame(100);
    expect(h.steps()).toBe(4);
  });
});

describe('TS-010-10 store の通知（200ms ごと・dispatch の直後）', () => {
  it('1 秒で 5 回。dispatch の直後にも 1 回', () => {
    const h = harness();
    let n = 0;
    h.store.subscribe(() => n++);
    h.frame(0.0001); // 通知の基準を決める
    for (let i = 0; i < 60; i++) h.frame(1000 / 60);
    expect(n).toBe(5);
    h.store.dispatch({ type: 'tap' });
    expect(n).toBe(6);
  });
  it('TS-010-11 購読者の 1 つが例外を投げても、もう一方には届き、例外は記録される', () => {
    const errors: unknown[] = [];
    const store = new GameStore(createInitialState(1), { onError: (e) => errors.push(e) });
    let n = 0;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => n++);
    expect(() => store.dispatch({ type: 'tap' })).not.toThrow();
    expect(n).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

describe('store のイベント（テスト用フックの events・描画の列）', () => {
  it('events(limit) は古い順で直近 N 件、描画の列は drain で空になる', () => {
    const store = new GameStore(createInitialState(1));
    store.state.run.drill.level = 100;
    for (let i = 0; i < 8; i++) store.dispatch({ type: 'tap' });
    const all = store.events();
    expect(all.length).toBeGreaterThan(3);
    const last3 = store.events(3);
    expect(last3).toEqual(all.slice(-3));
    const view = store.drainView();
    expect(view.some((e) => e.type === 'Hits')).toBe(true);
    expect(store.drainView()).toEqual([]);
  });
});
