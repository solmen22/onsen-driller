// 全体のパラメータ（gdd §5・§7-1 の初期値）。数値はここと各コンテンツの定義にだけ置く（gdd §7-2）。
export const PARAMS = {
  /** 論理の固定ステップ（ms）。arch §7 */
  stepMs: 100,
  block: {
    h0: 4,
    gh: 1.066,
    v0: 0.5,
    gv: 1.052,
    oreChance: 0.06,
    oreMult: 8,
    /** この深さ未満のブロックは鉱石にしない（最初の強化までの時間をシードによらず一定にする。Q-02） */
    oreFreeDepth: 5,
  },
  drill: { c0: 5, r: 1.16, milestoneEvery: 25 },
  autoDigger: { c0: 40, r: 1.18, hitsPerLv: 0.2 },
  input: {
    /** 手動の打撃（タップ・長押し・自動掘りの基本）の上限。任意の 1 秒（移動窓）で数える（Q-04） */
    manualMaxPerSec: 8,
    holdPerSec: 4,
    autoDigPerSec: 2,
    /** 押し続けてから長押しになるまで（app/input.ts） */
    holdDelayMs: 300,
  },
  bath: { c0: 150, r: 1.25, bonusPerLv: 0.05, slotsAtLevel: [0, 5, 15, 35] },
  pumpMilestones: [10, 25, 50, 100],
  prestige: { unlockDepth: 150, divisor: 50, bonusPerYunohana: 0.02 },
  tickets: { initial: 2, max: 10 },
  /** 新しい帯に入ったときの幕間（ロジックの時間。Q-06） */
  interludeMs: 1500,
  /** 1 ステップで壊せるブロックの上限（異常な状態での暴走を防ぐ。残りのダメージは捨てる） */
  maxBlocksPerStep: 10_000,
  /** 地温（表示用）: 深さ m → ℃ の折れ線。間は直線、最後の点より深いところは tempSlopeAfter ℃/m（gdd §5-1。BACKLOG #9） */
  tempCurve: [
    [0, 15],
    [10, 25],
    [30, 38],
    [80, 42],
    [150, 48],
    [250, 58],
    [400, 72],
    [500, 85],
  ] as readonly (readonly [number, number])[],
  tempSlopeAfter: 0.13,
  /** 広告の段階導入（gdd §13-1）。false ならその機会のイベントを出さない */
  ads: { midgame: { onPrestige: true, onStratum: true } },
} as const;
