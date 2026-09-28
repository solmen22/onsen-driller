// アクション（arch §6-2。BL-010）。どんな入力でも例外を投げず、実行できないときは { ok: false, reason } で状態を変えない
import { PARAMS } from '../content/params.ts';
import { SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import type { GameEvent } from './events.ts';
import { nextTool, slotsForBathLevel, yunohanaGain } from './formulas.ts';
import { add, affordGeometric, gt, lt, sub, sumGeometric, type Num } from './num.ts';
import { sfc32Next } from './rng.ts';
import { applyManualRateChange, autoDigUnlocked, manualRate, setHold } from './input.ts';
import { createRun, type GameState } from './state.ts';
import { refreshGuests, tapHits } from './step.ts';

export type LevelItem = 'drill' | 'autoDigger' | 'bath' | `pump:${SpringId}`;
export type ItemId = LevelItem | 'tool';
export type Qty = 1 | 10 | 'max';

export type Action =
  | { type: 'tap'; count?: number }
  | { type: 'hold'; on: boolean }
  | { type: 'setAutoDig'; on: boolean }
  | { type: 'buy'; item: ItemId; qty: Qty }
  | { type: 'assignSlot'; slot: number; spring: SpringId | null }
  | { type: 'prestige' };

/** 失敗の理由（arch §6-2） */
export type FailReason = 'insufficient' | 'locked' | 'maxed' | 'invalid' | 'interlude' | 'rateLimited' | 'noSlot' | 'notFound';

export interface ActionResult {
  ok: boolean;
  reason?: FailReason;
  events: GameEvent[];
}

const fail = (reason: FailReason): ActionResult => ({ ok: false, reason, events: [] });

export const isSpringId = (v: unknown): v is SpringId => typeof v === 'string' && Object.hasOwn(SPRING_BY_ID, v);
export const isQty = (v: unknown): v is Qty => v === 1 || v === 10 || v === 'max';
export function isItemId(v: unknown): v is ItemId {
  if (v === 'drill' || v === 'autoDigger' || v === 'bath' || v === 'tool') return true;
  return typeof v === 'string' && v.startsWith('pump:') && isSpringId(v.slice(5));
}

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
  let cost = sumGeometric(n, se.c0, se.r, se.owned);
  // 丸めで「買えるように見えて買えない」を防ぐ: 所持金を超えたら 1 つ減らす
  while (qty === 'max' && n > 0 && gt(cost, s.run.coins)) {
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function dispatch(s: GameState, input: unknown): ActionResult {
  if (!isObj(input) || typeof input.type !== 'string') return fail('invalid');
  const a = input;
  const events: GameEvent[] = [];
  const r = s.run;
  switch (a.type) {
    case 'tap': {
      const c = a.count === undefined ? 1 : a.count;
      if (typeof c !== 'number' || !Number.isFinite(c) || c < 1) return fail('invalid');
      // 任意の 1 秒で手動の打撃は 8 まで（Q-04(a)）。超えた分は数えない。1 打も入らなければ rateLimited で状態は変わらない
      const n = Math.min(Math.floor(c), PARAMS.input.manualMaxPerSec);
      if (tapHits(s, n, events) === 0) return fail('rateLimited');
      return { ok: true, events };
    }
    case 'hold':
      if (typeof a.on !== 'boolean') return fail('invalid');
      setHold(s, a.on);
      return { ok: true, events };
    case 'setAutoDig': {
      if (typeof a.on !== 'boolean') return fail('invalid');
      // 最初の強化（道具 1 段目）の前はオンにできない。オフはいつでもよい（Q-03）
      if (a.on && !autoDigUnlocked(s)) return fail('locked');
      const before = manualRate(s);
      r.autoDig.on = a.on;
      applyManualRateChange(s, before);
      return { ok: true, events };
    }
    case 'buy': {
      if (!isItemId(a.item) || !isQty(a.qty)) return fail('invalid');
      if (a.item === 'tool') {
        const t = nextTool(s);
        if (!t) return fail('locked');
        if (lt(r.coins, t.cost)) return fail('insufficient');
        r.coins = sub(r.coins, t.cost);
        r.drill.tool += 1;
        events.push({ type: 'ToolEvolved', tool: r.drill.tool }, { type: 'Purchased', item: 'tool', qty: 1 });
        return { ok: true, events };
      }
      const q = quote(s, a.item, a.qty);
      if (!q) return fail('locked');
      if (q.n <= 0 || gt(q.cost, r.coins)) return fail('insufficient');
      r.coins = sub(r.coins, q.cost);
      addLevels(s, a.item, q.n, events);
      events.push({ type: 'Purchased', item: a.item, qty: q.n });
      refreshGuests(s, events);
      return { ok: true, events };
    }
    case 'assignSlot': {
      const slot = a.slot;
      if (typeof slot !== 'number' || !Number.isInteger(slot)) return fail('invalid');
      if (a.spring !== null && !isSpringId(a.spring)) return fail('invalid');
      if (slot < 0 || slot >= r.bath.slots.length) return fail('noSlot');
      const spring = a.spring;
      if (spring !== null) {
        if (!r.springs[spring]) return fail('notFound');
        const other = r.bath.slots.indexOf(spring);
        if (other >= 0) r.bath.slots[other] = r.bath.slots[slot] ?? null; // 入れ替え
      }
      r.bath.slots[slot] = spring;
      refreshGuests(s, events);
      return { ok: true, events };
    }
    case 'prestige': {
      // S1 は PoC の簡易版（地形・木は S3 の BL-021・022）
      const gain = yunohanaGain(s);
      if (!gain.gt(0)) return fail('locked');
      s.meta.yunohana.lifetime = add(s.meta.yunohana.lifetime, gain);
      s.meta.prestiges += 1;
      s.run = createRun(sfc32Next(s.rng.run), s.run.terrain);
      applyManualRateChange(s, 0); // 長押し中のまま転生したら、新しい周回の端数も 0.5 から
      events.push({ type: 'PrestigeDone', gained: gain.toString() });
      return { ok: true, events };
    }
    default:
      return fail('invalid');
  }
}
