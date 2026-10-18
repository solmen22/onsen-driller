// バランス用のボット（gdd §8-2。BL-031: 標準・アクティブ・放置の 3 本。BL-032: 安い順・ランダム。広告なし・構成別は BL-058・S3 の転生の後）。
// ボットは core のアクション（dispatch）だけで遊ぶ。判断に使う見積もりは状態を一時的に変えて測り、必ず元に戻す
import {
  autoDiggerHitsPerSec,
  autoDigUnlocked,
  bathIncomePerSec,
  blockHp,
  blockValue,
  buyQuote,
  computeGuests,
  dispatch,
  hash32,
  drillPower,
  modifiers,
  num,
  nextTool,
  seedSfc32,
  sfc32Int,
  yunohanaGain,
  type GameEvent,
  type GameState,
  type LevelItem,
  type UpgradeId,
  type Num,
  type Sfc32State,
} from '../../src/core/index.ts';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, type SpringId } from '../../src/content/springs.ts';
import { UPGRADES } from '../../src/content/upgrades.ts';

/** ボットが買う品目（道具は別に扱う）。改良は一度きり（BL-018。TS-018-17） */
type BotItem = LevelItem | `upgrade:${UpgradeId}`;

export type BotId = 'standard' | 'active' | 'idle' | 'cheapest' | 'random';

/**
 * 手動の打撃の入れ方（gdd §8-2 の「タップ」の列）
 * - autoDig: 自動掘り（毎秒 2 打）。最初の強化（ツルハシ）の前は tapsBefore 回/秒のタップ（Q-03）
 * - hold: 長押し（毎秒 4 打）を最初から続ける
 * - taps: 毎秒 perSec 回のタップだけ（自動掘りは使わない）
 */
export type ManualInput = { kind: 'autoDig'; tapsBefore: number } | { kind: 'hold' } | { kind: 'taps'; perSec: number };

export interface BotDef {
  id: BotId;
  manual: ManualInput;
  /** 買い物の間隔（プレイ時間の秒） */
  buyEverySec: number;
  /**
   * 買い方（gdd §8-2 の「買い方」の列）
   * - efficiency: 投資効率が最大のもの（最良が買えなければ、効率が最良の 50% 以上で買えるもの）
   * - cheapest: いちばん安いもの（買えるまで待つ）
   * - random: 買えるもの（道具・候補）から無作為（ボットの乱数。シード固定。詰み・例外の検出用）
   */
  buy: 'efficiency' | 'cheapest' | 'random';
  /** ご褒美（BL-058）の受け取り方。ads＝広告で毎回、none＝受け取らない、random＝無作為。BL-058 が入るまでは使わない */
  rewards: 'ads' | 'none' | 'random';
}

/** gdd §8-2 のボット（BL-031 の 3 本と、BL-032 の安い順・ランダム） */
export const BOTS: Readonly<Record<BotId, BotDef>> = {
  standard: { id: 'standard', manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, buy: 'efficiency', rewards: 'ads' },
  active: { id: 'active', manual: { kind: 'hold' }, buyEverySec: 2, buy: 'efficiency', rewards: 'ads' },
  idle: { id: 'idle', manual: { kind: 'taps', perSec: 0.3 }, buyEverySec: 60, buy: 'efficiency', rewards: 'none' },
  cheapest: { id: 'cheapest', manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, buy: 'cheapest', rewards: 'none' },
  random: { id: 'random', manual: { kind: 'taps', perSec: 1 }, buyEverySec: 10, buy: 'random', rewards: 'random' },
};

/** ランダムのボットの乱数のシードに混ぜる値（ゲームの乱数と別の列にする） */
const BOT_RNG_SALT = 0x626f7473;

export interface BotMemory {
  lastGain: number;
  lastMaxDepth: number;
  lastDepthChangeMs: number;
  /** タップの端数（taps と autoDig の最初の強化の前） */
  tapAcc: number;
  /** ボットの乱数（random の買い方だけが使う。ゲームの状態の乱数とは別。シードから決まる） */
  rng: Sfc32State;
}

export const newBotMemory = (seed = 0): BotMemory => ({
  lastGain: 0,
  lastMaxDepth: 0,
  lastDepthChangeMs: 0,
  tapAcc: 0,
  rng: seedSfc32(hash32(seed >>> 0, BOT_RNG_SALT)),
});

/** このボットの手動の打数/秒（見積もり用。上限 8/秒は core が掛ける） */
export function manualHitsPerSec(s: GameState, bot: BotDef): number {
  const m = bot.manual;
  if (m.kind === 'hold') return PARAMS.input.holdPerSec;
  if (m.kind === 'taps') return Math.min(PARAMS.input.manualMaxPerSec, m.perSec);
  return autoDigUnlocked(s) ? PARAMS.input.autoDigPerSec : Math.min(PARAMS.input.manualMaxPerSec, m.tapsBefore);
}

/**
 * 1 ブロックの価値の期待値の倍率（鉱石でないブロックの価値に対して）: 1 + 出現率 × (鉱石の倍率 × 鉱石の価値の倍率 − 1)。
 * 鉱石の価値の倍率（m.oreValue: 硫黄泉、BL-018 の選鉱ざる・研磨台）を入れないと、その効果が見積もりで 0 になる
 */
export const avgOre = (oreValue: number): number => 1 + PARAMS.block.oreChance * (PARAMS.block.oreMult * oreValue - 1);

/** 掘削と入湯料を合わせた 1 秒あたりの収入の見積もり（このボットの打ち方で。鉱石は出現率の期待値） */
export function totalRate(s: GameState, bot: BotDef): Num {
  const m = modifiers(s);
  const d = s.run.depth;
  const hits = manualHitsPerSec(s, bot) + autoDiggerHitsPerSec(s, m);
  const dig = drillPower(s, m).mul(hits).div(blockHp(s, d, m)).mul(blockValue(s, d, false, m)).mul(avgOre(m.oreValue));
  return dig.add(bathIncomePerSec(s, m));
}

/** 状態を一時的に変えて fn を測り、元に戻す（お客さんは条件から決め直してから測る。Lv10 のポンプで来るお客さんの分を見積もりに入れる） */
function measure<T>(s: GameState, change: () => () => void, fn: () => T): T {
  const guests = s.run.guests;
  const undo = change();
  s.run.guests = computeGuests(s);
  const v = fn();
  undo();
  s.run.guests = guests;
  return v;
}

function levelUp(s: GameState, item: BotItem): () => void {
  const r = s.run;
  if (item.startsWith('upgrade:')) {
    // 仮に買った状態にして収入の差を測る（最後に足して、測った後に外す）
    r.upgrades.push(item.slice(8) as UpgradeId);
    return () => void r.upgrades.pop();
  }
  if (item === 'drill') {
    r.drill.level++;
    return () => void r.drill.level--;
  }
  if (item === 'autoDigger') {
    r.autoDig.level++;
    return () => void r.autoDig.level--;
  }
  if (item === 'bath') {
    r.bath.level++;
    return () => void r.bath.level--;
  }
  const sp = r.springs[item.slice(5) as SpringId];
  if (!sp) return () => undefined;
  sp.pump++;
  return () => void sp.pump--;
}

/** 買う候補（ドリル・自動掘削機・湯船・枠につないだ源泉のポンプ・まだ買っていない改良。つないでいないポンプは収入が増えないので入れない） */
function candidates(s: GameState): BotItem[] {
  const items: BotItem[] = ['drill', 'autoDigger', 'bath'];
  for (const id of s.run.bath.slots) if (id) items.push(`pump:${id}`);
  for (const u of UPGRADES) if (!s.run.upgrades.includes(u.id)) items.push(`upgrade:${u.id}`); // 未解放は buyQuote が locked で外す
  return items;
}

/** k 個の組み合わせ（SPRINGS の順。n は最大 5 なので数は少ない） */
function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...rest] = xs as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

/**
 * 枠につなぐ源泉の集合を、収入（掘削＋入湯料。泉質の効果とお客さんを含む）が最大になる組み合わせにする（gdd §8-2）。
 * 見つけた源泉が枠の数以下なら全部つなぐ。すでにつないである源泉はその枠に残し、足りない分を空き・外す枠に入れる
 */
export function arrangeSlots(s: GameState, bot: BotDef, out?: GameEvent[]): void {
  const found = SPRINGS.filter((sp) => s.run.springs[sp.id]).map((sp) => sp.id);
  const n = s.run.bath.slots.length;
  let want: SpringId[];
  if (found.length <= n) want = found;
  else {
    let best: { set: SpringId[]; rate: Num } | null = null;
    for (const set of combinations(found, n)) {
      const rate = measure(
        s,
        () => {
          const before = s.run.bath.slots;
          s.run.bath.slots = [...set];
          return () => void (s.run.bath.slots = before);
        },
        () => totalRate(s, bot),
      );
      if (!best || rate.gt(best.rate)) best = { set, rate };
    }
    want = best?.set ?? found.slice(0, n);
  }
  const slots = s.run.bath.slots;
  const missing = want.filter((id) => !slots.includes(id));
  for (const id of missing) {
    const free = slots.findIndex((x) => x === null || !want.includes(x));
    if (free < 0) break;
    act(s, { type: 'assignSlot', slot: free, spring: id }, out);
  }
}

/** アクションを実行し、起きたイベントを out に足す（マイルストーンの記録のため。sim.ts） */
function act(s: GameState, a: unknown, out: GameEvent[] | undefined): ReturnType<typeof dispatch> {
  const res = dispatch(s, a);
  if (out) for (const e of res.events) out.push(e);
  return res;
}

/** 手動の打撃の状態をボットの打ち方に合わせる（長押し・自動掘りのスイッチ） */
function setInput(s: GameState, bot: BotDef, out?: GameEvent[]): void {
  const hold = bot.manual.kind === 'hold';
  if (s.input.hold !== hold) act(s, { type: 'hold', on: hold }, out);
  const auto = bot.manual.kind === 'autoDig';
  if (s.run.autoDig.on !== auto && (!auto || autoDigUnlocked(s))) act(s, { type: 'setAutoDig', on: auto }, out);
}

/**
 * ステップごとのタップ（taps のボットと、autoDig のボットの最初の強化の前）。
 * ステップの終わりの時刻に、毎秒 perSec 回を等間隔に入れる（端数は次のステップへ）
 */
export function botTap(s: GameState, bot: BotDef, mem: BotMemory, stepMs: number, out?: GameEvent[]): void {
  const m = bot.manual;
  const perSec = m.kind === 'taps' ? m.perSec : m.kind === 'autoDig' && !autoDigUnlocked(s) ? m.tapsBefore : 0;
  if (!(perSec > 0)) return;
  mem.tapAcc += (perSec * stepMs) / 1000;
  const n = Math.floor(mem.tapAcc + 1e-9);
  mem.tapAcc -= n;
  if (n > 0) act(s, { type: 'tap', count: n }, out);
}

/** 転生の規則（gdd §8-2）: 湯の華が前回の 1.5 倍以上（初回は転生の推奨の 30 以上）、または最深の伸びが 2 分止まった */
function maybePrestige(s: GameState, mem: BotMemory, out?: GameEvent[]): boolean {
  const gain = yunohanaGain(s).toNumber();
  if (!(gain > 0)) return false;
  const target = Math.max(PARAMS.prestige.recommendGain, mem.lastGain * PARAMS.prestige.recommendGrowth); // T4 の推奨と同じ規則（ボットは ceil しないが、湯の華は整数なので同じ判定）
  const stalled = s.clock.playedMs - mem.lastDepthChangeMs >= 120_000;
  if (!(gain >= target || (stalled && gain >= Math.max(9, mem.lastGain)))) return false;
  act(s, { type: 'prestige' }, out);
  mem.lastGain = gain;
  mem.lastMaxDepth = 0;
  mem.lastDepthChangeMs = s.clock.playedMs;
  return true;
}

/**
 * ボットの 1 回の判断（転生・道具・枠・買い物）。時刻は s.clock.playedMs だけを見る。起きたイベントは out に足す（省略可）。
 * 買い方（gdd §8-2）: 投資効率（増える収入 ÷ コスト）が最大のものを買う。最良が買えなければ、効率が最良の 50% 以上で買えるものを買う。
 * 道具の進化は買えるようになったらすぐ買う
 */
export function botAct(s: GameState, bot: BotDef, mem: BotMemory, out?: GameEvent[]): void {
  const r = s.run;
  setInput(s, bot, out);
  if (r.maxDepth !== mem.lastMaxDepth) {
    mem.lastMaxDepth = r.maxDepth;
    mem.lastDepthChangeMs = s.clock.playedMs;
  }
  if (maybePrestige(s, mem, out)) {
    setInput(s, bot, out);
    return;
  }
  if (bot.buy === 'cheapest') return buyCheapest(s, bot, out);
  if (bot.buy === 'random') return buyRandom(s, bot, mem, out);
  for (let i = 0; i < 40; i++) {
    const t = nextTool(s);
    if (t && r.coins.gte(t.cost)) {
      act(s, { type: 'buy', item: 'tool', qty: 1 }, out);
      setInput(s, bot, out); // ツルハシで自動掘りが使えるようになる
      continue;
    }
    arrangeSlots(s, bot, out);
    const pick = pickByEfficiency(scoreCandidates(s, bot));
    if (pick === null) break;
    if (!act(s, { type: 'buy', item: pick, qty: 1 }, out).ok) break;
  }
}

/** 投資効率で買うボットの候補 1 つ（score＝増える収入 ÷ コスト。affordable は今のコインで買えるか） */
export interface ScoredCandidate<T> {
  item: T;
  score: number;
  affordable: boolean;
}

/** 候補（未解放・上限は除く）ごとの投資効率を測る（状態は変えない）。並びは candidates の順 */
export function scoreCandidates(s: GameState, bot: BotDef): ScoredCandidate<BotItem>[] {
  const base = totalRate(s, bot);
  const out: ScoredCandidate<BotItem>[] = [];
  for (const item of candidates(s)) {
    const q = buyQuote(s, item, 1);
    if (q.state === 'locked' || q.state === 'maxed') continue;
    const gain = measure(s, () => levelUp(s, item), () => totalRate(s, bot)).sub(base);
    out.push({ item, score: gain.div(q.cost).toNumber(), affordable: q.state === 'affordable' });
  }
  return out;
}

/**
 * 買うものを決める（gdd §8-2。TS-031-02）: 効率が最良のものが買えればそれ。買えなければ、買えるもののうち効率が最良のもので、
 * その効率が最良の 50% 以上なら買う（ちょうど 50% は買う）。50% 未満か、買えるものがなければ null（コインを残して待つ）。
 * 同じ効率なら先の候補
 */
export function pickByEfficiency<T>(cands: readonly ScoredCandidate<T>[]): T | null {
  let best: ScoredCandidate<T> | null = null;
  let bestAffordable: ScoredCandidate<T> | null = null;
  for (const c of cands) {
    if (!best || c.score > best.score) best = c;
    if (c.affordable && (!bestAffordable || c.score > bestAffordable.score)) bestAffordable = c;
  }
  if (!best || !bestAffordable) return null;
  if (!best.affordable && bestAffordable.score < best.score * 0.5) return null;
  return bestAffordable.item;
}

/**
 * 安い順（gdd §8-2）: 道具と候補のうち、いちばん安いものを買う。それが買えなければ待つ（ほかの安くないものは買わない）。
 * 枠は標準と同じ（収入が最大の組み合わせ）
 */
function buyCheapest(s: GameState, bot: BotDef, out?: GameEvent[]): void {
  for (let i = 0; i < 40; i++) {
    arrangeSlots(s, bot, out);
    let best: { item: BotItem | 'tool'; cost: Num; affordable: boolean } | null = null;
    const t = nextTool(s);
    if (t) best = { item: 'tool', cost: num(t.cost), affordable: s.run.coins.gte(t.cost) };
    for (const item of candidates(s)) {
      const q = buyQuote(s, item, 1);
      if (q.state === 'locked' || q.state === 'maxed') continue;
      if (!best || q.cost.lt(best.cost)) best = { item, cost: q.cost, affordable: q.state === 'affordable' };
    }
    if (!best?.affordable) return;
    if (!act(s, { type: 'buy', item: best.item, qty: 1 }, out).ok) return;
    if (best.item === 'tool') setInput(s, bot, out);
  }
}

/**
 * ランダム（gdd §8-2）: 買えるもの（道具・候補）から無作為に 1 つずつ、買えるものがなくなるまで買う（1 回の判断で最大 40）。
 * 枠も無作為: 見つけた源泉から 1 つを無作為な枠につなぐ（つないである源泉なら何もしない）。詰み・例外の検出用
 */
function buyRandom(s: GameState, bot: BotDef, mem: BotMemory, out?: GameEvent[]): void {
  const found = SPRINGS.filter((sp) => s.run.springs[sp.id]).map((sp) => sp.id);
  if (found.length > 0) {
    const id = found[sfc32Int(mem.rng, 0, found.length - 1)]!;
    const slot = sfc32Int(mem.rng, 0, s.run.bath.slots.length - 1);
    if (!s.run.bath.slots.includes(id)) act(s, { type: 'assignSlot', slot, spring: id }, out);
  }
  for (let i = 0; i < 40; i++) {
    const options: (BotItem | 'tool')[] = [];
    const t = nextTool(s);
    if (t && s.run.coins.gte(t.cost)) options.push('tool');
    for (const item of candidates(s)) if (buyQuote(s, item, 1).state === 'affordable') options.push(item);
    if (options.length === 0) return;
    const item = options[sfc32Int(mem.rng, 0, options.length - 1)]!;
    if (!act(s, { type: 'buy', item, qty: 1 }, out).ok) return;
    if (item === 'tool') setInput(s, bot, out);
  }
}

/** 何か 1 つでも買えるか（空白時間 #14〜#16 の判定。道具・候補のどれか） */
export function canBuyAnything(s: GameState): boolean {
  const t = nextTool(s);
  if (t && s.run.coins.gte(t.cost)) return true;
  return candidates(s).some((item) => buyQuote(s, item, 1).state === 'affordable');
}
