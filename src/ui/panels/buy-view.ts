// 購入ボタンの表示の中身（gdd §11-3・Q-09・Q-17。BL-043）。表示と購入は同じ buyQuote で決める（core-api.md §3-1）。
// ここは純粋な関数（状態 → 表示の値）。Preact の部品（BuyButton.tsx）はこれを描くだけ（tests/integration/ui-buy.test.ts）
// - state: buyQuote の state をそのまま data-state に入れる（affordable・insufficient・locked・maxed）
// - 数（-qty）: ×1 以外で n > 0 のとき「×n」。コスト（-cost）: n > 0 なら n 個の合計、0 個（「最大」で 1 個も買えない）なら次の 1 個
// - 目安（-eta）: 足りないときだけ。secondsUntil が null（収入 0）なら「あと N コイン」
// - 効果（-effect）: core の関数（drillPower・autoDiggerHitsPerSec・TOOLS の倍率）を、買った後の仮の状態に当てて比べる（式は UI に書かない）
// - 改良（upgrade:<id>。T3）: 名前と効果（content の effect を T2 と同じ語彙で）。一度きりなのでレベルと数は出さず、買った後も効果を出す（何が効いているか分かるように）
import { TOOLS } from '../../content/tools.ts';
import { UPGRADE_BY_ID, isUpgradeId } from '../../content/upgrades.ts';
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
import { t, tn, type Lang, type TextKey } from '../../i18n/index.ts';
import { etaParts, formatNum, formatShortfall } from '../format.ts';
import { effectText } from './inn-view.ts';

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
  /** maxed のときの文（ふつうは「完了」、改良は「購入済み」） */
  doneText: string;
}

/** 改良の ID（'upgrade:<id>' の <id>）。改良でなければ null */
const upgradeIdOf = (item: ItemId): string | null => (typeof item === 'string' && item.startsWith('upgrade:') ? item.slice(8) : null);

/** 品目の ID → data-testid（camelCase をハイフンに、':' を '-' に。Q-17） */
export const buyTestId = (item: ItemId): string => `buy-${item.replace(':', '-').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** 倍率の表示（小数 2 桁まで。末尾の 0 は落とす） */
const ratioText = (r: number): string => String(Math.round(r * 100) / 100);

/** 足りないときの「あと N 秒／分／時間」「あと N コイン」 */
export function etaOf(s: GameState, cost: Num, lang: Lang): BuyEta {
  const lack = sub(cost, s.run.coins);
  const seconds = secondsUntil(s, cost);
  if (seconds === null) {
    const n = formatShortfall(lack, lang); // 不足額だけ切り上げ（足りないのに「あと 0 コイン」と見せない。BL-011）
    return { seconds: null, lack: toStr(lack), text: tn('eta.coins', n, { n }) }; // 英語の単数「1 coin short」（B-N7）
  }
  // 念のため 1 秒以上（secondsUntil は足りない間 1 以上を返す。BL-113。「あと 0 秒」を出さない。QA の条件 (c)）
  const sec = Math.max(1, seconds);
  const p = etaParts(sec);
  return { seconds: sec, lack: toStr(lack), text: t(`eta.${p.unit}`, { n: p.n }) };
}

/** 「5 coins」「1 coin」（英語の単数。B-N7） */
const costText = (cost: string): string => tn('buy.cost', cost, { cost });

/** 買った後の仮の状態（読むだけ。元の状態は書き換えない） */
function withLevels(s: GameState, drill: number, digger: number): GameState {
  return { ...s, run: { ...s.run, drill: { ...s.run.drill, level: drill }, autoDig: { ...s.run.autoDig, level: digger } } };
}

function effectOf(s: GameState, item: ItemId, k: number): string {
  const r = s.run;
  const up = upgradeIdOf(item);
  if (up !== null) return isUpgradeId(up) ? effectText(UPGRADE_BY_ID[up].effect) : '';
  switch (item) {
    case 'drill': {
      const before = drillPower(s);
      const after = drillPower(withLevels(s, r.drill.level + k, r.autoDig.level));
      return t('effect.power', { x: ratioText(before.gt(0) ? toNumber(div(after, before)) : 1) });
    }
    case 'autoDigger': {
      const d = autoDiggerHitsPerSec(withLevels(s, r.drill.level, r.autoDig.level + k)) - autoDiggerHitsPerSec(s);
      const n = ratioText(d);
      return tn('effect.hits', n, { n });
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
  const up = upgradeIdOf(item);
  if (up !== null) return { name: isUpgradeId(up) ? t(`upgrade.${up}` as TextKey) : '', levelText: '' }; // 一度きり（レベルなし）
  const level = buyQuote(s, item, 1).level;
  if (item.startsWith('pump:')) {
    // どの源泉のポンプかを名前に入れる（T2 に同じ名前のボタンが並ぶため。読み上げでも分かるように。PR #46 のレビューの S-2・BL-130）
    return { name: t('buy.pumpOf', { spring: t(`spring.${item.slice(5)}` as TextKey) }), levelText: t('buy.level', { n: level }) };
  }
  const key: TextKey = item === 'drill' ? 'item.drill' : item === 'autoDigger' ? 'item.autoDigger' : 'item.bath';
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
    showQty: item !== 'tool' && upgradeIdOf(item) === null && qty !== 1 && q.n > 0,
    cost: toStr(shown),
    costText: costText(formatNum(shown, lang)), // 所持コインと同じ切り捨て（等しい値は同じ表記。Q-33）
    level: q.level,
    levelText,
    name,
    effectText: q.state === 'maxed' && upgradeIdOf(item) === null ? '' : effectOf(s, item, q.n > 0 ? q.n : 1),
    eta: q.state === 'insufficient' ? etaOf(s, shown, lang) : null,
    unlockDepth: q.state === 'locked' ? (q.unlockDepth ?? null) : null,
    nextToolId: item === 'tool' ? (TOOLS[s.run.drill.tool + 1]?.id ?? null) : null,
    doneText: upgradeIdOf(item) !== null ? t('upgrade.bought') : t('buy.maxed'),
  };
}
