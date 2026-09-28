// E2E（E1・E5）で固定するシード（e2e_E1_first-play.md「固定するシード」）。
// core で鉱石の配置を調べて決めた定数。式・シードの扱いが変わったら seeds.test.ts が落ちるので、findSeeds() で探し直す。
//
// 前提（Q-16 の回答待ち）: __game.seed(n) は createInitialState(n) と同じ規則で新しいゲームを始める
// （n から周回のシード run.seed を作り、鉱石の配置は hash32(run.seed, 深さ) で決まる。arch §8-1）。
import { createInitialState, isOre } from '../../src/core/index.ts';

/** 0〜5m のブロックに鉱石がないシード（E1 の #2 の判定・E5 の準備に使う） */
export const SEED_A = 2;
/** 0m か 1m のブロックが鉱石のシード（TS-E1-07: 最初の強化が 5 秒を下回る場合の記録） */
export const SEED_B = 10;

/** 深さ from〜to（両端を含む）に鉱石があるか */
export function oresIn(seed: number, from: number, to: number): number[] {
  const s = createInitialState(seed);
  const out: number[] = [];
  for (let d = from; d <= to; d++) if (isOre(s, d)) out.push(d);
  return out;
}

export const isSeedA = (seed: number): boolean => oresIn(seed, 0, 5).length === 0;
export const isSeedB = (seed: number): boolean => oresIn(seed, 0, 1).length > 0;

/** 条件を満たす最小のシード（1 から探す） */
export function findSeeds(limit = 10_000): { seedA: number | null; seedB: number | null } {
  let seedA: number | null = null;
  let seedB: number | null = null;
  for (let n = 1; n <= limit && (seedA === null || seedB === null); n++) {
    if (seedA === null && isSeedA(n)) seedA = n;
    if (seedB === null && isSeedB(n)) seedB = n;
  }
  return { seedA, seedB };
}
