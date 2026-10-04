// 固定ステップ（arch §7。BL-010・BL-012）。生産は「毎秒の量 × 刻み幅」、打撃は端数を繰り越して刻み幅によらず同じ打数にする。
// 時刻は読まない（arch §8-2）
import { PARAMS } from '../content/params.ts';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import { M2_FIRST_BAND } from '../content/strata.ts';
import type { GameEvent } from './events.ts';
import {
  autoDiggerHitsPerSec,
  bandOfDepth,
  bathIncomePerSec,
  blockHp,
  blockValue,
  computeGuests,
  drillPower,
  modifiers,
  oreAt,
  type Modifiers,
} from './formulas.ts';
import { admitManualHits, manualRate, setHold } from './input.ts';
import { add, lt, mul, sub, toStr, ZERO } from './num.ts';
import { countVeinHits, gainTickets, tickBoost, tickVein } from './rewards.ts';
import type { GameState } from './state.ts';

/** 端数の比較の許容（0.1 × 10 などの浮動小数の誤差で 1 打を落とさないため） */
const HIT_EPS = 1e-9;

/** 回数の加算（安全な整数で止める。保存・読み込みで値が変わらないように。レビュー S-4） */
const addCount = (a: number, b: number): number => Math.min(Number.MAX_SAFE_INTEGER, a + b);

/** 端数を f から n 打を引いた残り（0 以上 1 未満）にする。f が有限でなければ 0（NaN を状態に入れない。レビュー S-4） */
const carryOf = (f: number, n: number): number => (Number.isFinite(f) ? Math.max(0, f - n) : 0);

/**
 * お客さんの顔ぶれを条件から決め直す（抽選なし。乱数を使わない）。来た・帰ったお客さんを GuestArrived・GuestLeft で出す（定義の順）。
 * 呼ぶのは状態が変わるアクション（buy・assignSlot）と源泉の発見の直後。初来訪は図鑑に 0（時刻不明）を入れ、app が stampGuestsSeen で埋める。
 * 初来訪（セーブ全体で種類ごとに 1 回）は温泉チケット 1 枚（BL-058。GuestArrived の後に TicketGained）
 */
export function refreshGuests(s: GameState, out: GameEvent[]): void {
  const next = computeGuests(s);
  for (const g of next) {
    if (!s.run.guests.includes(g)) {
      const first = !Object.hasOwn(s.collection.guestsSeen, g);
      if (first) s.collection.guestsSeen[g] = 0; // 初来訪の壁時計は app が埋める（core は時刻を読まない。arch §8-2）
      out.push({ type: 'GuestArrived', guest: g, first });
      if (first) gainTickets(s, 'guestFirstVisit', PARAMS.tickets.guestFirstVisit, out);
    }
  }
  for (const g of s.run.guests) if (!next.includes(g)) out.push({ type: 'GuestLeft', guest: g });
  s.run.guests = next;
}

/**
 * 初来訪の壁時計を図鑑に入れる（BL-017。arch §6-1）。events の中の GuestArrived{first: true} のお客さんのうち、
 * 図鑑の値がまだ 0（時刻不明）のものだけを wallMs にする（2 回目の来訪・すでに時刻がある記録は変えない）。
 * wallMs が正の有限の数でなければ何もしない。埋めた数を返す
 */
export function stampGuestsSeen(s: GameState, events: readonly GameEvent[], wallMs: number): number {
  if (!(Number.isFinite(wallMs) && wallMs > 0)) return 0;
  let n = 0;
  for (const e of events) {
    if (e.type !== 'GuestArrived' || !e.first) continue;
    if (s.collection.guestsSeen[e.guest] === 0) {
      s.collection.guestsSeen[e.guest] = wallMs;
      n++;
    }
  }
  return n;
}

/** 源泉を発見した（ポンプ Lv1 を無料で付け、空いている枠につなぐ）。SpringFound を出すかは emit で選ぶ（grant は出さない。Q-16） */
export function discoverSpring(s: GameState, sp: SpringId, emit: boolean, out: GameEvent[]): void {
  const r = s.run;
  if (r.springs[sp]) return;
  r.springs[sp] = { pump: 1 }; // 発見時にポンプ Lv1 が無料で付く（gdd §5-4）
  if (!s.collection.springsSeen.includes(sp)) s.collection.springsSeen.push(sp);
  if (emit) out.push({ type: 'SpringFound', spring: sp, depth: SPRING_BY_ID[sp].depth }); // 源泉の深さ（越えて見つけたときも）
  const empty = r.bath.slots.indexOf(null);
  if (empty >= 0) r.bath.slots[empty] = sp;
  refreshGuests(s, out);
}

/** 帯を「入ったことにする」（幕間・イベントなし）。stratumSeen は昇順で重複なし */
export function markStratumSeen(s: GameState, band: number): void {
  const seen = s.run.stratumSeen;
  if (seen.includes(band)) return;
  seen.push(band);
  seen.sort((a, b) => a - b);
}

interface BreakResult {
  /** 源泉の発見で枠・お客さんが変わった（倍率を計算し直す） */
  changed: boolean;
  /** 新しい帯に入って幕間が始まった（このステップの残りのダメージと打撃は捨てる。Q-06） */
  interlude: boolean;
}

function breakBlock(s: GameState, m: Modifiers, out: GameEvent[]): BreakResult {
  const r = s.run;
  const d = r.depth;
  const ore = oreAt(s, d);
  const v = blockValue(s, d, ore !== null, m);
  r.coins = add(r.coins, v);
  s.stats.totalCoins = add(s.stats.totalCoins, v);
  s.stats.blocks = addCount(s.stats.blocks, 1);
  if (ore !== null) s.collection.ores[ore] = addCount(s.collection.ores[ore] ?? 0, 1);
  out.push({ type: 'BlockBroken', depth: d, ore, coins: toStr(v) });
  r.depth = d + 1;
  r.blockDmg = ZERO;
  if (r.depth > r.maxDepth) {
    r.maxDepth = r.depth;
    if (r.depth > s.stats.bestDepth) s.stats.bestDepth = r.depth;
  }
  // 周回の中で初めて新しい帯に入った: StratumEntered と 1.5 秒の幕間（起動直後の帯 1 は stratumSeen の初期値で出さない）
  const band = bandOfDepth(r.depth);
  let interlude = false;
  if (!r.stratumSeen.includes(band)) {
    markStratumSeen(s, band);
    out.push({ type: 'StratumEntered', band });
    r.interludeMs = PARAMS.interludeMs;
    interlude = true;
  }
  // 源泉は「その深さに届いた（越えた）ら」発見する。深さの一致では判定しない（読み込んだ状態や S3 の地形・近道の坑道で
  // 深さが先に進んでいても見逃さない。2026-09-29 Q-31 (e)）。自然に掘るときは 1m ずつ進むので、その深さのブロックで見つかる
  let changed = false;
  for (const sp of SPRINGS) {
    if (sp.depth <= r.depth && !r.springs[sp.id]) {
      discoverSpring(s, sp.id, true, out);
      changed = true;
    }
  }
  return { changed, interlude };
}

/** hits 回の打撃を与える（壊したブロックの余りのダメージは次のブロックへ繰り越す。Q-02）。新しい帯に入ったら残りは捨てる（Q-06） */
export function applyHits(s: GameState, hits: number, out: GameEvent[]): void {
  if (!(hits > 0)) return;
  s.stats.hits = addCount(s.stats.hits, hits);
  let m = modifiers(s);
  let dmg = mul(drillPower(s, m), hits);
  for (let broken = 0; broken < PARAMS.maxBlocksPerStep; broken++) {
    const remaining = sub(blockHp(s, s.run.depth, m), s.run.blockDmg);
    if (lt(dmg, remaining)) {
      s.run.blockDmg = add(s.run.blockDmg, dmg);
      return;
    }
    dmg = sub(dmg, remaining);
    const res = breakBlock(s, m, out);
    if (res.interlude) return; // 帯の境目でドリルが止まる
    if (res.changed) m = modifiers(s);
  }
}

/** 幕間が終わった: 帯 4〜6（band 3〜5）なら M2 の機会（Q-06）。app（S2 の BL-059）が breakOpportunity('M2') を呼ぶ */
function endInterlude(s: GameState, out: GameEvent[]): void {
  const band = bandOfDepth(s.run.depth);
  if (band >= M2_FIRST_BAND && PARAMS.ads.midgame.onStratum) out.push({ type: 'BreakOpportunity', placement: 'M2', band });
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
    const n = Number.isFinite(f) ? Math.floor(f + HIT_EPS) : 0;
    r.digCarry = carryOf(f, n);
    hits += admitManualHits(s, n, s.clock.playedMs); // 上限を超えた分は捨てる
  }
  const auto = autoDiggerHitsPerSec(s, m);
  if (auto > 0) {
    const f = r.diggerCarry + auto * sec;
    const n = Number.isFinite(f) ? Math.floor(f + HIT_EPS) : 0;
    r.diggerCarry = carryOf(f, n);
    hits += n;
  }
  applyHits(s, hits, out);
}

/**
 * 論理を dtMs だけ進める。時刻は読まない（arch §8-2）。
 * 幕間の間はドリルの打撃がすべて止まり（端数もたまらない）、入湯料は止まらない。ステップの途中で幕間が終われば、残りの時間は掘る（Q-06）。
 * dtMs が PARAMS.maxStepMs（1 秒）を超えたら、1 秒ずつに分けて進める（刻み幅によらないのは 1 秒刻みまで。arch §8-3・レビュー S-9）
 */
export function step(s: GameState, dtMs: number, out: GameEvent[] = []): GameEvent[] {
  if (!(dtMs > 0) || !Number.isFinite(dtMs)) return out;
  let left = dtMs;
  while (left > 0) {
    // 掘削ブーストの効果の終わりをまたがないように分ける（×2 の打撃が刻み幅によらない。BL-058）
    const boost = s.run.boost.remainingMs;
    const dt = Math.min(PARAMS.maxStepMs, left, boost > 0 ? boost : Infinity);
    stepOnce(s, dt, out);
    left -= dt;
  }
  return out;
}

function stepOnce(s: GameState, dtMs: number, out: GameEvent[]): void {
  const startMs = s.clock.playedMs;
  s.clock.playedMs += dtMs;
  const r = s.run;
  let digMs = dtMs;
  if (r.interludeMs > 0) {
    const used = Math.min(r.interludeMs, dtMs);
    r.interludeMs -= used;
    digMs -= used;
    if (r.interludeMs <= 1e-9) {
      r.interludeMs = 0;
      endInterlude(s, out);
    }
  }
  if (digMs > 0) dig(s, digMs, modifiers(s), out);
  const inc = bathIncomePerSec(s, modifiers(s));
  if (inc.gt(0)) {
    const g = mul(inc, dtMs / 1000);
    s.run.coins = add(s.run.coins, g);
    s.stats.totalCoins = add(s.stats.totalCoins, g);
  }
  tickBoost(s, dtMs, out); // 効果はオンライン中のロジックの時間だけ減る（BL-058）
  tickVein(s, startMs, out); // ラッキー鉱脈の消滅・出現（ロジックの時間。BL-058）
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
 * stepMs は PARAMS.maxStepMs（1 秒）で頭打ちにする（10 秒刻みを渡しても 1 秒刻みと同じ結果。レビュー S-9）。
 * ms が 0 以下・NaN・Infinity なら何もしない（空の配列）
 */
export function advance(s: GameState, ms: number, stepOrOpts: number | AdvanceOptions = {}, outArg?: GameEvent[]): GameEvent[] {
  const opts: AdvanceOptions = typeof stepOrOpts === 'number' ? { stepMs: stepOrOpts, out: outArg } : stepOrOpts;
  // 刻みは 1 秒まで（10 秒刻みなどを渡されても 1 秒ずつ進める。タップの入れ方も同じ刻みにそろえる。レビュー S-9）
  const stepMs = Math.min(PARAMS.maxStepMs, opts.stepMs ?? PARAMS.stepMs);
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

/**
 * タップ n 回（アクション tap の本体）。入った打数を返す（上限・幕間で 0 もありうる）。
 * 入った打数だけラッキー鉱脈に数える（鉱脈を開けるのはタップだけ。長押し・自動掘り・自動掘削機は dig を通るので数えない。Q-36 (b)）
 */
export function tapHits(s: GameState, n: number, out: GameEvent[]): number {
  if (s.run.interludeMs > 0) return 0;
  const k = admitManualHits(s, n, s.clock.playedMs);
  if (k > 0) {
    s.stats.taps = addCount(s.stats.taps, k);
    applyHits(s, k, out);
    countVeinHits(s, k, out);
  }
  return k;
}
