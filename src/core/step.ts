// 固定ステップ（arch §7。BL-010・BL-012）。生産は「毎秒の量 × 刻み幅」、打撃は端数を繰り越して刻み幅によらず同じ打数にする。
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
import { admitManualHits, manualRate, setHold } from './input.ts';
import { add, lt, mul, sub, toStr, ZERO } from './num.ts';
import type { GameState } from './state.ts';

/** 端数の比較の許容（0.1 × 10 などの浮動小数の誤差で 1 打を落とさないため） */
const HIT_EPS = 1e-9;

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

/** hits 回の打撃を与える（壊したブロックの余りのダメージは次のブロックへ繰り越す。Q-02） */
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

/** 見込みの打数/秒: 手動（長押し 4 か自動掘りの基本 2 の大きいほう）＋自動掘削機。上限（8/秒）は手動だけにかかる */
export function hitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  return manualRate(s) + autoDiggerHitsPerSec(s, m);
}

/** 掘削を digMs だけ進める（手動の打撃は移動窓の上限を通し、自動掘削機の打撃は別枠） */
function dig(s: GameState, digMs: number, m: Modifiers, out: GameEvent[]): void {
  const r = s.run;
  const sec = digMs / 1000;
  let hits = 0;
  const rate = manualRate(s);
  if (rate > 0) {
    const f = r.digCarry + rate * sec;
    const n = Math.floor(f + HIT_EPS);
    r.digCarry = Math.max(0, f - n);
    hits += admitManualHits(s, n, s.clock.playedMs); // 上限を超えた分は捨てる
  }
  const auto = autoDiggerHitsPerSec(s, m);
  if (auto > 0) {
    const f = r.diggerCarry + auto * sec;
    const n = Math.floor(f + HIT_EPS);
    r.diggerCarry = Math.max(0, f - n);
    hits += n;
  }
  applyHits(s, hits, out);
}

/** 論理を dtMs だけ進める。時刻は読まない（arch §8-2） */
export function step(s: GameState, dtMs: number, out: GameEvent[] = []): GameEvent[] {
  if (!(dtMs > 0) || !Number.isFinite(dtMs)) return out;
  s.clock.playedMs += dtMs;
  dig(s, dtMs, modifiers(s), out);
  const inc = bathIncomePerSec(s, modifiers(s));
  if (inc.gt(0)) {
    const g = mul(inc, dtMs / 1000);
    s.run.coins = add(s.run.coins, g);
    s.stats.totalCoins = add(s.stats.totalCoins, g);
  }
  return out;
}

/** advance の入力（テスト用フック・リプレイ・E2E。Q-16） */
export interface AdvanceInput {
  /** その間、毎秒 N 回のタップを等間隔に入れる（毎秒 2 回なら 0.5 秒・1.0 秒…。連打の上限は通常どおり） */
  tapsPerSec?: number;
  /** その間だけ長押しの状態にし、終わったら元の状態に戻す */
  hold?: boolean;
}

/** advance の呼び出しをまたいで持ち越す端数（テスト用フックが 1 つ持つ。createAdvanceCarry で作る） */
export interface AdvanceCarry {
  /** 刻み幅に満たずに進めなかった時間（ms） */
  ms: number;
  /** タップの端数（0 以上 1 未満） */
  taps: number;
}

export const createAdvanceCarry = (): AdvanceCarry => ({ ms: 0, taps: 0 });

export interface AdvanceOptions {
  /** 刻み幅（既定 100ms） */
  stepMs?: number;
  /** 発生したイベントを足していく配列 */
  out?: GameEvent[];
  input?: AdvanceInput;
  /**
   * 渡すと、刻み幅に満たない最後の端数を進めずに carry.ms に残し、次の呼び出しで足す（フックの advance。Q-16）。
   * 渡さないと、最後の端数を短いステップで進める（オフラインの早送り・シミュレーター）
   */
  carry?: AdvanceCarry;
}

const validTapsPerSec = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * ms だけ stepMs 刻みで進める（オフラインの早送り・シミュレーター・テスト用フック）。起きたイベントを起きた順に返す。
 * ms が 0 以下・NaN・Infinity なら何もしない（空の配列）
 */
export function advance(s: GameState, ms: number, stepOrOpts: number | AdvanceOptions = {}, outArg?: GameEvent[]): GameEvent[] {
  const opts: AdvanceOptions = typeof stepOrOpts === 'number' ? { stepMs: stepOrOpts, out: outArg } : stepOrOpts;
  const stepMs = opts.stepMs ?? PARAMS.stepMs;
  const out = opts.out ?? [];
  if (!(ms > 0) || !Number.isFinite(ms) || !(stepMs > 0) || !Number.isFinite(stepMs)) return out;
  const carry = opts.carry;
  const taps = validTapsPerSec(opts.input?.tapsPerSec);
  const hold = opts.input?.hold;
  const holdBefore = s.input.hold;
  if (typeof hold === 'boolean') setHold(s, hold);

  let tapAcc = carry ? carry.taps : 0;
  let left = ms + (carry ? carry.ms : 0);
  while (left > 0) {
    if (carry && left + HIT_EPS < stepMs) break; // 端数は次の呼び出しへ
    const dt = carry ? stepMs : Math.min(stepMs, left);
    step(s, dt, out);
    left = Math.max(0, left - dt);
    if (taps > 0) {
      tapAcc += (taps * dt) / 1000;
      const n = Math.floor(tapAcc + HIT_EPS);
      tapAcc = Math.max(0, tapAcc - n);
      if (n > 0) tapHits(s, n, out); // アクション tap と同じ規則（上限・幕間）
    }
  }
  if (carry) {
    carry.ms = Math.max(0, left);
    carry.taps = tapAcc;
  }
  if (typeof hold === 'boolean') setHold(s, holdBefore);
  return out;
}

/** タップ n 回（アクション tap の本体）。入った打数を返す（上限で 0 もありうる） */
export function tapHits(s: GameState, n: number, out: GameEvent[]): number {
  const k = admitManualHits(s, n, s.clock.playedMs);
  if (k > 0) {
    s.stats.taps += k;
    applyHits(s, k, out);
  }
  return k;
}
