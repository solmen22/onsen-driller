// 湯の華の木（gdd §5-8 の表。12 ノード・コスト合計 258。BL-022）
// - 湯の華（累計 − 使った分）で取る。取っても累計は減らない（全生産 +2%/個 は累計で決まる）
// - 前提は「どれか 1 つを取っていればよい」（「A か B」。gdd の表）。前提のないノードは最初から取れる
// - 転生のたびに無料で振り直せる（使った湯の華が全部戻る。core の prestige の perks で選び直す）
// - 数値（効果・コスト）はここだけに置く。名前・説明は i18n のキー（perk.<id>）
import type { Effect } from './effects.ts';

export type PerkId =
  | 'sharpBlade'
  | 'nightDig'
  | 'heirloomPick'
  | 'shortcut'
  | 'yumori'
  | 'carpenter'
  | 'banto'
  | 'famousSpring'
  | 'travelFunds'
  | 'loupe'
  | 'regulars'
  | 'connoisseur';

export type PerkBranch = 'dig' | 'inn' | 'guest';

/**
 * 木だけが使う効果（Effect の共通の語彙に加える。core/formulas.ts の modifiers と、転生の周回の始め〔core/perks.ts〕が読む）
 * - pumpBathCost: ポンプと湯船のコスト ×mult
 * - oreChance: 鉱石の出現の確率に足す（6% → 10% は +0.04）
 * - guestBonus: お客さんの効果の「上乗せの部分」×mult（×1.5 のお客さんは ×1.75。【仮定】gdd の「お客さんの効果 ×1.5」の読み方）
 * - yunohanaGain: 湯の華の獲得 ×mult（基本の量を先に切り捨て、掛けた後にもう一度切り捨てる。Q-47 (h)）
 * - offlineCap: オフラインの上限に足す（8 時間 → 12 時間は +4 時間。BL-030 の早送りが使う）
 * - startTool: 周回の始めの道具（TOOLS の index。2＝手掘りやぐら）
 * - startDepth: 周回の始めの深さ＝前回の周回の最深 × frac（切り捨て。途中の源泉は発見済み）
 * - startCoins: 周回の始めのコイン
 */
export type PerkEffect =
  | Effect
  | { kind: 'pumpBathCost'; mult: number }
  | { kind: 'oreChance'; add: number }
  | { kind: 'guestBonus'; mult: number }
  | { kind: 'yunohanaGain'; mult: number }
  | { kind: 'offlineCap'; addMs: number }
  | { kind: 'startTool'; tool: number }
  | { kind: 'startDepth'; frac: number }
  | { kind: 'startCoins'; coins: number };

export interface PerkDef {
  id: PerkId;
  branch: PerkBranch;
  effects: readonly PerkEffect[];
  /** 湯の華 */
  cost: number;
  /** どれか 1 つを取っていれば取れる（空なら前提なし） */
  requiresAny: readonly PerkId[];
  /** i18n のキー */
  nameKey: `perk.${PerkId}`;
}

const HOUR = 3_600_000;
const perk = (id: PerkId, branch: PerkBranch, effects: PerkEffect[], cost: number, requiresAny: PerkId[] = []): PerkDef => ({
  id,
  branch,
  effects,
  cost,
  requiresAny,
  nameKey: `perk.${id}`,
});

/** 定義の順＝木の並び（系統ごとに、浅い段から）。保存する perks もこの順に並べる */
export const PERKS: readonly PerkDef[] = [
  // 掘削
  perk('sharpBlade', 'dig', [{ kind: 'drillPower', mult: 2 }], 5),
  perk('nightDig', 'dig', [{ kind: 'autoDig', mult: 2 }], 10, ['sharpBlade']),
  perk('heirloomPick', 'dig', [{ kind: 'startTool', tool: 2 }], 15, ['sharpBlade']),
  perk('shortcut', 'dig', [{ kind: 'startDepth', frac: 0.25 }], 40, ['nightDig', 'heirloomPick']),
  // 湯宿
  perk('yumori', 'inn', [{ kind: 'incomeAll', mult: 2 }], 5),
  perk('carpenter', 'inn', [{ kind: 'pumpBathCost', mult: 0.9 }], 15, ['yumori']),
  perk('banto', 'inn', [{ kind: 'offlineEff', add: 0.5 }, { kind: 'offlineCap', addMs: 4 * HOUR }], 20, ['yumori']),
  perk('famousSpring', 'inn', [{ kind: 'incomeAll', mult: 4 }], 60, ['carpenter']),
  // 客寄せ
  perk('travelFunds', 'guest', [{ kind: 'startCoins', coins: 500 }], 3),
  perk('loupe', 'guest', [{ kind: 'oreChance', add: 0.04 }], 10, ['travelFunds']),
  perk('regulars', 'guest', [{ kind: 'guestBonus', mult: 1.5 }], 25, ['travelFunds']),
  perk('connoisseur', 'guest', [{ kind: 'yunohanaGain', mult: 1.5 }], 50, ['loupe', 'regulars']),
];

export const PERK_IDS: readonly PerkId[] = PERKS.map((p) => p.id);

export const PERK_BY_ID: Readonly<Record<PerkId, PerkDef>> = Object.fromEntries(PERKS.map((p) => [p.id, p])) as Record<PerkId, PerkDef>;

export const isPerkId = (x: string): x is PerkId => Object.hasOwn(PERK_BY_ID, x);
