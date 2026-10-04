// 全体のパラメータ（gdd §5・§7-1 の初期値）。数値はここと各コンテンツの定義にだけ置く（gdd §7-2）。
export const PARAMS = {
  /** 論理の固定ステップ（ms）。arch §7 */
  stepMs: 100,
  /**
   * 1 回のステップの上限（ms）。これより長い step・advance の刻みは、この長さずつに分けて進める。
   * 手動の打撃の上限（移動窓）と帯の境目の扱いが刻み幅によらないのは 1 秒刻みまでのため（arch §8-3。レビュー S-9）
   */
  maxStepMs: 1000,
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
  /**
   * 自動掘削機。maxHitsPerSec は打数/秒の上限（Lv が極端に大きいと 2^floor(Lv/25) が Infinity になり、
   * 端数が NaN になって保存できなくなるのを防ぐ。通常のプレイでは届かない値。レビュー S-4）
   */
  autoDigger: { c0: 40, r: 1.18, hitsPerLv: 0.2, maxHitsPerSec: 1e12 },
  /** レベル（ドリル・自動掘削機・湯船・ポンプ）の上限。読み込みで補正し、購入もここで止まる（maxed。通常のプレイでは届かない。レビュー S-4） */
  levelMax: 1_000_000,
  input: {
    /** 手動の打撃（タップ・長押し・自動掘りの基本）の上限。任意の 1 秒（移動窓）で数える（Q-04） */
    manualMaxPerSec: 8,
    /** 上限を数える移動窓の長さ（ロジックの時間 ms。半開区間 (t−窓, t]） */
    manualWindowMs: 1000,
    holdPerSec: 4,
    autoDigPerSec: 2,
    /** 手動の毎秒の打数が 0 から正になったときの端数（最初の 1 打は間隔の半分の後） */
    startCarry: 0.5,
    /** 押し続けてから長押しになるまで（app/input.ts） */
    holdDelayMs: 300,
  },
  /** 湯船（gdd §5-5）: コスト c0 × r^Lv、1 Lv ごとに入湯料の合計 +5%、枠は Lv0・5・15・35 で 1〜4 つ（MVP の最大 4） */
  bath: { c0: 150, r: 1.25, bonusPerLv: 0.05, slotsAtLevel: [0, 5, 15, 35] },
  /** オフライン（gdd §9）: 効率の基本 50%。塩化物泉などの足し算の効果を足しても maxEff（100%。オンラインを超えない）まで（BL-016。早送りは S3 の BL-030） */
  offline: { eff: 0.5, maxEff: 1 },
  pumpMilestones: [10, 25, 50, 100],
  prestige: { unlockDepth: 150, divisor: 50, bonusPerYunohana: 0.02 },
  /**
   * 温泉チケット（gdd §5-9。BL-058）: 新しいゲームに initial 枚、上限 max 枚。上限を超えた分は「毎秒の収入 × overflowIncomeSec 秒」のコイン。
   * 1 回の出来事で得る量は固定（購入の個数・払ったコインで変わらない。QA §3-2(b)・Q-36 (a) の条件 1）
   */
  tickets: { initial: 2, max: 10, overflowIncomeSec: 60, guestFirstVisit: 1, achievement: 1, prestige: 2, vein: 1 },
  /** 掘削ブースト R2（gdd §5-9）: ドリル威力と自動掘削機の打数 ×mult を durationMs（ロジックの時間）。使ってから cooldownMs（壁時計）は使えない */
  boost: { mult: 2, durationMs: 300_000, cooldownMs: 900_000 },
  /**
   * ラッキー鉱脈 R3（gdd §5-9）: 出現の間隔は [minIntervalMs, maxIntervalMs)（ロジックの時間。周回の擬似乱数）、lifeMs で消える。
   * タップの打撃 hits 回で開く。報酬は「毎秒の収入 × incomeSec 秒」のコインと、ticketChance で温泉チケット
   */
  vein: { minIntervalMs: 300_000, maxIntervalMs: 480_000, lifeMs: 60_000, hits: 15, incomeSec: 90, ticketChance: 0.25 },
  /** おかえり ×2（R1）を受け取れるオフラインの経過時間（壁時計 ms。収入の額ではない。Q-36 (d)） */
  offlineDoubleMinMs: 60_000,
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
