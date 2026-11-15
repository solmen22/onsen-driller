// オフラインの早送り（gdd §9。BL-030）。時刻は読まない（離れていた時間は app が壁時計の差で渡す。arch §8-2）
// - 進むもの: 入湯料・自動掘削機の打撃（深さ・源泉の発見を含む）。どちらも ×オフライン効率（既定 50%、塩化物泉 +25%、木。上限 100%）
// - 進まないもの: タップ・長押し・自動掘りの基本の打撃（オフラインの掘削は自動掘削機だけ。gdd §5-3）、購入、掘削ブーストの効果時間
//   （オンライン中だけ減る。効果の ×2 もオフラインには効かない）、ラッキー鉱脈の出現（ロジックの時間 clock.playedMs を進めない）、M2 の機会
// - 休み（掘削ブースト）は壁時計なので、何もしなくても進む
// - 上限: offlineCapMs（8 時間。木で +4 時間）。超えた分は切り捨てる。経過が負・NaN なら何もしない（基準の時刻は次の保存で今になる）
// - 得たコインは run.pendingOffline に足す（受け取っていない前の値を上書きしない。R1 で受け取る）。新しく入れたら R1 の返却の印を外す
import type { GuestId } from '../content/guests.ts';
import { PARAMS } from '../content/params.ts';
import type { SpringId } from '../content/springs.ts';
import type { GameEvent } from './events.ts';
import { autoDiggerHitsPerSec, bathIncomePerSec, modifiers, offlineCapMs, offlineEfficiency } from './formulas.ts';
import { add, mul, sub, toStr, ZERO, type Num } from './num.ts';
import { forgetTicketPaid } from './rewards.ts';
import type { GameState } from './state.ts';
import { applyHits } from './step.ts';

const O = PARAMS.offline;
const HIT_EPS = 1e-9;

export interface OfflineResult {
  /** 離れていた時間（負・NaN・Infinity は 0） */
  readonly elapsedMs: number;
  /** 早送りした時間（上限で切った後） */
  readonly appliedMs: number;
  /** この留守で得たコイン（pendingOffline に足した額） */
  readonly coins: Num;
  /** 掘った m */
  readonly meters: number;
  /** 見つけた源泉（見つけた順） */
  readonly springs: SpringId[];
  /**
   * 初来訪のお客さんと、留守の始めからその来訪までの時間（ms）。app が留守の始めの壁時計に足して図鑑の時刻にする
   * （BL-030 の受け入れ基準 6。core は時刻を読まないので、図鑑には 0 が入っている）
   */
  readonly guestFirstAtMs: Partial<Record<GuestId, number>>;
}

/** 留守の早送りで描画・音・広告に渡さない出来事（戻ったときに何千もの破壊の演出・幕間・M2 を出さない） */
const DROPPED: ReadonlySet<GameEvent['type']> = new Set(['BlockBroken', 'StratumEntered', 'BreakOpportunity']);

/** 早送りの 1 ステップ（dtMs ≤ coarseStepMs）。幕間は進め（ドリルは止まり、入湯料は進む）、終わっても M2 は出さない */
function offlineStep(s: GameState, dtMs: number, out: GameEvent[]): void {
  const r = s.run;
  let digMs = dtMs;
  if (r.interludeMs > 0) {
    const used = Math.min(r.interludeMs, dtMs);
    r.interludeMs -= used;
    digMs -= used;
    if (r.interludeMs <= 1e-9) r.interludeMs = 0;
  }
  if (digMs > 0) {
    const m = modifiers(s);
    const rate = autoDiggerHitsPerSec(s, m) * offlineEfficiency(s, m);
    if (rate > 0) {
      const f = r.diggerCarry + (rate * digMs) / 1000;
      const n = Number.isFinite(f) ? Math.floor(f + HIT_EPS) : 0;
      r.diggerCarry = Number.isFinite(f) ? Math.max(0, f - n) : 0;
      applyHits(s, n, out);
    }
  }
  const m = modifiers(s); // 掘って見つけた源泉（枠・お客さん・塩化物泉の効率）の後の倍率
  const inc = bathIncomePerSec(s, m);
  if (inc.gt(0)) {
    const g = mul(inc, (offlineEfficiency(s, m) * dtMs) / 1000);
    r.coins = add(r.coins, g);
    s.stats.totalCoins = add(s.stats.totalCoins, g);
  }
}

/**
 * 留守の elapsedMs を、オフラインの規則で早送りする（app が 60 秒以上離れていたときに呼ぶ。60 秒未満はオンラインの規則の advance）。
 * 起きた出来事（源泉の発見・お客さん・チケットなど。破壊・幕間・M2 は除く）と、最後に OfflineSummary を out に足す
 */
export function runOffline(s: GameState, elapsedMs: number, out: GameEvent[]): OfflineResult {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const applied = Math.min(elapsed, Math.max(0, offlineCapMs(s)));
  const r = s.run;
  const coinsBefore = r.coins;
  const totalBefore = s.stats.totalCoins;
  const depthBefore = r.depth;
  const boostLeft = r.boost.remainingMs;
  r.boost.remainingMs = 0; // 効果の ×2 はオフラインに効かせず、残りも減らさない（戻ったら続きから）
  const springs: SpringId[] = [];
  const guestFirstAtMs: Partial<Record<GuestId, number>> = {};
  const tmp: GameEvent[] = [];
  let t = 0;
  while (t < applied) {
    const dt = Math.min(t < O.fineMs ? O.fineStepMs : O.coarseStepMs, applied - t);
    offlineStep(s, dt, tmp);
    t += dt;
    for (const e of tmp) {
      if (e.type === 'SpringFound') springs.push(e.spring);
      if (e.type === 'GuestArrived' && e.first && guestFirstAtMs[e.guest] === undefined) guestFirstAtMs[e.guest] = t;
      if (!DROPPED.has(e.type)) out.push(e);
    }
    tmp.length = 0;
  }
  r.boost.remainingMs = boostLeft;
  r.interludeMs = 0; // 留守の途中で始まった幕間は、戻ったときに残さない（幕間の出来事も出していない）
  // 得たコインは受け取り待ちに移す（受け取ったときに run.coins と stats.totalCoins に入る。二重に数えない）
  const diff = sub(r.coins, coinsBefore);
  const gained = diff.gt(0) ? diff : ZERO;
  r.coins = coinsBefore;
  s.stats.totalCoins = totalBefore;
  if (gained.gt(0)) {
    const prev = r.pendingOffline;
    r.pendingOffline = { coins: prev ? add(prev.coins, gained) : gained, ms: Math.min(Number.MAX_SAFE_INTEGER, (prev?.ms ?? 0) + elapsed) };
    forgetTicketPaid(s, 'R1'); // 新しい復帰（前の復帰をチケットで ×2 にした分は、もう返さない。QA の確認 2026-10-18 §6）
  }
  if (elapsed > s.stats.offlineMaxMs) s.stats.offlineMaxMs = elapsed;
  const meters = Math.max(0, r.depth - depthBefore);
  out.push({ type: 'OfflineSummary', ms: elapsed, appliedMs: applied, coins: toStr(gained), meters, springs });
  return { elapsedMs: elapsed, appliedMs: applied, coins: gained, meters, springs, guestFirstAtMs };
}
