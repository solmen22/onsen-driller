// バランス用のボット（gdd §8-2 の PoC 版。アクティブ・標準・放置の 3 種）
import {
  autoDigUnlocked,
  blockHp,
  blockValue,
  dispatch,
  drillPower,
  hitsPerSec,
  bathIncomePerSec,
  nextTool,
  buyQuote,
  springIncome,
  yunohanaGain,
  type GameState,
  type LevelItem,
  type Num,
} from '../../src/core/index.ts';
import { PARAMS } from '../../src/content/params.ts';
import type { SpringId } from '../../src/content/springs.ts';

export interface BotDef {
  id: string;
  hold: boolean;
  autoDig: boolean;
  /** 自動掘りが使えるようになるまで（最初の強化の前。Q-03）の毎秒のタップ数（標準の入力は毎秒 2 打。Q-02） */
  tapsUntilAuto: number;
  /** 買い物の間隔（プレイ時間の秒） */
  buyEverySec: number;
}

export const BOTS: Readonly<Record<'active' | 'standard' | 'idle', BotDef>> = {
  active: { id: 'active', hold: true, autoDig: true, tapsUntilAuto: 0, buyEverySec: 2 },
  standard: { id: 'standard', hold: false, autoDig: true, tapsUntilAuto: 2, buyEverySec: 5 },
  idle: { id: 'idle', hold: false, autoDig: true, tapsUntilAuto: 2, buyEverySec: 60 },
};

export interface BotMemory {
  lastGain: number;
  lastMaxDepth: number;
  lastDepthChangeMs: number;
}

export const newBotMemory = (): BotMemory => ({ lastGain: 0, lastMaxDepth: 0, lastDepthChangeMs: 0 });

const AVG_ORE = 1 + PARAMS.block.oreChance * (PARAMS.block.oreMult - 1);

/** 掘削と入湯料を合わせた 1 秒あたりの収入の見積もり */
export function totalRate(s: GameState): Num {
  const d = s.run.depth;
  const dig = drillPower(s).mul(hitsPerSec(s)).div(blockHp(s, d)).mul(blockValue(s, d, false)).mul(AVG_ORE);
  return dig.add(bathIncomePerSec(s));
}

function withLevel<T>(s: GameState, item: LevelItem, fn: () => T): T {
  const r = s.run;
  if (item === 'drill') {
    r.drill.level++;
    const v = fn();
    r.drill.level--;
    return v;
  }
  if (item === 'autoDigger') {
    r.autoDig.level++;
    const v = fn();
    r.autoDig.level--;
    return v;
  }
  if (item === 'bath') {
    r.bath.level++;
    const v = fn();
    r.bath.level--;
    return v;
  }
  const sp = r.springs[item.slice(5) as SpringId];
  if (!sp) return fn();
  sp.pump++;
  const v = fn();
  sp.pump--;
  return v;
}

function candidates(s: GameState): LevelItem[] {
  const items: LevelItem[] = ['drill', 'autoDigger', 'bath'];
  for (const id of s.run.bath.slots) if (id) items.push(`pump:${id}`);
  return items;
}

/** 発見済みの源泉のうち、入湯料が大きい順に枠へつなぐ */
function arrangeSlots(s: GameState): void {
  const found = Object.keys(s.run.springs) as SpringId[];
  const n = s.run.bath.slots.length;
  if (found.length <= n) {
    for (const id of found) {
      if (!s.run.bath.slots.includes(id)) {
        const empty = s.run.bath.slots.indexOf(null);
        if (empty >= 0) dispatch(s, { type: 'assignSlot', slot: empty, spring: id });
      }
    }
    return;
  }
  const ranked = [...found].sort((a, b) => springIncome(s, b).cmp(springIncome(s, a)));
  const want = ranked.slice(0, n);
  want.forEach((id, i) => {
    if (s.run.bath.slots[i] !== id) dispatch(s, { type: 'assignSlot', slot: i, spring: id });
  });
}

/** ボットの 1 回の判断（買い物・枠・転生）。時刻は s.clock.playedMs だけを見る */
export function botAct(s: GameState, bot: BotDef, mem: BotMemory): void {
  const r = s.run;
  if (s.input.hold !== bot.hold) dispatch(s, { type: 'hold', on: bot.hold });
  if (r.autoDig.on !== bot.autoDig && (!bot.autoDig || autoDigUnlocked(s))) dispatch(s, { type: 'setAutoDig', on: bot.autoDig });

  if (r.maxDepth !== mem.lastMaxDepth) {
    mem.lastMaxDepth = r.maxDepth;
    mem.lastDepthChangeMs = s.clock.playedMs;
  }
  // 転生: 湯の華が前回の 1.5 倍以上（初回は 30 以上）、または最深の伸びが 2 分止まった
  const gain = yunohanaGain(s).toNumber();
  if (gain > 0) {
    const target = Math.max(30, mem.lastGain * 1.5);
    const stalled = s.clock.playedMs - mem.lastDepthChangeMs >= 120_000;
    if (gain >= target || (stalled && gain >= Math.max(9, mem.lastGain))) {
      dispatch(s, { type: 'prestige' });
      mem.lastGain = gain;
      mem.lastMaxDepth = 0;
      mem.lastDepthChangeMs = s.clock.playedMs;
      return;
    }
  }

  for (let i = 0; i < 40; i++) {
    const t = nextTool(s);
    if (t && r.coins.gte(t.cost)) {
      dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
      continue;
    }
    arrangeSlots(s);
    // 投資効率（増える収入 ÷ コスト）が最大のもの。最良が買えなければ、最良の 50% 以上で買えるもの
    const base = totalRate(s);
    let best: { item: LevelItem; score: number; affordable: boolean } | null = null;
    let bestAffordable: { item: LevelItem; score: number } | null = null;
    for (const item of candidates(s)) {
      const q = buyQuote(s, item, 1);
      if (q.state === 'locked' || q.state === 'maxed') continue;
      const gainRate = withLevel(s, item, () => totalRate(s)).sub(base);
      const score = gainRate.div(q.cost).toNumber();
      const affordable = q.cost.lte(r.coins);
      if (!best || score > best.score) best = { item, score, affordable };
      if (affordable && (!bestAffordable || score > bestAffordable.score)) bestAffordable = { item, score };
    }
    if (!best || !bestAffordable) break;
    if (!best.affordable && bestAffordable.score < best.score * 0.5) break;
    const res = dispatch(s, { type: 'buy', item: bestAffordable.item, qty: 1 });
    if (!res.ok) break;
  }
}

