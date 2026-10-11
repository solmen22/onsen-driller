// バランス用のボット（gdd §8-2。BL-031: 標準・アクティブ・放置の 3 本。広告なし・構成別・安い順・ランダムは BL-032）。
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
  drillPower,
  modifiers,
  nextTool,
  yunohanaGain,
  type GameEvent,
  type GameState,
  type LevelItem,
  type UpgradeId,
  type Num,
} from '../../src/core/index.ts';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, type SpringId } from '../../src/content/springs.ts';
import { UPGRADES } from '../../src/content/upgrades.ts';

/** ボットが買う品目（道具は別に扱う）。改良は一度きり（BL-018。TS-018-17） */
type BotItem = LevelItem | `upgrade:${UpgradeId}`;

export type BotId = 'standard' | 'active' | 'idle';

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
  /** ご褒美（BL-058）の受け取り方。ads＝広告で毎回、none＝受け取らない。BL-058 が入るまでは使わない */
  rewards: 'ads' | 'none';
}

/** gdd §8-2 の 3 本（BL-031） */
export const BOTS: Readonly<Record<BotId, BotDef>> = {
  standard: { id: 'standard', manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, rewards: 'ads' },
  active: { id: 'active', manual: { kind: 'hold' }, buyEverySec: 2, rewards: 'ads' },
  idle: { id: 'idle', manual: { kind: 'taps', perSec: 0.3 }, buyEverySec: 60, rewards: 'none' },
};

export interface BotMemory {
  lastGain: number;
  lastMaxDepth: number;
  lastDepthChangeMs: number;
  /** タップの端数（taps と autoDig の最初の強化の前） */
  tapAcc: number;
}

export const newBotMemory = (): BotMemory => ({ lastGain: 0, lastMaxDepth: 0, lastDepthChangeMs: 0, tapAcc: 0 });

/** このボットの手動の打数/秒（見積もり用。上限 8/秒は core が掛ける） */
export function manualHitsPerSec(s: GameState, bot: BotDef): number {
  const m = bot.manual;
  if (m.kind === 'hold') return PARAMS.input.holdPerSec;
  if (m.kind === 'taps') return Math.min(PARAMS.input.manualMaxPerSec, m.perSec);
  return autoDigUnlocked(s) ? PARAMS.input.autoDigPerSec : Math.min(PARAMS.input.manualMaxPerSec, m.tapsBefore);
}

/** 1 ブロックの価値の期待値の倍率（鉱石の出現率 × 鉱石の倍率 × 鉱石の価値の倍率。改良の選鉱ざる・研磨台、硫黄泉を見積もりに入れる。BL-018） */
const avgOre = (oreValue: number): number => 1 + PARAMS.block.oreChance * (PARAMS.block.oreMult * oreValue - 1);

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
  const target = Math.max(30, mem.lastGain * 1.5);
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
  for (let i = 0; i < 40; i++) {
    const t = nextTool(s);
    if (t && r.coins.gte(t.cost)) {
      act(s, { type: 'buy', item: 'tool', qty: 1 }, out);
      setInput(s, bot, out); // ツルハシで自動掘りが使えるようになる
      continue;
    }
    arrangeSlots(s, bot, out);
    const base = totalRate(s, bot);
    let best: { item: BotItem; score: number; affordable: boolean } | null = null;
    let bestAffordable: { item: BotItem; score: number } | null = null;
    for (const item of candidates(s)) {
      const q = buyQuote(s, item, 1);
      if (q.state === 'locked' || q.state === 'maxed') continue;
      const gain = measure(s, () => levelUp(s, item), () => totalRate(s, bot)).sub(base);
      const score = gain.div(q.cost).toNumber();
      const affordable = q.state === 'affordable';
      if (!best || score > best.score) best = { item, score, affordable };
      if (affordable && (!bestAffordable || score > bestAffordable.score)) bestAffordable = { item, score };
    }
    if (!best || !bestAffordable) break;
    if (!best.affordable && bestAffordable.score < best.score * 0.5) break;
    if (!act(s, { type: 'buy', item: bestAffordable.item, qty: 1 }, out).ok) break;
  }
}

/** 何か 1 つでも買えるか（空白時間 #14〜#16 の判定。道具・候補のどれか） */
export function canBuyAnything(s: GameState): boolean {
  const t = nextTool(s);
  if (t && s.run.coins.gte(t.cost)) return true;
  return candidates(s).some((item) => buyQuote(s, item, 1).state === 'affordable');
}
