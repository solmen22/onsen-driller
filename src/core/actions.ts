// アクション（arch §6-2。BL-010）。どんな入力でも例外を投げず、実行できないときは { ok: false, reason } で状態を変えない
import { PARAMS } from '../content/params.ts';
import type { SpringId } from '../content/springs.ts';
import type { GameEvent } from './events.ts';
import { slotsForBathLevel, yunohanaGain } from './formulas.ts';
import { applyManualRateChange, autoDigUnlocked, manualRate, setHold } from './input.ts';
import { add, sub, toStr } from './num.ts';
import { claimOffline, gainTickets, openVeinByAd, refundAdTicket, reserveVein, useBoost } from './rewards.ts';
import { sfc32Next } from './rng.ts';
import { buyQuote, isItemId, isQty, isSpringId, isUpgradeItem, type ItemId, type LevelItem, type Qty } from './selectors.ts';
import { createRun, type GameState, type UpgradeId } from './state.ts';
import { refreshGuests, tapHits } from './step.ts';

export type Action =
  | { type: 'tap'; count?: number }
  | { type: 'hold'; on: boolean }
  | { type: 'setAutoDig'; on: boolean }
  | { type: 'buy'; item: ItemId; qty: Qty }
  | { type: 'assignSlot'; slot: number; spring: SpringId | null }
  | { type: 'prestige' }
  /** R2 掘削ブースト（BL-058）。wallMs は app の壁時計（休みの起点。core は時刻を読まない）。'ad' は app が広告の成功を確かめてから */
  | { type: 'useBoost'; source: 'ad' | 'ticket'; wallMs: number }
  /** R3 ラッキー鉱脈を広告ですぐ開く（BL-058）。広告なしの道は 15 回のタップ（tap の中で開く） */
  | { type: 'openVein'; source: 'ad' }
  /** R3 の動画を要求した時点で、出ている鉱脈を予約する（要求の間に消えても、見終えたら報酬を付ける。PR #55 のレビュー S-5。BL-059） */
  | { type: 'reserveVein' }
  /** 払ったチケットの返却（決定 0010 の 11。遅れて見終えた広告の報酬を core が断ったときだけ app が送る） */
  | { type: 'refundAdTicket'; placement: 'R1' | 'R2' }
  /** R1 おかえりの収入を受け取る（BL-058）。normal は source なし、double は 'ad' か 'ticket' */
  | { type: 'claimOffline'; mode: 'normal' }
  | { type: 'claimOffline'; mode: 'double'; source: 'ad' | 'ticket' };

/**
 * 失敗の理由（arch §6-2）。cooldown・active は R2 の休み中・効果の途中（BL-058。Q-36 (c)）
 */
export type FailReason =
  | 'insufficient'
  | 'locked'
  | 'maxed'
  | 'invalid'
  | 'interlude'
  | 'rateLimited'
  | 'noSlot'
  | 'notFound'
  | 'cooldown'
  | 'active';

export interface ActionResult {
  ok: boolean;
  reason?: FailReason;
  events: GameEvent[];
}

const fail = (reason: FailReason): ActionResult => ({ ok: false, reason, events: [] });

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
const isAdOrTicket = (v: unknown): v is 'ad' | 'ticket' => v === 'ad' || v === 'ticket';
/** ご褒美の結果（失敗の理由か null）をアクションの結果にする */
const done = (reason: FailReason | null, events: GameEvent[]): ActionResult => (reason ? fail(reason) : { ok: true, events });

export function dispatch(s: GameState, input: unknown): ActionResult {
  if (!isObj(input) || typeof input.type !== 'string') return fail('invalid');
  const a = input;
  const events: GameEvent[] = [];
  const r = s.run;
  switch (a.type) {
    case 'tap': {
      const c = a.count === undefined ? 1 : a.count;
      if (typeof c !== 'number' || !Number.isFinite(c) || c < 1) return fail('invalid');
      if (r.interludeMs > 0) return fail('interlude'); // 幕間中はドリルが止まる（Q-06）
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
      // 成否と差し引く額は、表示と同じ見積もり（buyQuote）で決める（arch §6-2）
      const q = buyQuote(s, a.item, a.qty);
      if (q.state !== 'affordable') return fail(q.state === 'locked' ? 'locked' : q.state === 'maxed' ? 'maxed' : 'insufficient');
      r.coins = sub(r.coins, q.cost);
      if (isUpgradeItem(a.item)) {
        // 改良は一度きり。run.upgrades の最後に足し、並べ替えない（BL-018。PR #13 のレビューの連絡 3 ②）
        r.upgrades.push(a.item.slice(8) as UpgradeId);
        events.push({ type: 'Purchased', item: a.item, qty: 1 });
        return { ok: true, events };
      }
      if (a.item === 'tool') {
        // 道具は qty によらず 1 段だけ（gdd §5-3）
        r.drill.tool += 1;
        events.push({ type: 'ToolEvolved', tool: r.drill.tool }, { type: 'Purchased', item: 'tool', qty: 1 });
        return { ok: true, events };
      }
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
      s.meta.lastPrestigeGain = gain; // 次の周回の「転生の推奨」の基準（BL-021）
      // 掘削ブーストは周回をまたいで続く（効果の残りも休みも。転生で休みを消せないように。BL-058）。
      // 未受け取りのオフライン収入は捨てる（コインは転生でなくなるので、受け取ってから転生しても同じ）。鉱脈は新しい周回で予約し直す
      const boost = { ...s.run.boost };
      s.run = createRun(sfc32Next(s.rng.run), s.run.terrain);
      s.run.boost = boost;
      applyManualRateChange(s, 0); // 長押し中のまま転生したら、新しい周回の端数も 0.5 から
      events.push({ type: 'PrestigeDone', gained: toStr(gain) }); // Decimal はイベントでも "<仮数>e<指数>"（arch §6-3。レビュー N-1）
      gainTickets(s, 'prestige', PARAMS.tickets.prestige, events); // 転生のたびに 2 枚（上限を超えた分のコインは新しい周回の収入で計算）
      return { ok: true, events };
    }
    case 'useBoost': {
      const w = a.wallMs;
      if (!isAdOrTicket(a.source) || typeof w !== 'number' || !Number.isFinite(w) || w < 0) return fail('invalid');
      return done(useBoost(s, a.source, w, events), events);
    }
    case 'openVein':
      // チケットで鉱脈は開けない（チケットの使い道は R1・R2 だけ。gdd §5-9。Q-36 (c)）
      if (a.source !== 'ad') return fail('invalid');
      return done(openVeinByAd(s, events), events);
    case 'reserveVein':
      return done(reserveVein(s), events);
    case 'refundAdTicket':
      if (a.placement !== 'R1' && a.placement !== 'R2') return fail('invalid');
      return done(refundAdTicket(s, a.placement, events), events);
    case 'claimOffline': {
      if (a.mode === 'normal') {
        if (a.source !== undefined) return fail('invalid');
        return done(claimOffline(s, 'normal', undefined, events), events);
      }
      if (a.mode !== 'double' || !isAdOrTicket(a.source)) return fail('invalid');
      return done(claimOffline(s, 'double', a.source, events), events);
    }
    default:
      return fail('invalid');
  }
}
