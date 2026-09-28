// テスト用フックの core 側（applyGrant）と描画用の selectors（Q-16。フックの本体は BL-071）
import { describe, expect, it } from 'vitest';
import { applyGrant, blockHp, blockProgress, createInitialState, dispatch, stateHash, type GameEvent } from '../../src/core/index.ts';

describe('applyGrant（grant: 足す／深さは置き換え）', () => {
  it('coins を足す（Decimal の文字列）・tickets を足して 10 で止める', () => {
    const s = createInitialState(1);
    applyGrant(s, { coins: '1e6' });
    applyGrant(s, { coins: '2.5e3' });
    expect(s.run.coins.eq(1_002_500)).toBe(true);
    expect(s.stats.totalCoins.eq(1_002_500)).toBe(true);
    applyGrant(s, { tickets: 5 });
    expect(s.meta.tickets).toBe(7);
    applyGrant(s, { tickets: 99 });
    expect(s.meta.tickets).toBe(10);
  });
  it('depth は置き換え: 最深は大きいほう・ダメージ 0。飛ばした帯と源泉は幕間・イベントなしで入った・見つけたことにする', () => {
    const s = createInitialState(1);
    s.run.blockDmg = s.run.blockDmg.add(2);
    const evs: GameEvent[] = applyGrant(s, { depth: 160 });
    expect([s.run.depth, s.run.maxDepth, s.stats.bestDepth]).toEqual([160, 160, 160]);
    expect(s.run.blockDmg.eq(0)).toBe(true);
    expect(s.run.stratumSeen).toEqual([0, 1, 2, 3]);
    expect(s.run.interludeMs).toBe(0);
    expect(Object.keys(s.run.springs).sort()).toEqual(['co2', 'salt', 'simple']);
    expect(s.run.bath.slots).toEqual(['simple']); // 空いている枠（1 つ）につなぐ
    expect(evs.some((e) => e.type === 'SpringFound' || e.type === 'StratumEntered')).toBe(false);
    applyGrant(s, { depth: 29 });
    expect([s.run.depth, s.run.maxDepth]).toEqual([29, 160]);
  });
  it('29m に置いた後に掘ると、30m で普通に幕間が出る（帯 2 は未見のまま）', () => {
    const s = createInitialState(1);
    applyGrant(s, { depth: 29, coins: '1e9' });
    s.run.blockDmg = blockHp(s, 29).sub(1);
    const r = dispatch(s, { type: 'tap' });
    expect(r.events).toContainEqual({ type: 'StratumEntered', band: 1 });
  });
  it('形の正しくない値は例外で、状態は変えない', () => {
    const s = createInitialState(1);
    const before = stateHash(s);
    const bad: unknown[] = [
      null,
      { coins: 'abc' },
      { coins: '-5' },
      { coins: Number.NaN },
      { tickets: -1 },
      { tickets: 1.5 },
      { depth: -3 },
      { depth: Number.POSITIVE_INFINITY },
      { depth: '10' },
    ];
    for (const p of bad) expect(() => applyGrant(s, p as never), JSON.stringify(p)).toThrow();
    expect(stateHash(s)).toBe(before);
  });
});

describe('blockProgress（ひびと道具の位置）', () => {
  it('入ったダメージ ÷ HP（0〜1 未満）', () => {
    const s = createInitialState(1);
    expect(blockProgress(s)).toBe(0);
    dispatch(s, { type: 'tap' });
    expect(blockProgress(s)).toBeCloseTo(0.25, 12);
  });
});
