// BL-017: 初来訪の時刻を app が図鑑に入れる（TS-017-11。arch §6-1: core は 0 を入れ、app が壁時計で埋める）
import { describe, expect, it } from 'vitest';
import { createAppClock, type Clock } from '../../src/app/clock.ts';
import { startLoop } from '../../src/app/loop.ts';
import { GameStore } from '../../src/app/store.ts';
import { applyGrant, createInitialState } from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

/** 手で進める時計（壁時計 T0 から始まる） */
function fakeClock(t0: number): Clock & { mono: number; wall: number } {
  const c = { mono: 0, wall: t0, wallNow: () => c.wall, monoNow: () => c.mono };
  return c;
}

const T = 1_790_000_000_000;

describe('TS-017-11 初来訪の時刻（store＋偽の時計）', () => {
  it('ループが時計をつないだ store では、タヌキの初来訪で guestsSeen.tanuki が壁時計 T になる。2 回目の来訪では書き換わらない', () => {
    const clock = fakeClock(T);
    const s = stateWith({ bath: 0, pumps: { simple: 1 } });
    s.run.bath.slots = [null];
    s.run.guests = [];
    s.collection.guestsSeen = {};
    const store = new GameStore(s);
    const loop = startLoop(store, clock, { autoStart: false, raf: () => 0, caf: () => {} });
    store.dispatch({ type: 'assignSlot', slot: 0, spring: 'simple' });
    expect(store.state.collection.guestsSeen).toEqual({ tanuki: T });
    clock.wall = T + 60_000;
    store.dispatch({ type: 'assignSlot', slot: 0, spring: null });
    store.dispatch({ type: 'assignSlot', slot: 0, spring: 'simple' });
    expect(store.state.collection.guestsSeen).toEqual({ tanuki: T });
    loop.pause();
  });

  it('テスト用フックの setClock（app の時計の差し替え）の時刻が入る。grant で源泉を見つけたとき（pushEvents）も入る', () => {
    const app = createAppClock(fakeClock(1));
    app.setWall(T + 5);
    const store = new GameStore(createInitialState(3));
    startLoop(store, app, { autoStart: false, raf: () => 0, caf: () => {} });
    const evs = applyGrant(store.state, { depth: 30 });
    store.pushEvents(evs);
    expect(evs).toContainEqual({ type: 'GuestArrived', guest: 'tanuki', first: true });
    expect(store.state.collection.guestsSeen.tanuki).toBe(T + 5);
  });

  it('時計がつながっていない store（ループなし）では 0（時刻不明）のまま。例外は出ない', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 1 } });
    s.run.bath.slots = [null];
    s.run.guests = [];
    s.collection.guestsSeen = {};
    const store = new GameStore(s);
    expect(() => store.dispatch({ type: 'assignSlot', slot: 0, spring: 'simple' })).not.toThrow();
    expect(store.state.collection.guestsSeen).toEqual({ tanuki: 0 });
  });
});
