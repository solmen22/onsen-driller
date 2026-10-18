// T3「改良」の表示の中身（gdd §5-7・§11-2。BL-044 の T3。Q-38 (c)・(e)）。純粋な関数（状態 → 表示の値）。
// - 並び: まだ買っていない改良（解放済み）を上に、買った改良を下に。どちらも内容定義の順で固定する。
//   買える・足りないで並べ替えない（コインの増減で行が入れ替わり、押そうとした位置に別の改良が来るのを防ぐ。TS-044-14）
// - 行の状態とコストは core の upgradeViews（＝buyQuote と同じ見積もり。TS-018-15）。行の描画は BuyButton（名前・効果・コスト・「あと N 秒」）
// - 未解放の改良は行を出さず、「次の改良」を 1 行だけ出す（名前・効果・解放の条件と今の進み）。どれを出すかは、条件の進み（今 ÷ 目標）が
//   いちばん大きいもの（同じなら内容定義の順）。何が来て何をするのかが先に分かると、掘る・ポンプを上げる目標になる
// - core は変えない（TS-044-18）。足りない表示の値はここで作る
import { SPRING_BY_ID } from '../../content/springs.ts';
import { UPGRADES, type UpgradeDef, type UpgradeId } from '../../content/upgrades.ts';
import { upgradeBought, upgradeUnlocked, upgradeViews, type GameState } from '../../core/index.ts';
import { t, type TextKey } from '../../i18n/index.ts';
import { effectText } from './inn-view.ts';

/** 「次の改良」の 1 行（未解放の改良のうち、条件にいちばん近いもの） */
export interface NextUpgrade {
  id: UpgradeId;
  name: string;
  effect: string;
  kind: 'depth' | 'pump';
  /** 目標（深さの m か、ポンプの Lv） */
  target: number;
  /** 今（周回の最深の m か、その源泉のポンプの Lv。未発見は 0） */
  current: number;
  /** ポンプの条件で、その源泉をまだ見つけていない（条件の文は「〇m で〇〇を見つけ、ポンプ Lv N」。PR #72 のレビューの S-1） */
  unfound: boolean;
  /** 条件の文（例「70m で解放（あと 15m）」「単純温泉のポンプ Lv 3/5 で解放」「250m で硫黄泉を見つけ、ポンプ Lv 25 で解放（あと 20m）」） */
  condition: string;
}

export interface UpgradesView {
  /** 解放済みで、まだ買っていない改良（内容定義の順） */
  available: UpgradeId[];
  /** 買った改良（内容定義の順） */
  bought: UpgradeId[];
  /** 未解放の改良のうち次に出るもの（全部解放済みなら null） */
  next: NextUpgrade | null;
}

const nameOf = (id: UpgradeId): string => t(`upgrade.${id}` as TextKey);
const springName = (id: string): string => t(`spring.${id}` as TextKey);

/** 条件の進み（0〜1 未満。未解放のものだけを比べる） */
function progressOf(s: Readonly<GameState>, def: Readonly<UpgradeDef>): { current: number; target: number; ratio: number } {
  const u = def.unlock;
  const current = u.kind === 'depth' ? s.run.maxDepth : (s.run.springs[u.spring]?.pump ?? 0);
  const target = u.kind === 'depth' ? u.depth : u.level;
  return { current, target, ratio: target > 0 ? current / target : 0 };
}

function nextOf(s: Readonly<GameState>): NextUpgrade | null {
  let best: { def: UpgradeDef; current: number; target: number; ratio: number } | null = null;
  for (const def of UPGRADES) {
    if (upgradeBought(s, def.id) || upgradeUnlocked(s, def)) continue;
    const p = progressOf(s, def);
    if (!best || p.ratio > best.ratio) best = { def, ...p };
  }
  if (!best) return null;
  const { def, current, target } = best;
  const u = def.unlock;
  // 源泉が未発見なら「Lv 0/25」は上げられない目標に見えるので、見つける深さを先に出す（S-1。深さは content の SPRINGS）
  const unfound = u.kind === 'pump' && s.run.springs[u.spring] === undefined;
  let condition: string;
  if (u.kind === 'depth') condition = t('upgrades.condDepth', { n: target, left: Math.max(0, target - current) });
  else if (unfound) {
    const depth = SPRING_BY_ID[u.spring].depth;
    condition = t('upgrades.condPumpUnfound', { depth, spring: springName(u.spring), n: target, left: Math.max(0, depth - s.run.maxDepth) });
  } else condition = t('upgrades.condPump', { spring: springName(u.spring), cur: current, n: target });
  return { id: def.id, name: nameOf(def.id), effect: effectText(def.effect), kind: u.kind, target, current, unfound, condition };
}

export function upgradesView(s: Readonly<GameState>): UpgradesView {
  const rows = upgradeViews(s);
  return {
    available: rows.filter((r) => !r.bought).map((r) => r.id),
    bought: rows.filter((r) => r.bought).map((r) => r.id),
    next: nextOf(s),
  };
}

/** 再描画の要否（並び・次の改良の文が同じなら描き直さない。行の中身は BuyButton がそれぞれ見る） */
export const sameUpgrades = (a: UpgradesView, b: UpgradesView): boolean =>
  a.available.join() === b.available.join() &&
  a.bought.join() === b.bought.join() &&
  a.next?.id === b.next?.id &&
  a.next?.condition === b.next?.condition &&
  a.next?.name === b.next?.name;
