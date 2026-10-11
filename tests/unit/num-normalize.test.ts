// core/num.ts の正規化の不具合（重大度 S3）: break_infinity.js の加減算・乗除が仮数 [1, 10) の外の値を返すことがある。
// sanitize が値を変えずに [1, 10) に戻すこと（isHealthy・保存の文字列・往復）を確かめる
import Decimal from 'break_infinity.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { add, div, floor, isHealthy, mul, num, NUM_EXP_MAX, NUM_MAX, pow, sanitize, sub, toStr, ZERO } from '../../src/core/num.ts';
import { createInitialState, stateHash } from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';

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

  it('反例そのまま（BL-106 の受け入れ基準 1）: add(num(1), num(9999998.999999976)) の仮数は [1, 10)・isHealthy・元の和と相対誤差 1e-12 以内', () => {
    const r = add(num(1), num(9999998.999999976));
    expect(r.mantissa >= 1 && r.mantissa < 10).toBe(true);
    expect(isHealthy(r)).toBe(true);
    expect(Math.abs(r.toNumber() - (1 + 9999998.999999976)) / (1 + 9999998.999999976)).toBeLessThan(1e-12);
  });

  it('pow も同じ（PR #22 のレビューの N-2）: 生の Decimal.pow(9.999999999999998e-61, 5) は仮数 1 未満だが、pow は仮数 [1, 10)・isHealthy・相対誤差 1e-12 以内', () => {
    const raw = Decimal.pow(new Decimal(9.999999999999998e-61), 5);
    expect(raw.mantissa).toBeLessThan(1); // 直す前の形（break_infinity.js の版が変わって直ったら、この行が知らせる）
    const r = pow(9.999999999999998e-61, 5);
    expect(r.mantissa >= 1 && r.mantissa < 10).toBe(true);
    expect(isHealthy(r)).toBe(true);
    expect(Math.abs(r.div(raw).toNumber() - 1)).toBeLessThan(1e-12);
  });

  it('反例の値を持つ状態を保存して読み込むと、corrected が空で値がビット単位で同じ（修正の前は run.coins が直された）', () => {
    const s = createInitialState(1);
    s.run.coins = add(num(1), num(9999998.999999976));
    s.stats.totalCoins = s.run.coins;
    const r = decodeSave(encodeSave(s, 1, 1_700_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toEqual([]);
    expect([r.state.run.coins.mantissa, r.state.run.coins.exponent]).toEqual([s.run.coins.mantissa, s.run.coins.exponent]);
    expect(stateHash(r.state)).toBe(stateHash(s));
  });

  it('修正の前に保存された仮数 1 未満の文字列（"0.999999999999998e7"）も、修正の後の計算と同じ値に読む（正規化して、ビット単位で同じ）', () => {
    const legacy = num('0.999999999999998e7');
    const now = add(num(1), num(9999998.999999976));
    expect([legacy.mantissa, legacy.exponent]).toEqual([now.mantissa, now.exponent]);
    expect(isHealthy(legacy)).toBe(true);
    expect(num('0.5e1').eq(5)).toBe(true);
    expect(num('0.0e3').eq(ZERO)).toBe(true); // 仮数 0 は 0（今までどおり）
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

  it('性質: 10 のべき乗の前後（10^k − ε・10^k・10^k + ε。k は −300〜300）の足し算・引き算・掛け算・べき（pow）・切り捨て（floor）の結果はいつも正規化され、大小の順番が Number の順番と一致する（fast-check。BL-106 の受け入れ基準 2）', () => {
    // 10^k × (1 + j × 1e-16)（j は −40〜40。0 なら 10^k ちょうど）
    const nearPow = fc.tuple(fc.integer({ min: -300, max: 300 }), fc.integer({ min: -40, max: 40 })).map(([k, j]) => 10 ** k * (1 + j * 1e-16));
    const small = fc.oneof(fc.integer({ min: 1, max: 9 }), fc.double({ min: 1e-6, max: 1e-3, noNaN: true }));
    const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
    fc.assert(
      fc.property(nearPow, nearPow, small, fc.double({ min: 0.9, max: 1.1, noNaN: true }), fc.integer({ min: 1, max: 5 }), (a, b, c, t, p) => {
        const na = num(a);
        // pow（コストの等比の式で使う。生の Decimal.pow も 10^k の前後の底の整数乗で仮数 1 未満を返す。手元で約 0.4%）と floor も見る（PR #22 のレビューの N-2）
        const rs = [na, num(b), add(na, b), add(na, c), add(num(c), a), sub(na, c), sub(na, b), mul(na, t), mul(num(b), t), pow(na, p), pow(b, t), floor(na), floor(num(b))];
        if (!rs.every((r) => isHealthy(r) && (r.mantissa === 0 || (r.mantissa >= 1 && r.mantissa < 10)))) return false;
        // 比較（指数を先に比べる）の順番が、表している値の Number の順番と同じ。toNumber() は丸めるので、
        // Number で違う値になる組だけを比べる（丸めは単調なので、Number で小さければ本当の値も小さい）
        for (const x of rs)
          for (const y of rs) {
            const d = sign(x.toNumber() - y.toNumber());
            if (d !== 0 && x.cmp(y) !== d) return false;
          }
        return true;
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
