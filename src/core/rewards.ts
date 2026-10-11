// ご褒美の core（R1〜R3・温泉チケット。BL-058。gdd §5-9・arch §6-1〜6-3）。時刻は読まない（壁時計は引数で受け取る。arch §8-2）
// - 温泉チケット: 得るのは決まった出来事（TicketSource の 4 つ）だけで、1 回の量は固定。上限を超えた分は「毎秒の収入 × 60 秒」のコイン。
//   コイン → チケットの道はない（QA §3-2(b)・Q-36 (a) の条件 1〜4）。減るのは useBoost('ticket')・claimOffline('double','ticket') の成功だけ
// - R2 掘削ブースト: 効果はロジックの時間で減る（オンライン中だけ）。休みは壁時計（使った時刻 + 15 分）。広告でもチケットでも同じ
// - R3 ラッキー鉱脈: 出現は周回の擬似乱数（rng.run）で 5〜8 分ごと（ロジックの時間）、60 秒で消える。タップの打撃 15 回か広告で開く
// - R1 おかえり ×2: 未受け取りのオフライン収入（run.pendingOffline）を 1 回だけ受け取る。付けるのは S3 の BL-030
// 広告の成否は core では見ない。app（BL-059）が広告の成功を確かめてから source='ad' で呼ぶ
import { PARAMS } from '../content/params.ts';
import type { GameEvent, TicketSource } from './events.ts';
import { add, mul, toStr, ZERO, type Num } from './num.ts';
import { sfc32Float } from './rng.ts';
import { incomePerSec } from './selectors.ts';
import type { GameState } from './state.ts';

const T = PARAMS.tickets;
const B = PARAMS.boost;
const V = PARAMS.vein;

/** ご褒美のアクションの失敗の理由（actions.ts の FailReason の一部。Q-36 (c)） */
export type RewardFail = 'cooldown' | 'active' | 'insufficient' | 'notFound' | 'locked';

function addCoins(s: GameState, c: Num): void {
  if (!c.gt(0)) return;
  s.run.coins = add(s.run.coins, c);
  s.stats.totalCoins = add(s.stats.totalCoins, c);
}

// ---- 温泉チケット ----

/**
 * 温泉チケットを n 枚得る（n は出来事ごとの固定の値。params.tickets）。上限（10）を超えた分は「今の毎秒の収入 × 60 秒 × 枚数」のコイン
 * （収入 0 なら 0）。TicketGained を必ず 1 つ出す（n・overflow のどちらが 0 でも）
 */
export function gainTickets(s: GameState, source: TicketSource, n: number, out: GameEvent[]): void {
  const want = Math.max(0, Math.floor(n));
  const added = Math.min(Math.max(0, T.max - s.meta.tickets), want);
  const overflow = want - added;
  s.meta.tickets += added;
  const coins = overflow > 0 ? mul(incomePerSec(s), T.overflowIncomeSec * overflow) : ZERO;
  addCoins(s, coins);
  out.push({ type: 'TicketGained', source, n: added, overflow, coins: toStr(coins) });
}

// ---- R2 掘削ブースト ----

export interface BoostView {
  /** 効果の途中か（ドリル威力・自動掘削機 ×2） */
  readonly active: boolean;
  /** 効果の残り（ロジックの時間 ms。オンライン中だけ減る） */
  readonly remainingMs: number;
  /** 休みの残り（壁時計 ms。0 なら休みではない） */
  readonly cooldownLeftMs: number;
  /** 今使えるか（広告で）。チケットで使えるかは canUseTicket */
  readonly canUse: boolean;
  /** チケットで今使えるか（canUse かつチケット 1 枚以上） */
  readonly canUseTicket: boolean;
  /** 使えない理由（使えるなら null） */
  readonly reason: 'active' | 'cooldown' | null;
}

/**
 * 休みが明ける時刻（壁時計）。保存の値が「今 + 休みの長さ」より先なら（時計が戻った）、「今 + 休みの長さ」として扱う（BL-124。PR #41 のレビュー S-1）。
 * 判定と表示の残りが 15 分を超えない安全網。状態を変えない計算なので、時計が戻った後に過ぎた時間は覚えられない
 * （この値だけでは「今 + 15 分」が今と一緒に進み、残りが 15:00 のまま止まる）。保存の値を切り詰めるのは normalizeBoostClock で、
 * app が毎ステップ呼ぶ（app/store.ts の pushEvents）。両方がそろって「時計が戻っても 15 分で使える」になる
 */
const boostReadyAt = (s: Readonly<GameState>, wallMs: number): number => Math.min(s.run.boost.readyAtWallMs, wallMs + B.cooldownMs);

const boostBlock = (s: Readonly<GameState>, wallMs: number): 'active' | 'cooldown' | null => {
  const b = s.run.boost;
  if (wallMs >= boostReadyAt(s, wallMs)) return null; // 休みが終われば使える（効果がオフライン中に残っていても、使えば 5 分に戻す。重ねない）
  return b.remainingMs > 0 ? 'active' : 'cooldown';
};

/** HUD・シートの掘削ブーストの表示（wallMs は app の壁時計） */
export function boostView(s: Readonly<GameState>, wallMs: number): BoostView {
  const b = s.run.boost;
  const reason = boostBlock(s, wallMs);
  return {
    active: b.remainingMs > 0,
    remainingMs: b.remainingMs,
    cooldownLeftMs: Math.max(0, boostReadyAt(s, wallMs) - wallMs),
    canUse: reason === null,
    canUseTicket: reason === null && s.meta.tickets >= 1,
    reason,
  };
}

/** R2 を使う。効果は 5 分（重ねず 5 分に戻す）、休みは wallMs から 15 分。失敗なら理由を返し、状態を変えない */
export function useBoost(s: GameState, source: 'ad' | 'ticket', wallMs: number, out: GameEvent[]): RewardFail | null {
  const block = boostBlock(s, wallMs);
  if (block) return block;
  if (source === 'ticket' && s.meta.tickets < 1) return 'insufficient';
  if (source === 'ticket') s.meta.tickets -= 1;
  const b = s.run.boost;
  b.remainingMs = B.durationMs;
  b.readyAtWallMs = wallMs + B.cooldownMs;
  out.push({ type: 'BoostStarted', source, remainingMs: b.remainingMs, readyAtWallMs: b.readyAtWallMs });
  return null;
}

/**
 * 休みの残り（readyAtWallMs − wallMs）を休みの長さ（PARAMS.boost.cooldownMs、15 分）以下に戻す（BL-120。PR #34 のレビュー S-1）。
 * 休みは壁時計なので、時計が進んだ端末で使い、後で時計が戻る（自動の時刻合わせ・別の端末への書き出しと読み込み）と、
 * 残りが上限なしに長くなる（その間 R2 が広告でもチケットでも使えない）。休みの残りは 15 分を超えないという不変条件をここで保つ。
 * 超えていなければ（休みでない・ちょうど 15 分を含む）何も変えない。変えたら true。
 * app が毎ステップ呼ぶ（app/store.ts の pushEvents。BL-124）。効果の残り（remainingMs。ロジックの時間）には触れない
 */
export function normalizeBoostClock(s: GameState, wallMs: number): boolean {
  const b = s.run.boost;
  const cap = wallMs + B.cooldownMs;
  if (!(b.readyAtWallMs > cap)) return false;
  b.readyAtWallMs = cap;
  return true;
}

/** ステップの終わりに、効果の残りをロジックの時間で減らす（step が効果の終わりでステップを分けるので、終わりをまたがない） */
export function tickBoost(s: GameState, dtMs: number, out: GameEvent[]): void {
  const b = s.run.boost;
  if (!(b.remainingMs > 0)) return;
  b.remainingMs -= dtMs;
  if (b.remainingMs <= 1e-9) {
    b.remainingMs = 0;
    out.push({ type: 'BoostEnded' });
  }
}

// ---- R3 ラッキー鉱脈 ----

/** 次の出現までの間隔（[min, max) ms の整数。周回の擬似乱数を 1 つ使う） */
const veinInterval = (s: GameState): number =>
  V.minIntervalMs + Math.floor(sfc32Float(s.rng.run) * (V.maxIntervalMs - V.minIntervalMs));

/**
 * ステップの終わりに、鉱脈の消滅・出現を進める（ロジックの時間）。
 * - 未予約（nextAtMs が 0。新しい周回・古いセーブ）なら、このステップの始まり（startMs）から 5〜8 分後を予約する（刻み幅によらない）
 * - 出現の時刻を過ぎたら出す。消える時刻は「出現の予定の時刻 + 60 秒」、次の予約は「出現の予定の時刻 + 5〜8 分」（刻み幅によらない）
 * - 読み込んだ状態などで、出現の予定から 60 秒以上過ぎていたら、出さずに今から予約し直す（まとめて出して消すことをしない）
 */
export function tickVein(s: GameState, startMs: number, out: GameEvent[]): void {
  const v = s.run.vein;
  const now = s.clock.playedMs;
  if (v.active && now >= v.active.expiresAtMs) {
    v.active = null;
    out.push({ type: 'VeinExpired' });
  }
  if (!(v.nextAtMs > 0)) {
    v.nextAtMs = startMs + veinInterval(s);
    if (now < v.nextAtMs) return;
  }
  if (v.active || now < v.nextAtMs) return;
  const at = v.nextAtMs;
  if (now >= at + V.lifeMs) {
    v.nextAtMs = now + veinInterval(s);
    return;
  }
  v.active = { depth: s.run.depth, hits: 0, expiresAtMs: at + V.lifeMs };
  v.nextAtMs = at + veinInterval(s);
  out.push({ type: 'VeinSpawned', depth: v.active.depth, expiresAtMs: v.active.expiresAtMs });
}

/** 鉱脈を開く（報酬: 今の毎秒の収入 × 90 秒のコイン、25% で温泉チケット 1 枚。抽選は周回の擬似乱数） */
function openActiveVein(s: GameState, source: 'ad' | 'hits', out: GameEvent[]): void {
  const coins = mul(incomePerSec(s), V.incomeSec);
  addCoins(s, coins);
  const ticket = sfc32Float(s.rng.run) < V.ticketChance;
  s.run.vein.active = null;
  out.push({ type: 'VeinOpened', source, coins: toStr(coins), ticket });
  if (ticket) gainTickets(s, 'vein', T.vein, out);
}

/**
 * タップのアクションの打撃 k を鉱脈に数える（tapHits だけが呼ぶ。長押し・自動掘り・自動掘削機は数えない。Q-36 (b)）。
 * 15 回に届いたら開く（VeinOpened{source:'hits'}）
 */
export function countVeinHits(s: GameState, k: number, out: GameEvent[]): void {
  const a = s.run.vein.active;
  if (!a || !(k > 0)) return;
  a.hits += k;
  if (a.hits >= V.hits) openActiveVein(s, 'hits', out);
}

/** 広告で鉱脈をすぐ開く（source は 'ad' だけ）。出ていなければ notFound */
export function openVeinByAd(s: GameState, out: GameEvent[]): RewardFail | null {
  if (!s.run.vein.active) return 'notFound';
  openActiveVein(s, 'ad', out);
  return null;
}

export interface VeinView {
  readonly active: boolean;
  /** 開くまでの残りのタップの数（出ていなければ 0） */
  readonly hitsLeft: number;
  /** 消えるまでの残り（ロジックの時間 ms。出ていなければ 0） */
  readonly expiresInMs: number;
}

export function veinView(s: Readonly<GameState>): VeinView {
  const a = s.run.vein.active;
  if (!a) return { active: false, hitsLeft: 0, expiresInMs: 0 };
  return { active: true, hitsLeft: Math.max(0, V.hits - a.hits), expiresInMs: Math.max(0, a.expiresAtMs - s.clock.playedMs) };
}

// ---- R1 おかえり ×2 ----

export interface OfflineClaimView {
  /** 「受け取る」で入るコイン（×2 なら 2 倍） */
  readonly coins: Num;
  /** オフラインの経過時間（壁時計 ms） */
  readonly ms: number;
  /** ×2（R1）を受け取れるか（経過時間が 60 秒以上） */
  readonly canDouble: boolean;
  /** チケットで ×2 にできるか（canDouble かつチケット 1 枚以上） */
  readonly canDoubleTicket: boolean;
}

/** 未受け取りのオフライン収入（なければ null）。「受け取る」は常に使える（放置報酬を人質にしない） */
export function offlineClaimView(s: Readonly<GameState>): OfflineClaimView | null {
  const p = s.run.pendingOffline;
  if (!p) return null;
  const canDouble = p.ms >= PARAMS.offlineDoubleMinMs;
  return { coins: p.coins, ms: p.ms, canDouble, canDoubleTicket: canDouble && s.meta.tickets >= 1 };
}

/** おかえりの収入を受け取る（normal は 1 倍、double は 2 倍。復帰 1 回につき 1 回）。失敗なら理由を返し、状態を変えない */
export function claimOffline(
  s: GameState,
  mode: 'normal' | 'double',
  source: 'ad' | 'ticket' | undefined,
  out: GameEvent[],
): RewardFail | null {
  const p = s.run.pendingOffline;
  if (!p) return 'notFound';
  if (mode === 'double') {
    if (!(p.ms >= PARAMS.offlineDoubleMinMs)) return 'locked';
    if (source === 'ticket' && s.meta.tickets < 1) return 'insufficient';
    if (source === 'ticket') s.meta.tickets -= 1;
  }
  const coins = mode === 'double' ? mul(p.coins, 2) : p.coins;
  addCoins(s, coins);
  s.run.pendingOffline = null;
  out.push(mode === 'double' ? { type: 'OfflineClaimed', mode, source, coins: toStr(coins) } : { type: 'OfflineClaimed', mode, coins: toStr(coins) });
  return null;
}
