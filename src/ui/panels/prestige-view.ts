// T4「転生」と転生の確認の画面（M3）の表示の中身（gdd §5-8・§11-2。BL-045）。純粋な関数（状態 → 表示の値）
// - 値はすべて core の prestigeView・perkTreeView・runStartPreview から取り、UI で式を持たない（引き算・倍率の計算もしない。PR #75 のレビュー N-3）
// - 描くたびにここで読み直す（保持した値を見せない。TL-A の約束〔BL-021〕）。返す値は文字と数だけなので、useGame の浅い比較で
//   変わったときだけ描き直す
// - 表示の決めごと（BL-045 の受け入れ基準 6。PM 2026-11-15）
//   - 「あと 〇m」: 次に湯の華が増える深さまでの m と、その深さを出す（「あと 6m（166m）」）。「+1」とは書かない。目利き ×1.5 では
//     基本の +1 で最終が +2 になる深さがあるため（PR #78 のレビューの N-2。core に「次の深さでの最終の量」を足さずに済む）
//   - 推奨の基準が Infinity（壊れたセーブの前回の獲得）のときは、目安の行を出さない（推奨もしない。TS-021-10）
//   - 倍率は「全生産 +18% → +90%」（湯の華 1 つで +2% の上乗せの部分を % で。大きい数は数の表記の設定に従う）
//   - 目利きの上乗せは「湯の華 +13（目利き +4）」のように分けて出す（Q-47 (h)）
import { PERK_BY_ID, PERKS, type PerkBranch, type PerkEffect, type PerkId } from '../../content/perks.ts';
import { SPRINGS } from '../../content/springs.ts';
import type { TerrainId } from '../../content/terrains.ts';
import { TOOLS } from '../../content/tools.ts';
import { mul, num, perkTreeView, prestigeView, runStartPreview, springDepthIn, sub, terrainChoices, type GameState, type Num, type PerkNodeState } from '../../core/index.ts';
import { t, type Lang, type TextKey } from '../../i18n/index.ts';
import { formatNum } from '../format.ts';
import { effectText } from './inn-view.ts';

/** data-value に入れる数（number で表せる間は 10 進の整数の文字列。テストは Number(data-value) で読む） */
export const numValue = (n: Num): string => {
  const x = n.toNumber();
  return Number.isFinite(x) ? String(x) : n.toString();
};

/** 全生産の倍率（1.18）→ 上乗せの % の文字（「18」）。数の表記の設定に従う */
const pct = (mult: Num, lang: Lang): string => formatNum(mul(sub(mult, 1), 100), lang);

export interface PrestigePanelView {
  unlocked: boolean;
  canPrestige: boolean;
  recommended: boolean;
  /** 解放前の案内（「150m で解放」「あと 〇m」） */
  lockedTitle: string;
  lockedLeft: string;
  /** 今得られる湯の華（表示と data-value） */
  gainText: string;
  gainValue: string;
  /** 目利きの上乗せ（なければ空） */
  bonusText: string;
  /** 「次に湯の華が増えるまで あと 〇m（〇m）」か「転生できるまで あと 〇m」 */
  nextText: string;
  /** 「あと 〇m」の 〇（data-left） */
  nextLeft: number;
  /** 推奨の行（推奨のとき）か目安の行（推奨でなく、基準が有限のとき）。どちらでもなければ空 */
  guideText: string;
  /** 今の全生産の上乗せ（「湯の華で 全生産 +18%」。data-value は倍率） */
  multText: string;
  multValue: string;
}

export function prestigePanelView(s: Readonly<GameState>, lang: Lang): PrestigePanelView {
  const v = prestigeView(s);
  const finite = Number.isFinite(v.recommendAt);
  return {
    unlocked: v.unlocked,
    canPrestige: v.canPrestige,
    recommended: v.recommended,
    lockedTitle: t('prestige.locked.title', { n: v.unlockDepth }),
    lockedLeft: t('prestige.locked.left', { n: v.metersToUnlock }),
    gainText: t('prestige.gain', { n: formatNum(v.gain, lang) }),
    gainValue: numValue(v.gain),
    bonusText: v.gainBonus > 0 ? t('prestige.gainBonus', { n: formatNum(num(v.gainBonus), lang) }) : '',
    nextText: v.canPrestige
      ? t('prestige.next', { m: v.metersToNextGain, d: v.nextGainDepth })
      : t('prestige.needDepth', { m: v.metersToUnlock }),
    nextLeft: v.canPrestige ? v.metersToNextGain : v.metersToUnlock,
    guideText: v.recommended
      ? t('prestige.recommended', { n: formatNum(num(v.recommendAt), lang) })
      : finite
        ? t('prestige.guide', { n: formatNum(num(v.recommendAt), lang) })
        : '',
    multText: t('prestige.multNow', { n: pct(v.multNow, lang) }),
    multValue: numValue(v.multNow),
  };
}

export interface PrestigeConfirmView {
  canPrestige: boolean;
  gainText: string;
  gainValue: string;
  bonusText: string;
  lifetimeText: string;
  multText: string;
  multAfterValue: string;
  ticketsText: string;
  /** 実際に入る枚数（data-value） */
  ticketsAdded: number;
  /** 上限の案内（入らない分がなければ空。0 枚しか入らなくても出す。コインに替えるとは書かない。Q-47 (d)） */
  ticketCapText: string;
  /** 次の周回の始め（近道の深さ・支度金・形見の道具。なければ空） */
  startText: string;
}

/** 確認の画面の値。plan は振り直している途中の木（undefined なら今の木のまま） */
export function prestigeConfirmView(s: Readonly<GameState>, lang: Lang, plan?: readonly PerkId[]): PrestigeConfirmView {
  const v = prestigeView(s);
  const st = runStartPreview(s, plan);
  const start: string[] = [];
  if (st.depth > 0) start.push(t('prestige.start.depth', { n: st.depth }));
  if (st.coins > 0) start.push(t('prestige.start.coins', { n: formatNum(num(st.coins), lang) }));
  const tool = TOOLS[st.tool];
  if (st.tool > 0 && tool) start.push(t('prestige.start.tool', { tool: t(`tool.${tool.id}` as TextKey) }));
  return {
    canPrestige: v.canPrestige,
    gainText: t('prestige.confirm.gain', { n: formatNum(v.gain, lang) }),
    gainValue: numValue(v.gain),
    bonusText: v.gainBonus > 0 ? t('prestige.gainBonus', { n: formatNum(num(v.gainBonus), lang) }) : '',
    lifetimeText: t('prestige.confirm.lifetime', { now: formatNum(v.lifetimeNow, lang), after: formatNum(v.lifetimeAfter, lang) }),
    multText: t('prestige.confirm.mult', { now: pct(v.multNow, lang), after: pct(v.multAfter, lang) }),
    multAfterValue: numValue(v.multAfter),
    ticketsText: t('prestige.confirm.tickets', { n: v.ticketsGain }),
    ticketsAdded: v.ticketsAdded,
    ticketCapText:
      v.ticketsOverflow <= 0 ? '' : v.ticketsAdded > 0 ? t('prestige.confirm.ticketCap', { n: v.ticketsAdded }) : t('prestige.confirm.ticketCapNone'),
    startText: start.join(t('effect.sep')),
  };
}

/** 木だけの効果の文（共通の語彙は inn-view の effectText） */
export function perkEffectText(e: Readonly<PerkEffect>): string {
  const ratio = (r: number): string => String(Math.round(r * 100) / 100);
  switch (e.kind) {
    case 'pumpBathCost':
      return t('effect.pumpBathCost', { x: ratio(e.mult) });
    case 'oreChance':
      return t('effect.oreChance', { n: Math.round(e.add * 100) });
    case 'guestBonus':
      return t('effect.guestBonus', { x: ratio(e.mult) });
    case 'yunohanaGain':
      return t('effect.yunohanaGain', { x: ratio(e.mult) });
    case 'offlineCap':
      return t('effect.offlineCap', { n: Math.round(e.addMs / 3_600_000) });
    case 'startTool': {
      const tool = TOOLS[e.tool];
      return t('effect.startTool', { tool: tool ? t(`tool.${tool.id}` as TextKey) : String(e.tool) });
    }
    case 'startDepth':
      return t('effect.startDepth', { n: Math.round(e.frac * 100) });
    case 'startCoins':
      return t('effect.startCoins', { n: e.coins });
    default:
      return effectText(e);
  }
}

export const BRANCHES: readonly PerkBranch[] = ['dig', 'inn', 'guest'];

export interface PerkNodeRow {
  id: PerkId;
  state: PerkNodeState;
  name: string;
  effect: string;
  cost: string;
  costValue: number;
  /** 前提の案内（locked のときだけ。「研いだ刃を取ると取れる」） */
  needs: string;
  /** 次の周回の始めから効く（形見のツルハシ・近道の坑道・旅の支度金） */
  nextRun: boolean;
}

export interface PerkTreeRows {
  /** 使える湯の華の文と数 */
  availableText: string;
  availableValue: string;
  columns: { branch: PerkBranch; nodes: PerkNodeRow[] }[];
  /** 再描画の要否（状態・言語が同じなら描き直さない） */
  sig: string;
}

/** 木の表示。plan を渡すと振り直しの途中の木（予算は転生した後の累計）。plan が正しくなければ null */
export function perkTreeRows(s: Readonly<GameState>, lang: Lang, plan?: readonly PerkId[]): PerkTreeRows | null {
  const v = perkTreeView(s, plan);
  if (!v) return null;
  const name = (id: PerkId): string => t(PERK_BY_ID[id].nameKey);
  const rows: PerkNodeRow[] = v.nodes.map((n) => ({
    id: n.id,
    state: n.state,
    name: name(n.id),
    effect: PERK_BY_ID[n.id].effects.map(perkEffectText).join(t('effect.sep')),
    cost: t('perk.cost', { n: n.cost }),
    costValue: n.cost,
    needs: n.state === 'locked' ? t('perk.needs', { names: n.requiresAny.map(name).join(t('perk.or')) }) : '',
    nextRun: n.appliesFrom === 'nextRun',
  }));
  const availableValue = numValue(v.available);
  return {
    availableText: t('perk.available', { n: formatNum(v.available, lang) }),
    availableValue,
    columns: BRANCHES.map((branch) => ({ branch, nodes: rows.filter((r) => PERK_BY_ID[r.id].branch === branch) })),
    sig: `${lang}|${availableValue}|${rows.map((r) => `${r.id}:${r.state}`).join(',')}`,
  };
}

/**
 * 振り直しの途中の木で、ノードを押したときの次の plan（確認の画面だけ）。
 * - 取っているノード: 戻す。それを前提にしていて、ほかの前提もなくなったノードも戻す（定義の順に 1 回見れば決まる）
 * - 取っていないノード: 取る。前提を満たさない・湯の華が足りないなら plan を変えない
 */
export function togglePlan(s: Readonly<GameState>, plan: readonly PerkId[], id: PerkId): PerkId[] {
  if (plan.includes(id)) {
    const kept = new Set<PerkId>();
    for (const p of PERKS) {
      if (p.id === id || !plan.includes(p.id)) continue;
      if (p.requiresAny.length === 0 || p.requiresAny.some((r) => kept.has(r))) kept.add(p.id);
    }
    return PERKS.filter((p) => kept.has(p.id)).map((p) => p.id);
  }
  const next = PERKS.filter((p) => p.id === id || plan.includes(p.id)).map((p) => p.id);
  return perkTreeView(s, next) ? next : [...plan];
}

export interface TerrainRow {
  id: TerrainId;
  name: string;
  /** 行き先に選べるか（この転生で解放されるものを含む） */
  selectable: boolean;
  /** 今の周回の地形 */
  current: boolean;
  /** 特徴の文（効果と、山あいより浅い源泉）。山あいは「標準」 */
  traits: string;
  /** 選べないときの「あと 〇 回の転生で解放」 */
  lockText: string;
}

/** 転生の確認の画面の地形の選択（BL-024 の terrainChoices。gdd §5-8 の表）。定義の順 */
export function terrainRows(s: Readonly<GameState>): TerrainRow[] {
  return terrainChoices(s).map((c) => {
    const shallow = SPRINGS.filter((sp) => c.springDepths[sp.id] < springDepthIn('mountain', sp.id)).map((sp) => t(`spring.${sp.id}` as TextKey));
    const parts = c.effects.map((e) => effectText(e));
    if (shallow.length > 0) parts.unshift(t('terrain.shallow', { springs: shallow.join(t('terrain.and')) }));
    return {
      id: c.id,
      name: t(`terrain.${c.id}` as TextKey),
      selectable: c.selectable,
      current: c.current,
      traits: parts.length > 0 ? parts.join(t('effect.sep')) : t('terrain.standard'),
      lockText: c.selectable ? '' : t('terrain.locked', { n: c.prestigesLeft }),
    };
  });
}
