// アクション（arch §6-2 の PoC 版）。買えないときは状態を変えない。
import { PARAMS } from '../content/params.ts';
import { SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import type { GameEvent } from './events.ts';
import { nextTool, slotsForBathLevel, yunohanaGain } from './formulas.ts';
import { affordGeometric, sumGeometric, type Num } from './num.ts';
import { sfc32Next } from './rng.ts';
import { createRun, type GameState } from './state.ts';
import { applyHits, refreshGuests } from './step.ts';

export type LevelItem = 'drill' | 'autoDigger' | 'bath' | `pump:${SpringId}`;
export type ItemId = LevelItem | 'tool';
export type Qty = 1 | 10 | 'max';

export type Action =
  | { type: 'tap'; count: number }
  | { type: 'hold'; on: boolean }
  | { type: 'setAutoDig'; on: boolean }
  | { type: 'buy'; item: ItemId; qty: Qty }
  | { type: 'assignSlot'; slot: number; spring: SpringId | null }
  | { type: 'prestige' };

export interface ActionResult {
  ok: boolean;
  reason?: string;
  events: GameEvent[];
}

const fail = (reason: string): ActionResult => ({ ok: false, reason, events: [] });

interface Series {
  c0: number;
  r: number;
  owned: number;
}

export function seriesOf(s: GameState, item: LevelItem): Series | null {
  switch (item) {
    case 'drill':
      return { c0: PARAMS.drill.c0, r: PARAMS.drill.r, owned: s.run.drill.level };
    case 'autoDigger':
      return { c0: PARAMS.autoDigger.c0, r: PARAMS.autoDigger.r, owned: s.run.autoDig.level };
    case 'bath':
      return { c0: PARAMS.bath.c0, r: PARAMS.bath.r, owned: s.run.bath.level };
    default: {
      const id = item.slice(5) as SpringId;
      const sp = s.run.springs[id];
      if (!sp) return null;
      const def = SPRING_BY_ID[id];
      return { c0: def.pumpC0, r: def.pumpR, owned: sp.pump };
    }
  }
}

/** qty に応じて買う数と合計コストを決める（表示と購入判定で同じ関数を使う） */
export function quote(s: GameState, item: LevelItem, qty: Qty): { n: number; cost: Num } | null {
  const se = seriesOf(s, item);
  if (!se) return null;
  let n = qty === 'max' ? affordGeometric(s.run.coins, se.c0, se.r, se.owned) : qty;
  if (n <= 0) n = 1;
  let cost = sumGeometric(n, se.c0, se.r, se.owned);
  // 丸めで「買えるように見えて買えない」を防ぐ: 所持金を超えたら 1 つ減らす
  while (qty === 'max' && n > 1 && cost.gt(s.run.coins)) {
    n--;
    cost = sumGeometric(n, se.c0, se.r, se.owned);
  }
  return { n, cost };
}

function addLevels(s: GameState, item: LevelItem, n: number, out: GameEvent[]): void {
  const r = s.run;
  if (item === 'drill') r.drill.level += n;
  else if (item === 'autoDigger') r.autoDig.level += n;
  else if (item === 'bath') {
    const before = slotsForBathLevel(r.bath.level);
    r.bath.level += n;
    const after = slotsForBathLevel(r.bath.level);
    for (let i = before; i < after; i++) {
      r.bath.slots.push(null);
      out.push({ type: 'SlotUnlocked', n: i + 1 });
    }
  } else {
    const sp = r.springs[item.slice(5) as SpringId];
    if (sp) sp.pump += n;
  }
}

export function dispatch(s: GameState, a: Action): ActionResult {
  const events: GameEvent[] = [];
  const r = s.run;
  switch (a.type) {
    case 'tap': {
      const n = Math.max(0, Math.min(Math.floor(a.count), PARAMS.input.tapMaxPerSec));
      applyHits(s, n, events);
      return { ok: n > 0, events };
    }
    case 'hold':
      r.hold = a.on;
      return { ok: true, events };
    case 'setAutoDig':
      r.autoDig.on = a.on;
      return { ok: true, events };
    case 'buy': {
      if (a.item === 'tool') {
        const t = nextTool(s);
        if (!t) return fail('locked');
        if (r.coins.lt(t.cost)) return fail('insufficient');
        r.coins = r.coins.sub(t.cost);
        r.drill.tool += 1;
        events.push({ type: 'ToolEvolved', tool: r.drill.tool }, { type: 'Purchased', item: 'tool', qty: 1 });
        return { ok: true, events };
      }
      const q = quote(s, a.item, a.qty);
      if (!q) return fail('locked');
      if (q.cost.gt(r.coins)) return fail('insufficient');
      r.coins = r.coins.sub(q.cost);
      addLevels(s, a.item, q.n, events);
      events.push({ type: 'Purchased', item: a.item, qty: q.n });
      refreshGuests(s, events);
      return { ok: true, events };
    }
    case 'assignSlot': {
      if (a.slot < 0 || a.slot >= r.bath.slots.length) return fail('noSlot');
      if (a.spring !== null) {
        if (!r.springs[a.spring]) return fail('notFound');
        const other = r.bath.slots.indexOf(a.spring);
        if (other >= 0) r.bath.slots[other] = r.bath.slots[a.slot] ?? null; // 入れ替え
      }
      r.bath.slots[a.slot] = a.spring;
      refreshGuests(s, events);
      return { ok: true, events };
    }
    case 'prestige': {
      const gain = yunohanaGain(s);
      if (gain.lte(0)) return fail('locked');
      s.meta.yunohanaLifetime = s.meta.yunohanaLifetime.add(gain);
      s.meta.prestiges += 1;
      s.run = createRun(sfc32Next(s.rng.run));
      events.push({ type: 'PrestigeDone', gained: gain.toString() });
      return { ok: true, events };
    }
  }
}
