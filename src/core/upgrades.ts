// 改良（一度きりの強化。gdd §5-7。BL-018）のロジック。数値は content/upgrades.ts だけに置く（TS-018-16）
// - 解放の判定は周回の最深（今の深さではない。Q-08 と同じ）とポンプの Lv
// - 見積もり（upgradeQuote）は buyQuote の一部で、表示と購入で同じ関数（arch §6-2）。qty によらず 1 回だけ（TS-018-07）
// - 買った改良は run.upgrades の最後に足す。並べ替えない（PR #13 のレビューの連絡 3 ②）
// - 解放の条件を満たしていない購入済みの ID（手で書き換えたデータ）は残す（Q-39 (a)）。捨てるのは知らない ID だけ（save/schema.ts）
import { PARAMS } from '../content/params.ts';
import { SPRING_BY_ID } from '../content/springs.ts';
import { UPGRADE_BY_ID, UPGRADES, isUpgradeId, type UpgradeDef, type UpgradeId } from '../content/upgrades.ts';
import { gt, num } from './num.ts';
import type { GameState } from './state.ts';

/** 深さの条件として届く上限（伝説の源泉 500m の 2 倍。推定。届かない条件を内容定義の検査で落とすため） */
export const UPGRADE_DEPTH_REACHABLE = 1_000;

/** 解放されているか */
export function upgradeUnlocked(s: Readonly<GameState>, def: Readonly<UpgradeDef>): boolean {
  const u = def.unlock;
  if (u.kind === 'depth') return s.run.maxDepth >= u.depth;
  return (s.run.springs[u.spring]?.pump ?? 0) >= u.level;
}

export const upgradeBought = (s: Readonly<GameState>, id: UpgradeId): boolean => s.run.upgrades.includes(id);

export type UpgradeState = 'affordable' | 'insufficient' | 'locked' | 'maxed';

export interface UpgradeQuote {
  state: UpgradeState;
  /** 買う数（affordable・insufficient で 1、ほかは 0） */
  n: number;
  /** 一度きりのコスト（Decimal） */
  cost: ReturnType<typeof num>;
  /** 購入済みなら 1 */
  level: number;
  /** 深さの条件で未解放のときの解放の深さ（ポンプの条件では出さない） */
  unlockDepth?: number;
}

/** 改良 1 つの見積もり（buyQuote が使う） */
export function upgradeQuote(s: Readonly<GameState>, id: UpgradeId): UpgradeQuote {
  // 型を外れた ID（'upgrade:foo' を as で渡す・prototype の名前）でも例外にせず、買えない（locked）として返す。
  // buyQuote は core の公開の関数で、T3 の UI から直接呼ばれるため（dispatch は isItemId で先に止める。PR #62 のレビュー N-3）
  if (!isUpgradeId(id)) return { state: 'locked', n: 0, cost: num(0), level: 0 };
  const def = UPGRADE_BY_ID[id];
  const cost = num(def.cost);
  if (upgradeBought(s, id)) return { state: 'maxed', n: 0, cost, level: 1 };
  if (!upgradeUnlocked(s, def)) {
    return def.unlock.kind === 'depth'
      ? { state: 'locked', n: 0, cost, level: 0, unlockDepth: def.unlock.depth }
      : { state: 'locked', n: 0, cost, level: 0 };
  }
  return { state: gt(cost, s.run.coins) ? 'insufficient' : 'affordable', n: 1, cost, level: 0 };
}

/** T3 に渡す値（解放済みか購入済みの改良だけ。内容定義の順。状態とコストは buyQuote と同じ見積もり。TS-018-15） */
export interface UpgradeView {
  readonly id: UpgradeId;
  readonly state: UpgradeState;
  readonly cost: ReturnType<typeof num>;
  readonly bought: boolean;
}

export function upgradeViews(s: Readonly<GameState>): UpgradeView[] {
  const out: UpgradeView[] = [];
  for (const def of UPGRADES) {
    const q = upgradeQuote(s, def.id);
    if (q.state === 'locked') continue;
    out.push({ id: def.id, state: q.state, cost: q.cost, bought: q.state === 'maxed' });
  }
  return out;
}

/** まだ解放されていない改良のうち、最も近い解放の条件（T3 の案内。深さの条件だけを見る。なければ null） */
export function nextUpgradeDepth(s: Readonly<GameState>): number | null {
  let best: number | null = null;
  for (const def of UPGRADES) {
    if (def.unlock.kind !== 'depth' || upgradeUnlocked(s, def) || upgradeBought(s, def.id)) continue;
    if (best === null || def.unlock.depth < best) best = def.unlock.depth;
  }
  return best;
}

/**
 * 内容定義の検査（起動時の contentProblems から呼ぶ。TS-018-02）: ID の重複・知らない源泉・届かない条件・正でないコスト、
 * 同じ組（同じ源泉のポンプの条件どうし・深さの条件どうし）の中で、条件が後のものほどコストが同じか高いこと（Q-39 (b)）
 */
export function upgradeProblems(defs: readonly UpgradeDef[] = UPGRADES): string[] {
  const p: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) p.push(`upgrades: ${d.id} の ID が重複`);
    seen.add(d.id);
    if (!(Number.isFinite(d.cost) && d.cost > 0)) p.push(`upgrades: ${d.id} のコストが正の有限の数でない`);
    const u = d.unlock;
    if (u.kind === 'depth') {
      if (!(Number.isFinite(u.depth) && u.depth > 0 && u.depth <= UPGRADE_DEPTH_REACHABLE)) p.push(`upgrades: ${d.id} の深さの条件に届かない`);
    } else {
      if (!Object.hasOwn(SPRING_BY_ID, u.spring)) p.push(`upgrades: ${d.id} の源泉 ${u.spring} がない`);
      if (!(Number.isInteger(u.level) && u.level > 0 && u.level <= PARAMS.levelMax)) p.push(`upgrades: ${d.id} のポンプの Lv の条件に届かない`);
    }
    if (d.effect.kind === 'springIncome' && !Object.hasOwn(SPRING_BY_ID, d.effect.spring)) p.push(`upgrades: ${d.id} の効果の源泉 ${d.effect.spring} がない`);
  }
  // 同じ組の中のコストの単調性
  const groups = new Map<string, { at: number; cost: number; id: string }[]>();
  for (const d of defs) {
    const key = d.unlock.kind === 'depth' ? 'depth' : `pump:${d.unlock.spring}`;
    const at = d.unlock.kind === 'depth' ? d.unlock.depth : d.unlock.level;
    const g = groups.get(key) ?? [];
    g.push({ at, cost: d.cost, id: d.id });
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    const sorted = [...g].sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (b.at > a.at && b.cost < a.cost) p.push(`upgrades: ${key} の組で ${b.id} の条件が ${a.id} より後なのにコストが安い`);
    }
  }
  return p;
}
