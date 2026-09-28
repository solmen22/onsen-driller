// 購入ボタンの表示の中身（gdd §11-3・Q-09・Q-17。BL-043）。表示と購入は同じ buyQuote で決める（core-api.md §3-1）。
// ここは純粋な関数（状態 → 表示の値）。Preact の部品（BuyButton.tsx）はこれを描くだけ（tests/integration/ui-buy.test.ts）
// - state: buyQuote の state をそのまま data-state に入れる（affordable・insufficient・locked・maxed）
// - 数（-qty）: ×1 以外で n > 0 のとき「×n」。コスト（-cost）: n > 0 なら n 個の合計、0 個（「最大」で 1 個も買えない）なら次の 1 個
// - 目安（-eta）: 足りないときだけ。secondsUntil が null（収入 0）なら「あと N コイン」
// - 効果（-effect）: core の関数（drillPower・autoDiggerHitsPerSec・TOOLS の倍率）を、買った後の仮の状態に当てて比べる（式は UI に書かない）
import { TOOLS } from '../../content/tools.ts';
import {
  autoDiggerHitsPerSec,
  buyQuote,
  div,
  drillPower,
  secondsUntil,
  sub,
  toNumber,
  toStr,
  type BuyState,
  type GameState,
  type ItemId,
  type Num,
  type Qty,
} from '../../core/index.ts';
import { t, type Lang, type TextKey } from '../../i18n/index.ts';
import { etaParts, formatCost } from '../format.ts';

export interface BuyEta {
  /** 「あと N 秒」の秒（収入 0 なら null） */
  seconds: number | null;
  /** 足りない額（Decimal の文字列） */
  lack: string;
  text: string;
}

export interface BuyView {
  item: ItemId;
  /** data-testid（buy-drill・buy-auto-digger・buy-tool・buy-pump-simple…） */
  testId: string;
  state: BuyState;
  /** 表示の数（×1・×10 で足りないときは qty のまま、「最大」で 0 個なら 0） */
  n: number;
  /** 「×n」を出すか（×1 以外で n > 0。道具は 1 段ずつなので出さない） */
  showQty: boolean;
  /** 表示するコスト（n > 0 なら n 個の合計、0 なら次の 1 個）。Decimal の文字列と表示の文字 */
  cost: string;
  costText: string;
  /** 今のレベル（道具は段 0〜7） */
  level: number;
  levelText: string;
  name: string;
  effectText: string;
  /** 足りないときの目安（それ以外は null） */
  eta: BuyEta | null;
  /** 未解放のときの解放の深さ（それ以外は null） */
  unlockDepth: number | null;
  /** 道具の次の段の ID（プレビュー用。最後の段なら null） */
  nextToolId: string | null;
}

/** 品目の ID → data-testid（camelCase をハイフンに、':' を '-' に。Q-17） */
export const buyTestId = (item: ItemId): string => `buy-${item.replace(':', '-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** 倍率の表示（小数 2 桁まで。末尾の 0 は落とす） */
const ratioText = (r: number): string => String(Math.round(r * 100) / 100);

/** 足りないときの「あと N 秒／分／時間」「あと N コイン」 */
export function etaOf(s: GameState, cost: Num, lang: Lang): BuyEta {
  const lack = sub(cost, s.run.coins);
  const seconds = secondsUntil(s, cost);
  if (seconds === null) return { seconds: null, lack: toStr(lack), text: t('eta.coins', { n: formatCost(lack, lang) }) };
  const p = etaParts(seconds);
  return { seconds, lack: toStr(lack), text: t(`eta.${p.unit}` as TextKey, { n: p.n }) };
}

/** 買った後の仮の状態（読むだけ。元の状態は書き換えない） */
function withLevels(s: GameState, drill: number, digger: number): GameState {
  return { ...s, run: { ...s.run, drill: { ...s.run.drill, level: drill }, autoDig: { ...s.run.autoDig, level: digger } } };
}

function effectOf(s: GameState, item: ItemId, k: number): string {
  const r = s.run;
  switch (item) {
    case 'drill': {
      const before = drillPower(s);
      const after = drillPower(withLevels(s, r.drill.level + k, r.autoDig.level));
      return t('effect.power', { x: ratioText(before.gt(0) ? toNumber(div(after, before)) : 1) });
    }
    case 'autoDigger': {
      const d = autoDiggerHitsPerSec(withLevels(s, r.drill.level, r.autoDig.level + k)) - autoDiggerHitsPerSec(s);
      return t('effect.hits', { n: ratioText(d) });
    }
    case 'tool': {
      const next = TOOLS[r.drill.tool + 1];
      if (!next) return '';
      const power = t('effect.power', { x: ratioText(next.mult) });
      // 道具の 1 段目（ツルハシ）で自動掘りが使えるようになる（Q-03）
      return r.drill.tool === 0 ? `${power}${t('effect.sep')}${t('effect.autoDig')}` : power;
    }
    default:
      return '';
  }
}

function nameOf(item: ItemId, s: GameState): { name: string; levelText: string } {
  if (item === 'tool') {
    const cur = TOOLS[s.run.drill.tool];
    const next = TOOLS[s.run.drill.tool + 1];
    return {
      name: next ? t('buy.toolNext', { tool: t(`tool.${next.id}` as TextKey) }) : t('item.tool'),
      levelText: t(`tool.${cur?.id ?? 'shovel'}` as TextKey),
    };
  }
  const key: TextKey = item === 'drill' ? 'item.drill' : item === 'autoDigger' ? 'item.autoDigger' : item === 'bath' ? 'item.bath' : 'item.pump';
  const level = buyQuote(s, item, 1).level;
  return { name: t(key), levelText: t('buy.level', { n: level }) };
}

/** 購入ボタン 1 つの表示の中身 */
export function buyView(s: GameState, item: ItemId, qty: Qty, lang: Lang): BuyView {
  const q = buyQuote(s, item, qty);
  const shown = q.n > 0 ? q.cost : q.nextCost;
  const { name, levelText } = nameOf(item, s);
  return {
    item,
    testId: buyTestId(item),
    state: q.state,
    n: q.n,
    showQty: item !== 'tool' && qty !== 1 && q.n > 0,
    cost: toStr(shown),
    costText: t('buy.cost', { cost: formatCost(shown, lang) }),
    level: q.level,
    levelText,
    name,
    effectText: q.state === 'maxed' ? '' : effectOf(s, item, q.n > 0 ? q.n : 1),
    eta: q.state === 'insufficient' ? etaOf(s, shown, lang) : null,
    unlockDepth: q.state === 'locked' ? (q.unlockDepth ?? null) : null,
    nextToolId: item === 'tool' ? (TOOLS[s.run.drill.tool + 1]?.id ?? null) : null,
  };
}
