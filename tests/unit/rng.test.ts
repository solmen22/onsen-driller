// BL-009: sfc32・hash32 の再現性（TS-009-08〜13）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hash01, hash32, isValidSfc32, normalizeSeed, seedSfc32, sfc32Next, type Sfc32State } from '../../src/core/rng.ts';

const draw = (s: Sfc32State, n: number): number[] => Array.from({ length: n }, () => sfc32Next(s));

describe('TS-009-08 同じシードで同じ列', () => {
  it('10,000 個ずつ 2 回', () => {
    expect(draw(seedSfc32(42), 10_000)).toEqual(draw(seedSfc32(42), 10_000));
  });
});

describe('TS-009-09 シードの端', () => {
  it('0・1・0xFFFFFFFF・−1・1.5・2^32 で決まった列になり、値は [0, 2^32) の整数', () => {
    for (const seed of [0, 1, 0xffffffff, -1, 1.5, 2 ** 32, NaN]) {
      const xs = draw(seedSfc32(seed), 1000);
      expect(xs).toEqual(draw(seedSfc32(seed), 1000));
      for (const x of xs) expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
      expect(new Set(xs).size).toBeGreaterThan(990); // 退化していない
    }
    expect(draw(seedSfc32(0), 5)).not.toEqual(draw(seedSfc32(1), 5));
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(2 ** 32)).toBe(0);
    expect(normalizeSeed(1.5)).toBe(1);
  });
});

describe('TS-009-10 途中で保存・復元しても同じ列', () => {
  it('JSON にして戻した状態から続きを引く', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 500 }), (seed, k) => {
        const a = seedSfc32(seed);
        const b = seedSfc32(seed);
        draw(a, k);
        draw(b, k);
        const restored = JSON.parse(JSON.stringify(b)) as Sfc32State;
        expect(isValidSfc32(restored)).toBe(true);
        expect(draw(restored, 50)).toEqual(draw(a, 50));
      }),
      { numRuns: 100, seed: 1 },
    );
  });
});

describe('TS-009-11 hash32 は呼ぶ順番によらない', () => {
  it('昇順・降順・ランダムな順で同じ値（property）', () => {
    fc.assert(
      fc.property(fc.integer(), fc.shuffledSubarray(Array.from({ length: 300 }, (_, i) => i * 33)), (seed, depths) => {
        const asc = new Map(depths.map((d) => [d, hash32(seed, d)]));
        for (const d of [...depths].reverse()) expect(hash32(seed, d)).toBe(asc.get(d));
      }),
      { numRuns: 50, seed: 2 },
    );
  });
});

describe('TS-009-12・13 hash32 の分布と端', () => {
  it('シード 20 × 深さ 10,000 で 6% 未満の割合が 5.5〜6.5%', () => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) for (let d = 0; d < 10_000; d++) if (hash01(seed, d) < 0.06) n++;
    const ratio = n / 200_000;
    expect(ratio).toBeGreaterThan(0.055);
    expect(ratio).toBeLessThan(0.065);
  });
  it('端の入力でも 32 ビットの符号なし整数', () => {
    for (const [a, b] of [[0, 0], [0, 1_000_000], [5, -1], [-7, -123]] as const) {
      const h = hash32(a, b);
      expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    }
  });
});
