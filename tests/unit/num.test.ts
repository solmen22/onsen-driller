// BL-009: core/num.ts（Decimal のラッパ）の健全性（TS-009-01〜07。#22。Q-13）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  add,
  affordGeometric,
  cmp,
  div,
  gte,
  isHealthy,
  lt,
  mul,
  num,
  NUM_MAX,
  pow,
  sub,
  sumGeometric,
  toNumber,
  toStr,
  ZERO,
  type Num,
} from '../../src/core/num.ts';

/** 大きな値の生成器（仮数 [1,10) × 10^指数、指数 [-5, 9e15]。0・1・上限を必ず混ぜる） */
const bigArb: fc.Arbitrary<Num> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(ZERO, num(1), NUM_MAX, num('1e308'), num(0.5)) },
  {
    weight: 6,
    arbitrary: fc
      .tuple(fc.double({ min: 1, max: 9.999999, noNaN: true }), fc.integer({ min: -5, max: 400 }))
      .map(([m, e]) => num(`${m}e${e}`)),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(fc.double({ min: 1, max: 9.999999, noNaN: true }), fc.integer({ min: 400, max: 9e15 - 1 }))
      .map(([m, e]) => num(`${m}e${e}`)),
  },
);

const RUNS = { numRuns: 300, seed: 20260928 };

describe('TS-009-01 演算の結果が健全（NaN・Infinity・負のゼロなし、上限以下）', () => {
  it('加減乗除・pow・比較（property）', () => {
    fc.assert(
      fc.property(bigArb, bigArb, fc.integer({ min: 0, max: 300 }), (a, b, k) => {
        for (const r of [add(a, b), sub(a, b), mul(a, b), div(a, b), pow(a, k), pow(b, k / 7)]) {
          expect(isHealthy(r)).toBe(true);
          expect(r.lte(NUM_MAX)).toBe(true);
          expect(Object.is(r.mantissa, -0)).toBe(false);
        }
        // 比較は全順序（lt と gte のどちらか一方だけが真）
        expect(lt(a, b) !== gte(a, b)).toBe(true);
        expect(Math.sign(cmp(a, b)) + Math.sign(cmp(b, a))).toBe(0);
      }),
      RUNS,
    );
  });
});

describe('TS-009-02 上限 1e(9e15−1) を超えない', () => {
  it('上限×10・10^(9e15+1)・上限＋上限 は上限', () => {
    expect(mul(NUM_MAX, 10).eq(NUM_MAX)).toBe(true);
    expect(pow(10, 9e15 + 1).eq(NUM_MAX)).toBe(true);
    expect(add(NUM_MAX, NUM_MAX).eq(NUM_MAX)).toBe(true);
    expect(num(Infinity).eq(NUM_MAX)).toBe(true);
    expect(num('Infinity').eq(NUM_MAX)).toBe(true);
    expect(num('1e9000000000000001').eq(NUM_MAX)).toBe(true);
    expect(isHealthy(NUM_MAX)).toBe(true);
    expect(toStr(NUM_MAX)).toBe('1e8999999999999999');
  });
});

describe('TS-009-03 ゼロ除算は 0', () => {
  it('x ÷ 0', () => {
    for (const x of [ZERO, num(1), num('1e100')]) {
      const r = div(x, 0);
      expect(r.eq(0)).toBe(true);
      expect(isHealthy(r)).toBe(true);
    }
    expect(div(num(1), ZERO).eq(0)).toBe(true);
  });
});

describe('TS-009-04・05 負のゼロと負の結果', () => {
  it('0−0・0×−1・num(-0) は負のゼロでない', () => {
    for (const r of [sub(ZERO, 0), mul(ZERO, -1), num(-0)]) {
      expect(Object.is(r.mantissa, -0)).toBe(false);
      expect(Object.is(toNumber(r), -0)).toBe(false);
    }
  });
  it('3−5 は 0（負にしない）', () => {
    expect(sub(num(3), 5).eq(0)).toBe(true);
    expect(mul(num(3), -2).eq(0)).toBe(true);
  });
});

describe('TS-009-06 不正な入力は例外にせず 0（Infinity は上限）', () => {
  it('NaN・abc・空・undefined・型違い', () => {
    for (const v of ['NaN', 'abc', '', undefined, null, {}, [], NaN, -Infinity, '-5', -3, 'x'.repeat(100)]) {
      const r = num(v);
      expect(r.eq(0), JSON.stringify(v) ?? typeof v).toBe(true);
    }
  });
});

describe('TS-009-07 文字列の往復', () => {
  it('toStr → num で元と等しく、仮数・指数がビット単位で同じ', () => {
    fc.assert(
      fc.property(bigArb, (a) => {
        const b = num(toStr(a));
        expect(b.eq(a)).toBe(true);
        expect(b.mantissa).toBe(a.mantissa);
        expect(b.exponent).toBe(a.exponent);
      }),
      RUNS,
    );
    for (const s of ['1.23e45', '1.23e+45', '0', '1', '123.5', '1e308']) expect(num(s).eq(num(Number(s) || s))).toBe(true);
    expect(toStr(num('1.23e45'))).toBe('1.23e45');
    expect(toStr(ZERO)).toBe('0');
  });
});

describe('等比級数（購入の見積もりの土台）', () => {
  it('買える数は 0 以上の整数、合計コストは健全', () => {
    expect(affordGeometric(ZERO, 5, 1.16, 0)).toBe(0);
    expect(affordGeometric(num(5), 5, 1.16, 0)).toBe(1);
    expect(sumGeometric(0, 5, 1.16, 0).eq(0)).toBe(true);
    expect(sumGeometric(1, 5, 1.16, 0).eq(5)).toBe(true);
  });
});
