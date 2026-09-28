// E2E（E1・E5）で固定するシード（e2e_E1_first-play.md「固定するシード」）。
// core で鉱石の配置を調べて決めた定数。式・シードの扱いが変わったら seeds.test.ts が落ちるので、findSeeds() で探し直す。
//
// 前提（技術リードの回答 traceability.md §5-2）
// - Q-16: __game.seed(n) は createInitialState(n) の新しいゲームに置き換える（鉱石の配置は hash32(run.seed, 深さ)。arch §8-1）。
// - Q-02: 深さ 0〜4m（最初の 5 ブロック）は鉱石にしない（content/params.ts の block.oreFreeDepth = 5）。
//   このため最初の強化までの時間はシードによらず 14.5 秒で、#2 の判定に特定のシードは要らない。
//   旧 SEED_B（0m か 1m が鉱石）はこの規則では作れないので、「保護のすぐ下（5m）が鉱石」に置き換えた。
//   鉱石がいちばん浅く出る場合でも #2 の範囲に入ることの裏付け（TS-E1-07）に使う。
import { createInitialState, isOre } from '../../src/core/index.ts';

/** 序盤に鉱石を出さない深さ（Q-02。content/params.ts の block.oreFreeDepth と同じ値。PoC の params には無いのでここに置く） */
export const ORE_FREE_DEPTH = 5;

/** 0〜5m のブロックに鉱石がないシード（E1 の #2 の判定・E5 の準備に使う。Q-02 の後は「5m が鉱石でない」と同じ） */
export const SEED_A = 2;
/** 保護のすぐ下（ORE_FREE_DEPTH＝5m）のブロックが鉱石のシード（TS-E1-07: 鉱石がいちばん浅く出る場合） */
export const SEED_B = 1;

/** 深さ from〜to（両端を含む）に鉱石があるか */
export function oresIn(seed: number, from: number, to: number): number[] {
  const s = createInitialState(seed);
  const out: number[] = [];
  for (let d = from; d <= to; d++) if (isOre(s, d)) out.push(d);
  return out;
}

export const isSeedA = (seed: number): boolean => oresIn(seed, 0, ORE_FREE_DEPTH).length === 0;
export const isSeedB = (seed: number): boolean => oresIn(seed, ORE_FREE_DEPTH, ORE_FREE_DEPTH).length > 0;

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
