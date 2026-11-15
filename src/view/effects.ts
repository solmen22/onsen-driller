// 演出の量（破片・揺れ・フラッシュ）の決め方（arch §14・gdd §6・§11-6。BL-037）。Phaser に依存しない純粋な関数
// - 破片のパーティクルは同時に 200 まで（maxAliveParticles）。打撃とブロックの破壊で出す
// - 揺れは 1 回 0.5 秒以内（操作は止めない。カメラを揺らすだけ）
// - 「動きを減らす」: 揺れ 0・フラッシュなし・パーティクル半分
// - 画質の自動調整（quality.ts）の倍率も掛ける

export const EFFECTS = {
  /** 破片の同時の上限（倍率 1 のとき） */
  shardsMax: 200,
  /** 打撃 1 回の破片（1 フレームの打撃の数 n で 3＋2n、12 まで） */
  hitShardsBase: 3,
  hitShardsPerHit: 2,
  hitShardsCap: 12,
  /** ブロックの破壊 1 つの破片と、1 フレームの上限（1 ステップで 1,000 個壊れても出しすぎない。TS-036-10） */
  breakShards: 6,
  breakShardsPerFrame: 48,
  /** 揺れ（ms・強さ）。0.5 秒以内 */
  shakeMs: 120,
  shakeIntensity: 0.004,
  /** 源泉の発見のフラッシュ（ms） */
  flashMs: 180,
} as const;

export interface EffectBudget {
  /** パーティクルの数に掛ける倍率 */
  scale: number;
  shake: boolean;
  flash: boolean;
}

/** 動きを減らす・画質の倍率から、この演出の量 */
export function effectBudget(reduceMotion: boolean, qualityScale: number): EffectBudget {
  const q = Number.isFinite(qualityScale) && qualityScale > 0 ? Math.min(1, qualityScale) : 1;
  return { scale: q * (reduceMotion ? 0.5 : 1), shake: !reduceMotion, flash: !reduceMotion };
}

/** 数 n に倍率を掛ける（0 より大きい n は少なくとも 1） */
export const scaled = (n: number, scale: number): number => (n <= 0 ? 0 : Math.max(1, Math.round(n * scale)));

/** 打撃（このフレームの打撃の数 n）の破片の数 */
export const hitShards = (n: number, scale: number): number =>
  scaled(Math.min(EFFECTS.hitShardsBase + EFFECTS.hitShardsPerHit * Math.max(0, n), EFFECTS.hitShardsCap), scale);

/** このフレームに壊れたブロックの数 blocks の破片の数（1 フレームの上限つき） */
export const breakShards = (blocks: number, scale: number): number =>
  blocks <= 0 ? 0 : scaled(Math.min(EFFECTS.breakShards * blocks, EFFECTS.breakShardsPerFrame), scale);

/** 破片の同時の上限 */
export const shardsMax = (scale: number): number => scaled(EFFECTS.shardsMax, scale);
