// 湯の華の木（gdd §5-8。BL-022）: ノードを取る・木の見え方・転生の振り直しの検証・周回の始めの効果
// - 取るのは「使える湯の華」（累計 − 使った分）で。取っても累計は減らない（全生産 +2%/個 は累計で決まる）
// - 前提は「どれか 1 つを取っていればよい」。前提は定義で先に来るので、定義の順に見れば 1 回で決まる
// - 振り直しは転生のときだけ（無料。使った分が全部戻る）。転生の確認の画面で選んだ木を prestige の perks で渡す
// - 周回の始めの効果（形見のツルハシ・近道の坑道・旅の支度金）は、転生で新しい周回を作った直後に当てる（startRun）
import { PERK_BY_ID, PERKS, isPerkId, type PerkDef, type PerkId } from '../content/perks.ts';
import { SPRINGS } from '../content/springs.ts';
import { STRATA } from '../content/strata.ts';
import { TOOLS } from '../content/tools.ts';
import type { GameEvent } from './events.ts';
import { perkTotals, yunohanaGain } from './formulas.ts';
import { add, num, sub, type Num } from './num.ts';
import type { GameState } from './state.ts';
import { discoverSpring, markStratumSeen } from './step.ts';

/** 使える湯の華（累計 − 使った分。負にならない） */
export function yunohanaAvailable(s: Readonly<GameState>): Num {
  const a = sub(s.meta.yunohana.lifetime, s.meta.yunohana.spent);
  return a.gt(0) ? a : num(0);
}

const requiresMet = (p: PerkDef, owned: ReadonlySet<PerkId> | readonly PerkId[]): boolean =>
  p.requiresAny.length === 0 || p.requiresAny.some((r) => ('has' in owned ? owned.has(r) : owned.includes(r)));

/** ノードの状態: owned（取った）・available（取れる）・insufficient（前提は満たすが湯の華が足りない）・locked（前提を満たさない） */
export type PerkNodeState = 'owned' | 'available' | 'insufficient' | 'locked';

export interface PerkNodeView {
  id: PerkId;
  state: PerkNodeState;
  cost: number;
  /** 前提（どれか 1 つ）。木の線と「〇〇 か △△ を取ると取れる」の案内に使う */
  requiresAny: readonly PerkId[];
  /** いつ効くか: now（取ったらすぐ）・nextRun（次の周回の始めから。形見のツルハシ・近道の坑道・旅の支度金）。UI は「次の周回から」と添える */
  appliesFrom: 'now' | 'nextRun';
}

const START_KINDS = new Set(['startTool', 'startDepth', 'startCoins']);
const appliesFrom = (p: PerkDef): 'now' | 'nextRun' => (p.effects.every((e) => START_KINDS.has(e.kind)) ? 'nextRun' : 'now');

export interface PerkTreeView {
  /** 使える湯の華 */
  available: Num;
  /** 使った湯の華（取ったノードのコストの合計） */
  spent: Num;
  nodes: PerkNodeView[];
}

/**
 * 木の画面に出す値（UI は式を持たない）。
 * plan を渡すと「転生の確認の画面で振り直している途中の木」として見る（予算は転生した後の累計。plan を取ったことにする）。
 * plan が正しくない（前提を満たさない・予算を超える）ときは null（UI は直前の正しい plan に戻す）
 */
export function perkTreeView(s: Readonly<GameState>, plan?: readonly PerkId[]): PerkTreeView | null {
  let owned: ReadonlySet<PerkId>;
  let available: Num;
  let spent: Num;
  if (plan === undefined) {
    owned = new Set(s.meta.perks);
    available = yunohanaAvailable(s);
    spent = s.meta.yunohana.spent;
  } else {
    const budget = s.meta.yunohana.lifetime.add(yunohanaGain(s));
    const ok = checkPerkSet(plan, budget);
    if (!ok) return null;
    owned = new Set(ok.perks);
    spent = num(ok.cost);
    available = num(budget.sub(ok.cost));
  }
  return {
    available,
    spent,
    nodes: PERKS.map((p) => ({
      id: p.id,
      cost: p.cost,
      requiresAny: p.requiresAny,
      appliesFrom: appliesFrom(p),
      state: owned.has(p.id) ? 'owned' : !requiresMet(p, owned) ? 'locked' : available.gte(p.cost) ? 'available' : 'insufficient',
    })),
  };
}

export interface RunStartPreview {
  /** 次の周回の始めの深さ（近道の坑道。なければ 0） */
  depth: number;
  /** 始めのコイン（旅の支度金。なければ 0） */
  coins: number;
  /** 始めの道具（TOOLS の index。形見のツルハシで 2） */
  tool: number;
}

/** 木の合計と前の周回の最深から、次の周回の始めを決める（確認の画面の見込みと、実際の周回の始めで同じ式） */
function startOf(t: ReturnType<typeof perkTotals>, prevMaxDepth: number): RunStartPreview {
  return {
    depth: t.startDepthFrac > 0 && Number.isFinite(prevMaxDepth) ? Math.max(0, Math.floor(prevMaxDepth * t.startDepthFrac)) : 0,
    coins: t.startCoins,
    tool: Math.min(Math.max(0, t.startTool), TOOLS.length - 1),
  };
}

/** 今転生したときの次の周回の始め（確認の画面の「次は 162m から」など）。perks を渡すと、その木で見る（振り直しの途中） */
export function runStartPreview(s: Readonly<GameState>, perks: readonly PerkId[] = s.meta.perks): RunStartPreview {
  return startOf(perkTotals({ ...s, meta: { ...s.meta, perks: [...perks] } }), s.run.maxDepth);
}

export type TakePerkFail = 'invalid' | 'maxed' | 'locked' | 'insufficient';

/** ノードを 1 つ取る（使える湯の華から払う）。取れなければ理由を返し、状態を変えない */
export function takePerk(s: GameState, id: unknown, out: GameEvent[]): TakePerkFail | null {
  if (typeof id !== 'string' || !isPerkId(id)) return 'invalid';
  const p = PERK_BY_ID[id];
  if (s.meta.perks.includes(id)) return 'maxed';
  if (!requiresMet(p, s.meta.perks)) return 'locked';
  if (!yunohanaAvailable(s).gte(p.cost)) return 'insufficient';
  s.meta.yunohana.spent = num(s.meta.yunohana.spent.add(p.cost));
  s.meta.perks = PERKS.filter((d) => d.id === id || s.meta.perks.includes(d.id)).map((d) => d.id); // 定義の順に並べる
  out.push({ type: 'PerkTaken', perk: id, cost: p.cost });
  return null;
}

/**
 * 振り直した木（転生の確認の画面で選んだもの）を検証する。知らない ID・重複・前提を満たさないノード・合計が budget を超えるものは null。
 * 正しければ定義の順に並べた ID とコストの合計を返す
 */
export function checkPerkSet(ids: unknown, budget: Num): { perks: PerkId[]; cost: number } | null {
  if (!Array.isArray(ids) || ids.length > PERKS.length) return null;
  const want = new Set<PerkId>();
  for (const x of ids) {
    if (typeof x !== 'string' || !isPerkId(x) || want.has(x)) return null;
    want.add(x);
  }
  const perks: PerkId[] = [];
  let cost = 0;
  for (const p of PERKS) {
    if (!want.has(p.id)) continue;
    if (!requiresMet(p, perks)) return null;
    perks.push(p.id);
    cost += p.cost;
  }
  return budget.gte(cost) ? { perks, cost } : null;
}

/**
 * 新しい周回の始めに木の効果を当てる（転生の直後。prevMaxDepth は前の周回の最深）
 * - 旅の支度金: コイン 500 から
 * - 形見のツルハシ: 道具が手掘りやぐらから（買わずに持っている扱い。自動掘りのスイッチも使える）
 * - 近道の坑道: 深さ＝前の周回の最深 × 25%（切り捨て）から。途中の源泉は発見済み（ポンプ Lv1・空いた枠につなぐ）、
 *   途中の帯は入ったことにする（幕間なし）。この深さより 1m 以上掘るまで転生できない（formulas の yunohanaGainBase）
 */
export function startRun(s: GameState, prevMaxDepth: number, out: GameEvent[]): void {
  const st = startOf(perkTotals(s), prevMaxDepth);
  const r = s.run;
  if (st.coins > 0) r.coins = add(r.coins, st.coins); // 支度金は足す（稼いだコインではないので stats.totalCoins には入れない）
  if (st.tool > r.drill.tool) r.drill.tool = st.tool;
  const start = st.depth;
  if (start > 0) {
    r.depth = start;
    r.maxDepth = start;
    r.startDepth = start;
    for (const sp of SPRINGS) if (sp.depth <= start) discoverSpring(s, sp.id, false, out);
    STRATA.forEach((b, i) => {
      if (b.start <= start) markStratumSeen(s, i);
    });
  }
}
