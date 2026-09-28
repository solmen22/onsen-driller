// E2E の固定シードが、今の core の式で条件を満たすことの確認（BL-073）
import { describe, expect, it } from 'vitest';
import { findSeeds, isSeedA, isSeedB, oresIn, SEED_A, SEED_B } from './seeds.ts';

describe('E2E の固定シード', () => {
  it('SEED_A は 0〜5m に鉱石がない', () => {
    expect(oresIn(SEED_A, 0, 5)).toEqual([]);
    expect(isSeedA(SEED_A)).toBe(true);
  });

  it('SEED_B は 0m か 1m が鉱石', () => {
    expect(isSeedB(SEED_B)).toBe(true);
  });

  it('定数は条件を満たす最小のシード（探し直した結果と一致する）', () => {
    expect(findSeeds()).toEqual({ seedA: SEED_A, seedB: SEED_B });
  });
});
