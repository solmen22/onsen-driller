// HUD の掘削ブースト（btn-boost）の状態（BL-046。Q-37 (a)。TS-046-05）
// - 優先は active → cooldown → unavailable → ready
// - active: 使用中で、まだ使えない（core の boostView の reason が 'active'）。残り時間を m:ss（秒は切り上げ）で出す
// - cooldown: 休み中（core の reason が 'cooldown'）。再使用までの時間（cooldownLeftMs）を m:ss（切り上げ）
// - 効果が残っていても core で使えるなら（オフライン中に休みが明けた）、ready・unavailable にする（CEO 決定 2026-10-12）
// - unavailable: 動画を出せず、かつチケットで使えないとき（チケット 0 枚、またはチケットで使う口〔BL-058〕がまだない）
// - ready: 押せる（押すとシートが開く）。動画を出せるならチケット 0 枚でも ready
// 規則（5 分・15 分の休み・時計が戻ったときの 15 分の上限〔BL-124〕）は core の boostView だけが持つ。ここは core の表示の値を
// ボタンの状態に写すだけ（PR #42 のレビューの Should: HUD が readyAtWallMs を直に読むと、core の安全網の Math.min が届かない）
import { boostView as coreBoostView, type GameState } from '../../core/index.ts';

export type BoostState = 'ready' | 'active' | 'cooldown' | 'unavailable';

export interface BoostView {
  state: BoostState;
  /** active・cooldown の残り（m:ss）。ほかは null */
  time: string | null;
}

/** ミリ秒を m:ss にする（秒は切り上げ。299,000ms → 4:59、299,001ms → 5:00） */
export function mss(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * @param nowWallMs 壁時計（store.wallTime()。store が R2 の休みを切り詰めるのと同じ時計）
 * @param canVideo 動画のご褒美を要求できるか（BL-059 の口があり、rewardedAvailable() が true）
 * @param canTicket チケットで使う口（BL-058）があるか
 */
export function boostView(s: Readonly<GameState>, nowWallMs: number, canVideo: boolean, canTicket: boolean): BoostView {
  const b = coreBoostView(s, nowWallMs);
  // 使えるかは core の canUse だけで決める（判定と表示の出どころを 1 つにする。CEO 決定 2026-10-12）。
  // オフライン中に効果が残ったまま休みが明けた場合は、core で使える（使えば 5 分に戻す）ので、表示も ready・unavailable に合わせる
  if (b.reason === 'active') return { state: 'active', time: mss(b.remainingMs) };
  if (b.reason === 'cooldown') return { state: 'cooldown', time: mss(b.cooldownLeftMs) };
  if (!canVideo && !(canTicket && b.canUseTicket)) return { state: 'unavailable', time: null };
  return { state: 'ready', time: null };
}
