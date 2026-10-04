// HUD の掘削ブースト（btn-boost）の状態（BL-046。Q-37 (a)。TS-046-05）
// - 優先は active → cooldown → unavailable → ready
// - active: 使用中（run.boost.remainingMs > 0）。残り時間を m:ss（秒は切り上げ）で出す
// - cooldown: 休み中（壁時計が run.boost.readyAtWallMs より前）。再使用までの時間を m:ss（切り上げ）
// - unavailable: 動画を出せず、かつチケットで使えないとき（チケット 0 枚、またはチケットで使う口〔BL-058〕がまだない）
// - ready: 押せる（押すとシートが開く）。動画を出せるならチケット 0 枚でも ready
// 規則（5 分・15 分の休み）は core（BL-058）が持つ。ここは状態を読んで表示を決めるだけ
import type { GameState } from '../../core/index.ts';

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
 * @param nowWallMs 壁時計（app の時計の wallNow）
 * @param canVideo 動画のご褒美を要求できるか（BL-059 の口があり、rewardedAvailable() が true）
 * @param canTicket チケットで使う口（BL-058）があるか
 */
export function boostView(s: GameState, nowWallMs: number, canVideo: boolean, canTicket: boolean): BoostView {
  const b = s.run.boost;
  if (b.remainingMs > 0) return { state: 'active', time: mss(b.remainingMs) };
  if (b.readyAtWallMs > nowWallMs) return { state: 'cooldown', time: mss(b.readyAtWallMs - nowWallMs) };
  if (!canVideo && !(canTicket && s.meta.tickets > 0)) return { state: 'unavailable', time: null };
  return { state: 'ready', time: null };
}
