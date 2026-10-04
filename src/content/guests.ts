// お客さん 6 種（gdd §5-6。BL-017・BL-019）。条件を満たしている間だけ来ている（抽選なし。乱数を使わない）。
// 条件の読み方（gdd §5-6）: anySlotted＝枠に源泉が 1 つでもある（タヌキ）、slottedLevel＝その源泉が枠にあってポンプが level 以上、
// allSlotsDistinct＝slots 個の枠がすべて埋まっている（同じ源泉は 2 つの枠に入らないので違う源泉になる。ネコ）。
// 名前は i18n のキー（guest.<id>）。ネコ・レッサーパンダの名前と、図鑑のひとことは BL-019（PM）
import type { Effect } from './effects.ts';
import type { SpringId } from './springs.ts';

export type GuestId = 'tanuki' | 'monkey' | 'capybara' | 'fox' | 'cat' | 'redPanda';

export type GuestCondition =
  | { kind: 'anySlotted' }
  | { kind: 'slottedLevel'; spring: SpringId; level: number }
  | { kind: 'allSlotsDistinct'; slots: number };

/** お客さんの効果（content/effects.ts の共通の語彙のうち、お客さんが使う種類。来ている間だけ効く） */
export type GuestEffect = Extract<Effect, { kind: 'incomeAll' | 'drillPower' | 'springIncome' | 'autoDig' | 'digCoins' }>;

export interface GuestDef {
  id: GuestId;
  condition: GuestCondition;
  /** 来ている間だけ効く効果（キツネの autoDig は自動掘削機の打数/秒。自動掘りの基本の毎秒 2 打には掛からない。Q-31 (d)） */
  effect: GuestEffect;
  /** i18n のキー */
  nameKey: `guest.${GuestId}`;
}

const guest = (id: GuestId, condition: GuestCondition, effect: GuestEffect): GuestDef => ({ id, condition, effect, nameKey: `guest.${id}` });

/** 定義の順＝同時に来たときのイベントの順（TS-017-13） */
export const GUESTS: readonly GuestDef[] = [
  guest('tanuki', { kind: 'anySlotted' }, { kind: 'incomeAll', mult: 1.5 }),
  guest('monkey', { kind: 'slottedLevel', spring: 'co2', level: 10 }, { kind: 'drillPower', mult: 2 }),
  guest('capybara', { kind: 'slottedLevel', spring: 'salt', level: 10 }, { kind: 'springIncome', spring: 'salt', mult: 2 }),
  guest('fox', { kind: 'slottedLevel', spring: 'sulfur', level: 10 }, { kind: 'autoDig', mult: 2 }),
  guest('cat', { kind: 'allSlotsDistinct', slots: 4 }, { kind: 'digCoins', mult: 2 }),
  guest('redPanda', { kind: 'slottedLevel', spring: 'iron', level: 10 }, { kind: 'incomeAll', mult: 1.5 }),
];

export const GUEST_BY_ID: Readonly<Record<GuestId, GuestDef>> = Object.fromEntries(
  GUESTS.map((g) => [g.id, g]),
) as Record<GuestId, GuestDef>;
