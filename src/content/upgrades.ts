// 改良（一度きりの強化。gdd §5-7。BL-018）: 先に入れる 12 項目（2026-09-29 技術リード）。後半の 12 項目は BL-020（S3）
// - 数値（コスト・倍率・解放の条件）はここだけに置く。数値の調整は content/ だけの PR で行う（受け入れ基準 4・TS-018-16）
// - 解放の条件は周回の中で減らない値（周回の最深・ポンプの Lv）だけ（お客さんの条件は BL-020）
// - コストの初期値＝標準ボット（seed 1）で解放される時刻の毎秒の収入 × 100 秒を丸めた値（BL-034 で調整）
// - 名前は i18n のキー（upgrade.<id>）。効果は content/effects.ts の共通の語彙
import type { Effect } from './effects.ts';
import type { SpringId } from './springs.ts';

export type UpgradeId =
  | 'vibroBit'
  | 'sieve'
  | 'noren'
  | 'ledger'
  | 'drillOil'
  | 'yumomiSimple'
  | 'milk'
  | 'yumomiCo2'
  | 'yumomiSalt'
  | 'twinBit'
  | 'polisher'
  | 'yumomiSulfur';

export type UpgradeUnlock = { kind: 'depth'; depth: number } | { kind: 'pump'; spring: SpringId; level: number };

export interface UpgradeDef {
  id: UpgradeId;
  effect: Effect;
  unlock: UpgradeUnlock;
  /** コイン（一度きり） */
  cost: number;
  /** i18n のキー */
  nameKey: `upgrade.${UpgradeId}`;
}

const up = (id: UpgradeId, effect: Effect, unlock: UpgradeUnlock, cost: number): UpgradeDef => ({ id, effect, unlock, cost, nameKey: `upgrade.${id}` });
const depth = (d: number): UpgradeUnlock => ({ kind: 'depth', depth: d });
const pump = (spring: SpringId, level: number): UpgradeUnlock => ({ kind: 'pump', spring, level });

/** 定義の順＝T3 の並び（未購入の組の中。Q-38 (c)） */
export const UPGRADES: readonly UpgradeDef[] = [
  up('vibroBit', { kind: 'drillPower', mult: 2 }, depth(40), 500),
  up('sieve', { kind: 'oreValue', mult: 2 }, depth(50), 700),
  up('noren', { kind: 'incomeAll', mult: 1.5 }, pump('simple', 5), 1_200),
  up('ledger', { kind: 'digCoins', mult: 1.5 }, depth(70), 2_000),
  up('drillOil', { kind: 'autoDig', mult: 2 }, depth(100), 30_000),
  up('yumomiSimple', { kind: 'springIncome', spring: 'simple', mult: 3 }, pump('simple', 25), 80_000),
  up('milk', { kind: 'incomeAll', mult: 2 }, depth(130), 400_000),
  up('yumomiCo2', { kind: 'springIncome', spring: 'co2', mult: 3 }, pump('co2', 25), 6e7),
  up('yumomiSalt', { kind: 'springIncome', spring: 'salt', mult: 3 }, pump('salt', 25), 1.4e8),
  up('twinBit', { kind: 'drillPower', mult: 2 }, depth(190), 1.9e8),
  up('polisher', { kind: 'oreValue', mult: 3 }, depth(220), 2.9e8),
  up('yumomiSulfur', { kind: 'springIncome', spring: 'sulfur', mult: 3 }, pump('sulfur', 25), 7.6e9),
];

export const UPGRADE_BY_ID: Readonly<Record<UpgradeId, UpgradeDef>> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<
  UpgradeId,
  UpgradeDef
>;

/** 知っている改良の ID か（prototype の名前〔__proto__・constructor〕を拾わない） */
export const isUpgradeId = (v: unknown): v is UpgradeId => typeof v === 'string' && Object.hasOwn(UPGRADE_BY_ID, v);
