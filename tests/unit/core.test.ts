import { describe, expect, it } from 'vitest';
import {
  advance,
  createInitialState,
  dispatch,
  hash32,
  isOre,
  seedSfc32,
  sfc32Next,
  stateHash,
} from '../../src/core/index.ts';

describe('rng', () => {
  it('sfc32 は同じシードで同じ列になる', () => {
    const a = seedSfc32(42);
    const b = seedSfc32(42);
    const xs = Array.from({ length: 5 }, () => sfc32Next(a));
    const ys = Array.from({ length: 5 }, () => sfc32Next(b));
    expect(xs).toEqual(ys);
    expect(new Set(xs).size).toBe(5);
  });

  it('hash32 は入力が同じなら同じ値', () => {
    expect(hash32(1, 2)).toBe(hash32(1, 2));
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });

  it('鉱石の出現率はおよそ 6%（シード × 深さのハッシュ）', () => {
    const s = createInitialState(7);
    let n = 0;
    for (let d = 0; d < 100_000; d++) if (isOre(s, d)) n++;
    expect(n / 100_000).toBeGreaterThan(0.055);
    expect(n / 100_000).toBeLessThan(0.065);
  });
});

describe('actions', () => {
  it('買えないときは状態を変えない', () => {
    const s = createInitialState(1);
    const before = stateHash(s);
    const r = dispatch(s, { type: 'buy', item: 'drill', qty: 1 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('insufficient');
    expect(stateHash(s)).toBe(before);
  });

  it('タップで掘れて、30m で源泉が見つかり枠につながる', () => {
    const s = createInitialState(1);
    dispatch(s, { type: 'setAutoDig', on: true });
    const ev = advance(s, 60_000, 100);
    expect(s.run.depth).toBeGreaterThan(0);
    for (let i = 0; i < 2000 && s.run.maxDepth < 30; i++) {
      dispatch(s, { type: 'buy', item: 'drill', qty: 'max' });
      dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
      advance(s, 5_000, 100, ev);
    }
    expect(s.run.maxDepth).toBeGreaterThanOrEqual(30);
    expect(s.run.springs.simple?.pump).toBe(1);
    expect(s.run.bath.slots[0]).toBe('simple');
    expect(s.run.guests).toContain('tanuki');
  });

  it('同じシード・同じ入力列なら同じ stateHash', () => {
    const run = (): string => {
      const s = createInitialState(99);
      dispatch(s, { type: 'setAutoDig', on: true });
      for (let i = 0; i < 200; i++) {
        dispatch(s, { type: 'tap', count: 3 });
        dispatch(s, { type: 'buy', item: 'drill', qty: 1 });
        advance(s, 1_000, 100);
      }
      return stateHash(s);
    };
    expect(run()).toBe(run());
  });
});
