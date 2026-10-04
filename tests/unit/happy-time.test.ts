// BL-057: CrazyGames の happytime を送る場面（app/happy-time.ts）と、ストアのドメインイベントの購読（store.onEvents）
import { describe, expect, it } from 'vitest';
import { isHappyMoment } from '../../src/app/happy-time.ts';
import { GameStore } from '../../src/app/store.ts';
import { applyGrant, createInitialState, type GameEvent, type GameState } from '../../src/core/index.ts';

const withSprings = (...ids: GameState['collection']['springsSeen']): GameState => {
  const s = createInitialState(1);
  s.collection.springsSeen = [...ids];
  return s;
};

describe('isHappyMoment（gdd §13: 最初の源泉・各お客さんの初来訪・転生の完了だけ）', () => {
  it('最初の源泉（図鑑のただ 1 つ）で送り、2 つ目以降・転生の後の再発見では送らない', () => {
    expect(isHappyMoment({ type: 'SpringFound', spring: 'simple', depth: 20 }, withSprings('simple'))).toBe(true);
    expect(isHappyMoment({ type: 'SpringFound', spring: 'co2', depth: 60 }, withSprings('simple', 'co2'))).toBe(false);
    // 転生の後、周回の中で同じ源泉を見つけ直しても、図鑑は 2 つ以上あるので送らない
    expect(isHappyMoment({ type: 'SpringFound', spring: 'simple', depth: 20 }, withSprings('simple', 'co2'))).toBe(false);
  });
  it('お客さんは初来訪（first）だけ。転生の完了は毎回', () => {
    const s = createInitialState(1);
    expect(isHappyMoment({ type: 'GuestArrived', guest: 'tanuki', first: true }, s)).toBe(true);
    expect(isHappyMoment({ type: 'GuestArrived', guest: 'tanuki', first: false }, s)).toBe(false);
    expect(isHappyMoment({ type: 'PrestigeDone', gained: '1e0' }, s)).toBe(true);
  });
  it('ほかのイベント（打撃・ブロック・帯・購入・道具・お客さんの帰り）では送らない', () => {
    const s = createInitialState(1);
    const others: GameEvent[] = [
      { type: 'StratumEntered', band: 1 },
      { type: 'ToolEvolved', tool: 1 },
      { type: 'GuestLeft', guest: 'tanuki' },
      { type: 'Purchased', item: 'drill', qty: 1 },
      { type: 'BreakOpportunity', placement: 'M1' },
    ];
    for (const e of others) expect(isHappyMoment(e, s), e.type).toBe(false);
  });
});

describe('GameStore.onEvents', () => {
  it('ステップ・アクション・付与で起きたイベントを、起きた順の配列で受け取る。空なら呼ばない。購読をやめられる', () => {
    const store = new GameStore(createInitialState(1));
    const got: GameEvent[][] = [];
    const off = store.onEvents((evs) => got.push([...evs]));
    store.dispatch({ type: 'tap', count: 1 });
    store.pushEvents([]);
    store.pushEvents(applyGrant(store.state, { coins: '10' }));
    const n = got.length;
    store.pushEvents([{ type: 'ToolEvolved', tool: 1 }]);
    expect(got.length).toBe(n + 1);
    expect(got.at(-1)).toEqual([{ type: 'ToolEvolved', tool: 1 }]);
    expect(got.every((evs) => evs.length > 0)).toBe(true);
    off();
    store.pushEvents([{ type: 'ToolEvolved', tool: 2 }]);
    expect(got.length).toBe(n + 1);
  });
  it('1 つの購読者が例外を投げても、ほかには届き、onError に渡る', () => {
    const errors: unknown[] = [];
    const store = new GameStore(createInitialState(1), { onError: (e) => errors.push(e) });
    const got: string[] = [];
    store.onEvents(() => {
      throw new Error('boom');
    });
    store.onEvents((evs) => got.push(...evs.map((e) => e.type)));
    store.pushEvents([{ type: 'PrestigeDone', gained: '1e0' }]);
    expect(got).toEqual(['PrestigeDone']);
    expect(errors).toHaveLength(1);
  });
});
