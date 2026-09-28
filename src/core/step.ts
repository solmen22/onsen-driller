// 固定ステップ（arch §7）。生産は「毎秒の量 × 刻み幅」、打撃は端数を繰り越して刻み幅によらず同じ打数にする。
import { PARAMS } from '../content/params.ts';
import type { GameEvent } from './events.ts';
import {
  bandOfDepth,
  blockHp,
  blockValue,
  computeGuests,
  drillPower,
  hitsPerSec,
  incomePerSec,
  isOre,
  modifiers,
  springAtDepth,
  type Modifiers,
} from './formulas.ts';
import { num } from './num.ts';
import type { GameState } from './state.ts';

export function refreshGuests(s: GameState, out: GameEvent[]): void {
  const next = computeGuests(s);
  for (const g of next) {
    if (!s.run.guests.includes(g)) {
      const first = !s.collection.guestsSeen.includes(g);
      if (first) s.collection.guestsSeen.push(g);
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
  r.coins = r.coins.add(v);
  s.stats.totalCoins = s.stats.totalCoins.add(v);
  s.stats.blocks++;
  out.push({ type: 'BlockBroken', depth: d, ore });
  r.depth = d + 1;
  r.blockDmg = num(0);
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
  if (hits <= 0) return;
  s.stats.hits += hits;
  let m = modifiers(s);
  let dmg = drillPower(s, m).mul(hits);
  for (let broken = 0; broken < PARAMS.maxBlocksPerStep; broken++) {
    const remaining = blockHp(s, s.run.depth, m).sub(s.run.blockDmg);
    if (dmg.lt(remaining)) {
      s.run.blockDmg = s.run.blockDmg.add(dmg);
      return;
    }
    dmg = dmg.sub(remaining);
    if (breakBlock(s, m, out)) m = modifiers(s); // 源泉の発見で枠・お客さんが変わった
  }
}

/** 論理を dtMs だけ進める。時刻は読まない（arch §8-2） */
export function step(s: GameState, dtMs: number, out: GameEvent[] = []): GameEvent[] {
  const dt = dtMs / 1000;
  s.clock.playedMs += dtMs;
  const hitsF = s.run.hitCarry + hitsPerSec(s) * dt;
  const hits = Math.floor(hitsF + 1e-9);
  s.run.hitCarry = Math.max(0, hitsF - hits);
  applyHits(s, hits, out);
  const inc = incomePerSec(s, modifiers(s));
  if (inc.gt(0)) {
    const g = inc.mul(dt);
    s.run.coins = s.run.coins.add(g);
    s.stats.totalCoins = s.stats.totalCoins.add(g);
  }
  return out;
}

/** ms だけ stepMs 刻みで進める（オフラインの早送り・テスト用） */
export function advance(s: GameState, ms: number, stepMs: number = PARAMS.stepMs, out: GameEvent[] = []): GameEvent[] {
  let left = ms;
  while (left > 0) {
    const dt = Math.min(stepMs, left);
    step(s, dt, out);
    left -= dt;
  }
  return out;
}
