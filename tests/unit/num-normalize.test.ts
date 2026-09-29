// core/num.ts の正規化の不具合（重大度 S3）: break_infinity.js の加減算・乗除が仮数 [1, 10) の外の値を返すことがある。
// sanitize が値を変えずに [1, 10) に戻すこと（isHealthy・保存の文字列・往復）を確かめる
import Decimal from 'break_infinity.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, div, isHealthy, mul, num, NUM_EXP_MAX, NUM_MAX, sanitize, sub, toStr, ZERO } from '../../src/core/num.ts';

const CANONICAL = /^(0|[1-9](\.\d+)?e-?\d+)$/;

describe('num.ts の正規化（仮数を [1, 10) に戻す）', () => {
  it('再現: add(1, 9999998.999999976) は仮数 0.999999999999998・指数 7 ではなく、9.99999999999998e6 になる', () => {
    const raw = new Decimal(1).add(new Decimal(9999998.999999976));
    expect(raw.mantissa).toBeLessThan(1); // break_infinity.js がそのまま返す値（前提の確認）
    const r = add(num(1), 9999998.999999976);
    expect(isHealthy(r)).toBe(true);
    expect(r.mantissa).toBeGreaterThanOrEqual(1);
    expect(r.mantissa).toBeLessThan(10);
    expect(r.exponent).toBe(6);
    expect(Math.abs(r.toNumber() - 9999999.999999976) / 1e7).toBeLessThan(1e-15);
    expect(toStr(r)).toMatch(CANONICAL);
    expect(num(toStr(r)).eq(r)).toBe(true);
  });

  it('sanitize: 仮数が 1 未満・10 以上の値を、値を変えずに直す。範囲の中の値はそのまま（同じオブジェクト）', () => {
    const low = sanitize(Decimal.fromMantissaExponent_noNormalize(0.5, 3));
    expect([low.mantissa, low.exponent]).toEqual([5, 2]);
    const high = sanitize(Decimal.fromMantissaExponent_noNormalize(25, 3));
    expect([high.mantissa, high.exponent]).toEqual([2.5, 4]);
    const ok = Decimal.fromMantissaExponent_noNormalize(3, 5);
    expect(sanitize(ok)).toBe(ok);
  });

  it('sanitize: 直した後に上限・下限を越えるときは上限・0', () => {
    expect(sanitize(Decimal.fromMantissaExponent_noNormalize(20, NUM_EXP_MAX)).eq(NUM_MAX)).toBe(true);
    expect(sanitize(Decimal.fromMantissaExponent_noNormalize(0.5, -NUM_EXP_MAX)).eq(ZERO)).toBe(true);
  });

  it('性質: 和が 10 のべき乗のすぐ下になる足し算（壊れやすい所）の結果はいつも健全（fast-check。修正前は約 3% が仮数 1 未満）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 9 }), (k, j, x) => {
        const s = 10 ** k * (1 - j * 1e-16);
        const r = add(num(x), s - x);
        return isHealthy(r) && CANONICAL.test(toStr(r)) && num(toStr(r)).eq(r);
      }),
      { numRuns: 2000 },
    );
  });

  it('性質: 9.99…9 の近くの足し算・引き算・掛け算・割り算の結果はいつも健全で、保存の文字列が正規の形・往復で同じ値（fast-check）', () => {
    const near = fc.tuple(fc.integer({ min: 0, max: 300 }), fc.double({ min: -1e-6, max: 1e-6, noNaN: true })).map(([k, d]) => (10 - 1e-12 + d) * 10 ** k);
    const any = fc.oneof(near, fc.double({ min: 1e-300, max: 1e300, noNaN: true }), fc.integer({ min: 1, max: 1e9 }));
    fc.assert(
      fc.property(any, any, (x, y) => {
        const a = num(x);
        for (const r of [add(a, y), sub(a, y), mul(a, y), div(a, y), add(num(y), x)]) {
          if (!isHealthy(r)) return false;
          const s = toStr(r);
          if (!CANONICAL.test(s)) return false;
          if (!num(s).eq(r)) return false;
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });
});
