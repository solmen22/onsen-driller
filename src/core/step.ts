// 固定ステップ（arch §7。BL-010）。生産は「毎秒の量 × 刻み幅」、打撃は端数を繰り越して刻み幅によらず同じ打数にする。
// 時刻は読まない（arch §8-2）
import { PARAMS } from '../content/params.ts';
import type { GameEvent } from './events.ts';
import {
  autoDiggerHitsPerSec,
  bandOfDepth,
  bathIncomePerSec,
  blockHp,
  blockValue,
  computeGuests,
  drillPower,
  isOre,
  modifiers,
  springAtDepth,
  type Modifiers,
} from './formulas.ts';
import { add, lt, mul, sub, toStr, ZERO } from './num.ts';
import type { GameState } from './state.ts';

export function refreshGuests(s: GameState, out: GameEvent[]): void {
  const next = computeGuests(s);
  for (const g of next) {
    if (!s.run.guests.includes(g)) {
      const first = !(g in s.collection.guestsSeen);
      if (first) s.collection.guestsSeen[g] = 0; // 初来訪の時刻は app が埋める（S2）
      out.push({ type: 'GuestArrived', guest: g, first });
    }
  }
  for (const g of s.run.guests) if (!next.includes(g)) out.push({ type: 'GuestLeft', guest: g });
  s.run.guests = next;
}

function breakBlock(s: GameState, m: Modifiers, out: GameEvent[]): boolean {
  const r = s.run;
  const d = r.depth;
  const ore = isOre(s, d);
  const v = blockValue(s, d, ore, m);
  r.coins = add(r.coins, v);
  s.stats.totalCoins = add(s.stats.totalCoins, v);
  s.stats.blocks++;
  out.push({ type: 'BlockBroken', depth: d, ore: ore ? 'ore' : null, coins: toStr(v) });
  r.depth = d + 1;
  r.blockDmg = ZERO;
  if (r.depth > r.maxDepth) {
    const prevBand = bandOfDepth(r.maxDepth);
    r.maxDepth = r.depth;
    if (r.depth > s.stats.bestDepth) s.stats.bestDepth = r.depth;
    const band = bandOfDepth(r.depth);
    if (band !== prevBand) out.push({ type: 'StratumEntered', band });
  }
  const sp = springAtDepth(r.depth);
  if (sp && !r.springs[sp]) {
    r.springs[sp] = { pump: 1 }; // 発見時にポンプ Lv1 が無料で付く（gdd §5-4）
    if (!s.collection.springsSeen.includes(sp)) s.collection.springsSeen.push(sp);
    out.push({ type: 'SpringFound', spring: sp, depth: r.depth });
    const empty = r.bath.slots.indexOf(null);
    if (empty >= 0) r.bath.slots[empty] = sp;
    refreshGuests(s, out);
    return true;
  }
  return false;
}

/** hits 回の打撃を与える（壊したブロックの余りのダメージは次のブロックへ繰り越す） */
export function applyHits(s: GameState, hits: number, out: GameEvent[]): void {
  if (!(hits > 0)) return;
  s.stats.hits += hits;
  let m = modifiers(s);
  let dmg = mul(drillPower(s, m), hits);
  for (let broken = 0; broken < PARAMS.maxBlocksPerStep; broken++) {
    const remaining = sub(blockHp(s, s.run.depth, m), s.run.blockDmg);
    if (lt(dmg, remaining)) {
      s.run.blockDmg = add(s.run.blockDmg, dmg);
      return;
    }
    dmg = sub(dmg, remaining);
    if (breakBlock(s, m, out)) m = modifiers(s); // 源泉の発見で枠・お客さんが変わった
  }
}

/** 長押し 4 か自動掘り 2 の大きいほう＋自動掘削機（打/秒） */
export function hitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  const I = PARAMS.input;
  const base = s.input.hold ? I.holdPerSec : s.run.autoDig.on ? I.autoDigPerSec : 0;
  return base + autoDiggerHitsPerSec(s, m);
}

/** 論理を dtMs だけ進める。時刻は読まない（arch §8-2） */
export function step(s: GameState, dtMs: number, out: GameEvent[] = []): GameEvent[] {
  if (!(dtMs > 0) || !Number.isFinite(dtMs)) return out;
  const dt = dtMs / 1000;
  s.clock.playedMs += dtMs;
  const m = modifiers(s);
  const hitsF = s.run.digCarry + hitsPerSec(s, m) * dt;
  const hits = Math.floor(hitsF + 1e-9);
  s.run.digCarry = Math.max(0, hitsF - hits);
  applyHits(s, hits, out);
  const inc = bathIncomePerSec(s, modifiers(s));
  if (inc.gt(0)) {
    const g = mul(inc, dt);
    s.run.coins = add(s.run.coins, g);
    s.stats.totalCoins = add(s.stats.totalCoins, g);
  }
  return out;
}

export interface AdvanceOptions {
  /** 刻み幅（既定 100ms） */
  stepMs?: number;
  /** 発生したイベントを足していく配列 */
  out?: GameEvent[];
}

/** ms だけ stepMs 刻みで進める（オフラインの早送り・シミュレーター・テスト用フック）。最後の端数は短いステップで進める */
export function advance(s: GameState, ms: number, stepOrOpts: number | AdvanceOptions = {}, outArg?: GameEvent[]): GameEvent[] {
  const opts: AdvanceOptions = typeof stepOrOpts === 'number' ? { stepMs: stepOrOpts, out: outArg } : stepOrOpts;
  const stepMs = opts.stepMs ?? PARAMS.stepMs;
  const out = opts.out ?? [];
  if (!(ms > 0) || !Number.isFinite(ms) || !(stepMs > 0)) return out;
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    step(s, dt, out);
    left -= dt;
  }
  return out;
}
