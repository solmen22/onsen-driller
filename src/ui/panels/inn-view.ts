// 湯宿タブ T2（gdd §6・§11-2。BL-044）の表示の中身。純粋な関数（状態 → 表示の値）で、Preact の部品（InnPanel.tsx）はこれを描くだけ
// - 値は core の selectors（springViews・bathView・guestViews）から取り、式は UI に書かない（core/ は変えない）
// - 見せる条件（Q-38 (b)）: 今の周回で源泉を 1 つ以上発見している、または図鑑に源泉がある（転生の後）。深さでは決めない
// - お客さんは辞書に名前（guest.<id>）があるものだけ（Q-38 (g)。BL-019 で辞書に入ると自動で 6 種になる）
// - お客さんの状態は文字でも出す（data-state: present・noSpring・notSlotted・levelShort。Q-38 (f)。色だけで伝えない）
import type { Effect } from '../../content/effects.ts';
import type { GuestCondition, GuestId } from '../../content/guests.ts';
import type { SpringId } from '../../content/springs.ts';
import { bathView, guestViews, springViews, type GameState, type Num } from '../../core/index.ts';
import { hasText, t, type Lang, type TextKey } from '../../i18n/index.ts';
import { formatNum } from '../format.ts';

/** 倍率の表示（小数 2 桁まで。末尾の 0 は落とす） */
const ratio = (r: number): string => String(Math.round(r * 100) / 100);

const springName = (id: SpringId): string => t(`spring.${id}` as TextKey);

/** 効果の文（源泉・お客さん・改良で共通の語彙。content/effects.ts） */
export function effectText(e: Readonly<Effect>): string {
  switch (e.kind) {
    case 'incomeAll':
      return t('effect.incomeAll', { x: ratio(e.mult) });
    case 'springIncome':
      return t('effect.springIncome', { spring: springName(e.spring), x: ratio(e.mult) });
    case 'drillPower':
      return t('effect.drillPower', { x: ratio(e.mult) });
    case 'autoDig':
      return t('effect.autoDigMult', { x: ratio(e.mult) });
    case 'oreValue':
      return t('effect.oreValue', { x: ratio(e.mult) });
    case 'hardness':
      return t('effect.hardness', { x: ratio(e.mult) });
    case 'digCoins':
      return t('effect.digCoins', { x: ratio(e.mult) });
    case 'offlineEff':
      return t('effect.offlineEff', { n: Math.round(e.add * 100) });
  }
}

/** 入湯料/秒の文（「+12/s」。HUD と同じ表記） */
const incomeText = (n: Num, lang: Lang): string => t('hud.income', { n: formatNum(n, lang) });

/** T2 の中身を見せるか（Q-38 (b)） */
export function innUnlocked(s: Readonly<GameState>): boolean {
  return Object.values(s.run.springs).some((x) => (x?.pump ?? 0) > 0) || s.collection.springsSeen.length > 0;
}

export interface InnSlotView {
  slot: number;
  /** data-spring（空きは空文字） */
  spring: string;
  name: string;
  effect: string;
  income: string;
}

export interface InnSpringView {
  id: SpringId;
  found: boolean;
  name: string;
  /** 発見済み: 「ポンプ Lv n」、未発見: 「〇m で発見」 */
  sub: string;
  effect: string;
  /** つないでいる枠（0 始まり。なければ null） */
  slot: number | null;
}

export interface InnBathView {
  level: number;
  slotCount: number;
  /** 「次の枠は Lv15」（最大なら null） */
  nextSlotText: string | null;
  nextSlotLevel: number | null;
  bonusText: string;
}

export type GuestState = 'present' | 'noSpring' | 'notSlotted' | 'levelShort';

export interface InnGuestView {
  id: GuestId;
  present: boolean;
  state: GuestState;
  name: string;
  condition: string;
  effect: string;
  /** 状態の文（色だけで伝えない） */
  stateText: string;
}

export interface InnView {
  unlocked: boolean;
  slots: InnSlotView[];
  springs: InnSpringView[];
  bath: InnBathView;
  guests: InnGuestView[];
}

function conditionText(c: Readonly<GuestCondition>): string {
  switch (c.kind) {
    case 'anySlotted':
      return t('inn.cond.anySlotted');
    case 'slottedLevel':
      return t('inn.cond.slottedLevel', { spring: springName(c.spring), n: c.level });
    case 'allSlotsDistinct':
      return t('inn.cond.allSlots', { n: c.slots });
  }
}

/** お客さんの状態（来ている／条件の源泉が未発見／発見済みだが枠にない／枠にあるが Lv が足りない） */
function guestState(s: Readonly<GameState>, c: Readonly<GuestCondition>, present: boolean): { state: GuestState; text: string } {
  if (present) return { state: 'present', text: t('inn.guest.present') };
  const slots = s.run.bath.slots;
  const found = (Object.keys(s.run.springs) as SpringId[]).filter((id) => (s.run.springs[id]?.pump ?? 0) > 0);
  switch (c.kind) {
    case 'anySlotted':
      return found.length === 0 ? { state: 'noSpring', text: t('inn.guest.noSpring') } : { state: 'notSlotted', text: t('inn.guest.notSlotted') };
    case 'slottedLevel': {
      const pump = s.run.springs[c.spring]?.pump ?? 0;
      if (pump <= 0) return { state: 'noSpring', text: t('inn.guest.noSpring') };
      if (!slots.includes(c.spring)) return { state: 'notSlotted', text: t('inn.guest.notSlotted') };
      return { state: 'levelShort', text: t('inn.guest.levelShort', { n: pump, m: c.level }) };
    }
    case 'allSlotsDistinct': {
      if (found.length === 0) return { state: 'noSpring', text: t('inn.guest.noSpring') };
      const filled = slots.filter((x) => x !== null).length;
      return { state: 'notSlotted', text: t('inn.guest.slotsFilled', { n: filled, m: c.slots }) };
    }
  }
}

/** T2 の表示の中身 */
export function innView(s: Readonly<GameState>, lang: Lang): InnView {
  const bath = bathView(s);
  const springs = springViews(s);
  return {
    unlocked: innUnlocked(s),
    slots: bath.slots.map((x) => ({
      slot: x.slot,
      spring: x.spring ?? '',
      name: x.spring === null ? t('slot.empty') : springName(x.spring),
      effect: x.effect === null ? '' : effectText(x.effect),
      income: x.spring === null ? '' : incomeText(x.incomePerSec, lang),
    })),
    // 伝説の源泉は S3（BL-023）まで出さない（springViews は 5 種だけを返す）
    springs: springs.map((x) => ({
      id: x.id,
      found: x.found,
      name: springName(x.id),
      sub: x.found ? t('inn.pumpLevel', { n: x.pump }) : t('inn.foundAt', { n: x.depth }),
      effect: effectText(x.effect),
      slot: x.slot,
    })),
    bath: {
      level: bath.level,
      slotCount: bath.slotCount,
      nextSlotLevel: bath.nextSlotLevel,
      nextSlotText: bath.nextSlotLevel === null ? null : t('inn.nextSlot', { n: bath.nextSlotLevel }),
      bonusText: t('inn.bathBonus', { n: bath.bonusPct }),
    },
    guests: guestViews(s)
      .filter((g) => hasText(`guest.${g.id}`))
      .map((g) => {
        const st = guestState(s, g.condition, g.present);
        return {
          id: g.id,
          present: g.present,
          state: st.state,
          name: t(`guest.${g.id}` as TextKey),
          condition: conditionText(g.condition),
          effect: effectText(g.effect),
          stateText: st.text,
        };
      }),
  };
}

/** 表示が変わったか（useGame の比べ方。JSON にして比べる。T2 の値は小さい） */
export const sameInn = (a: InnView, b: InnView): boolean => JSON.stringify(a) === JSON.stringify(b);
