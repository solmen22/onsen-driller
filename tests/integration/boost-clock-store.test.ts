// BL-124（BL-120 の結線）: app の store が、ステップ・アクションのたびに R2 の休みの残りを 15 分以下に切り詰める
// （app/store.ts の pushEvents。stampGuestsSeen と同じ所）。遊んでいる最中に時計が戻っても、15 分で使える
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/app/clock.ts';
import { startLoop } from '../../src/app/loop.ts';
import { GameStore } from '../../src/app/store.ts';
import { PARAMS } from '../../src/content/params.ts';
import { boostView, stateHash } from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const CD = PARAMS.boost.cooldownMs;
const T0 = 1_800_000_000_000;

/** 手で進める時計 */
function fakeClock(t0: number): Clock & { mono: number; wall: number } {
  const c = { mono: 0, wall: t0, wallNow: () => c.wall, monoNow: () => c.mono };
  return c;
}

/** T0 に R2 を使い、効果が終わった store（休みだけが残る） */
function usedStore(clock?: Clock & { wall: number }): GameStore {
  const store = new GameStore(stateWith({ depth: 10 }));
  if (clock) startLoop(store, clock, { autoStart: false, raf: () => 0, caf: () => {} });
  expect(store.dispatch({ type: 'useBoost', source: 'ad', wallMs: T0 }).ok).toBe(true);
  store.advance(PARAMS.boost.durationMs);
  return store;
}

describe('BL-124 store の結線: 毎ステップ normalizeBoostClock を呼ぶ', () => {
  it('時計が 1 日戻った後の最初のステップで、保存の値を「今 + 15 分」に切り詰める', () => {
    const clock = fakeClock(T0);
    const store = usedStore(clock);
    expect(store.state.run.boost.readyAtWallMs).toBe(T0 + CD);
    clock.wall = T0 - DAY;
    store.step(PARAMS.stepMs);
    expect(store.state.run.boost.readyAtWallMs).toBe(T0 - DAY + CD);
  });

  it('遊んでいる最中に時計が 1 日戻っても、ステップを重ねると 15 分後に使える（表示は 15 分から減る）', () => {
    const clock = fakeClock(T0 + 2 * MIN);
    const store = usedStore(clock);
    clock.wall -= DAY;
    const backAt = clock.wall;
    store.step(PARAMS.stepMs);
    expect(boostView(store.state, clock.wall).cooldownLeftMs).toBe(CD);
    while (clock.wall < backAt + CD) {
      clock.wall += 1000;
      store.step(PARAMS.stepMs);
    }
    expect(boostView(store.state, clock.wall)).toMatchObject({ canUse: true, cooldownLeftMs: 0 });
    expect(store.dispatch({ type: 'useBoost', source: 'ad', wallMs: clock.wall }).ok).toBe(true);
  });

  it('アクション（dispatch）の後でも切り詰める（休み中に R2 を押して失敗したときも）', () => {
    const clock = fakeClock(T0);
    const store = usedStore(clock);
    clock.wall = T0 - DAY;
    expect(store.dispatch({ type: 'useBoost', source: 'ad', wallMs: clock.wall })).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(store.state.run.boost.readyAtWallMs).toBe(T0 - DAY + CD);
  });

  it('時計が戻っていなければ何も変えない（休みの途中・ちょうど 15 分）', () => {
    const clock = fakeClock(T0);
    const store = usedStore(clock);
    const h = stateHash(store.state);
    store.pushEvents([]); // ちょうど 15 分
    clock.wall = T0 + 5 * MIN;
    store.pushEvents([]); // 休みの途中
    expect(stateHash(store.state)).toBe(h);
    expect(store.state.run.boost.readyAtWallMs).toBe(T0 + CD);
  });

  it('壁時計がつながっていない store（テストの直の利用）では呼ばない（図鑑の時刻と同じ扱い）', () => {
    const store = usedStore();
    store.step(PARAMS.stepMs);
    expect(store.state.run.boost.readyAtWallMs).toBe(T0 + CD);
  });
});
