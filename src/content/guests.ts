// お客さん 6 種（gdd §5-6）。条件を満たしている間だけ来ている（抽選なし）。
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
  effect: GuestEffect;
}

export const GUESTS: readonly GuestDef[] = [
  { id: 'tanuki', condition: { kind: 'anySlotted' }, effect: { kind: 'incomeAll', mult: 1.5 } },
  { id: 'monkey', condition: { kind: 'slottedLevel', spring: 'co2', level: 10 }, effect: { kind: 'drillPower', mult: 2 } },
  { id: 'capybara', condition: { kind: 'slottedLevel', spring: 'salt', level: 10 }, effect: { kind: 'springIncome', spring: 'salt', mult: 2 } },
  { id: 'fox', condition: { kind: 'slottedLevel', spring: 'sulfur', level: 10 }, effect: { kind: 'autoDig', mult: 2 } },
  { id: 'cat', condition: { kind: 'allSlotsDistinct', slots: 4 }, effect: { kind: 'digCoins', mult: 2 } },
  { id: 'redPanda', condition: { kind: 'slottedLevel', spring: 'iron', level: 10 }, effect: { kind: 'incomeAll', mult: 1.5 } },
];

export const GUEST_BY_ID: Readonly<Record<GuestId, GuestDef>> = Object.fromEntries(
  GUESTS.map((g) => [g.id, g]),
) as Record<GuestId, GuestDef>;
