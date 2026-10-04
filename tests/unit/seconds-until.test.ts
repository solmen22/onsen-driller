// BL-113: secondsUntil が、足りないのに Decimal の精度で 0 秒を返していた（`lack.eq(0)` で早く返していた）。
// 返し方（BACKLOG の BL-113「返し方の確定」）: ① coins ≥ cost なら 0 ② 足りず収入 0 なら null ③ それ以外は 1 以上
// （break_infinity の引き算は相対 1e-14 未満の差を 0 にするので、差ではなく比較で決める）
import Decimal from 'break_infinity.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createInitialState, incomePerSec, num, secondsUntil, sub, type GameState, type Num } from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

/** 正の有限な double の 1 つ下の値（相対 1e-17 のように double で表せない差のとき、いちばん近い「足りない」所持にする） */
function nextDown(x: number): number {
  const f = new Float64Array([x]);
  const i = new BigInt64Array(f.buffer);
  i[0] = i[0]! - 1n;
  return f[0]!;
}

/** cost の相対 −r の所持（double で表せず cost と同じになるときは、仮数を 1 つ下にして必ず cost より少なくする） */
function justBelow(cost: Num, r: number): Num {
  const c = Decimal.fromMantissaExponent(cost.mantissa * (1 - r), cost.exponent);
  return c.lt(cost) ? c : Decimal.fromMantissaExponent_noNormalize(nextDown(cost.mantissa), cost.exponent);
}

/** 収入あり（自動掘りオン・ツルハシ。0.375/秒）の状態に所持を入れる */
function earning(coins: Num): GameState {
  const s = stateWith({ tool: 1, autoOn: true });
  s.run.coins = coins;
  return s;
}

/** 収入 0（新しいゲーム）の状態に所持を入れる */
function idle(coins: Num): GameState {
  const s = createInitialState(1);
  s.run.coins = coins;
  return s;
}

const REL = [1e-3, 1e-9, 1e-15, 1e-17] as const;

describe('BL-113 secondsUntil の返し方（足りているかは比較で決める）', () => {
  it('前提: 収入ありの状態は収入 > 0、新しいゲームは 0', () => {
    expect(incomePerSec(earning(num(0))).gt(0)).toBe(true);
    expect(incomePerSec(idle(num(0))).eq(0)).toBe(true);
  });

  it('再現: 所持がコストの 1 つ下（相対 1e-17 相当）だと引き算の差は 0 になるが、足りないので 1 以上', () => {
    const cost = num(3);
    const coins = justBelow(cost, 1e-17);
    expect(coins.lt(cost)).toBe(true);
    expect(sub(cost, coins).eq(0)).toBe(true); // 修正前はここで 0 秒を返していた
    expect(secondsUntil(earning(coins), cost)).toBeGreaterThanOrEqual(1);
  });

  it('① 足りていれば 0（ちょうど・多い。収入の有無によらない）', () => {
    for (const make of [earning, idle]) {
      expect(secondsUntil(make(num(3)), num(3))).toBe(0);
      expect(secondsUntil(make(num(4)), num(3))).toBe(0);
    }
  });

  it('② 足りず収入 0 なら null（差が精度で消えた場合も。UI は「あと N コイン」）', () => {
    const cost = num(3);
    expect(secondsUntil(idle(num(1)), cost)).toBeNull();
    expect(secondsUntil(idle(justBelow(cost, 1e-17)), cost)).toBeNull();
  });

  it.each(REL)('③ 性質: 所持がコストの相対 −%s なら（収入あり）1 以上、足りている側は 0', (r) => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10, maxExcluded: true, noNaN: true }),
        fc.integer({ min: 0, max: 300 }),
        (m, e) => {
          const cost = Decimal.fromMantissaExponent(m, e);
          const coins = justBelow(cost, r);
          expect(coins.lt(cost)).toBe(true);
          const sec = secondsUntil(earning(coins), cost);
          expect(sec).not.toBeNull();
          expect(sec!).toBeGreaterThanOrEqual(1);
          expect(secondsUntil(earning(cost), cost)).toBe(0);
          expect(secondsUntil(idle(coins), cost)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
