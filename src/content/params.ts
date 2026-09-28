// 全体のパラメータ（gdd §5・§7-1 の初期値）。数値はここと各コンテンツの定義にだけ置く。
export const PARAMS = {
  /** 論理の固定ステップ（ms）。arch §7 */
  stepMs: 100,
  block: { h0: 4, gh: 1.066, v0: 0.5, gv: 1.052, oreChance: 0.06, oreMult: 8 },
  drill: { c0: 5, r: 1.16, milestoneEvery: 25 },
  autoDigger: { c0: 40, r: 1.18, hitsPerLv: 0.2 },
  input: { tapMaxPerSec: 8, holdPerSec: 4, autoDigPerSec: 2 },
  bath: { c0: 150, r: 1.25, bonusPerLv: 0.05, slotsAtLevel: [0, 5, 15, 35] },
  pumpMilestones: [10, 25, 50, 100],
  prestige: { unlockDepth: 150, divisor: 50, bonusPerYunohana: 0.02 },
  /** 1 ステップで壊せるブロックの上限（異常な状態での暴走を防ぐ） */
  maxBlocksPerStep: 10_000,
  ads: { midgame: { onPrestige: true, onStratum: true } },
} as const;
