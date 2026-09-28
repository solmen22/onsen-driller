// 入力の規則（gdd §5-2・arch §6-2。Q-03・Q-04。BL-012）。時刻は読まない（ロジックの時間 playedMs だけを使う）
// - 手動の打撃＝タップ・長押し（毎秒 4）・自動掘りの基本（毎秒 2）。合わせて任意の 1 秒（移動窓 (t−1000, t]）で 8 打まで
// - 長押しと自動掘りの基本は足さない（大きいほう）。自動掘削機の打撃は別枠で上限なし
// - 長押し・自動掘りの打撃は端数を持ち越す。手動の毎秒の打数が 0 から正になった瞬間に端数を 0.5 にし（最初の 1 打は間隔の半分の後）、
//   0 に戻ったら端数を捨てる
import { PARAMS } from '../content/params.ts';
import type { GameState } from './state.ts';

const I = PARAMS.input;

/** 自動掘りのスイッチが使えるか（最初の強化＝道具の進化の 1 段目〔ツルハシ〕の後。Q-03） */
export const autoDigUnlocked = (s: GameState): boolean => s.run.drill.tool >= 1;

/** 手動の打撃の毎秒の打数（長押しなら 4、そうでなく自動掘りがオンなら 2、どちらでもなければ 0） */
export function manualRate(s: GameState): number {
  if (s.input.hold) return I.holdPerSec;
  if (s.run.autoDig.on && autoDigUnlocked(s)) return I.autoDigPerSec;
  return 0;
}

/**
 * 手動の打撃 n 打のうち、移動窓 (atMs − 1000, atMs] の上限（8 打）に収まる数を返し、入れた分を記録する。
 * 記録（input.manualLog）は古い順で最大 8 件
 */
export function admitManualHits(s: GameState, n: number, atMs: number): number {
  if (!(n > 0)) return 0;
  const log = s.input.manualLog;
  const from = atMs - I.manualWindowMs;
  let drop = 0;
  while (drop < log.length && (log[drop] ?? 0) <= from) drop++;
  if (drop > 0) log.splice(0, drop);
  const k = Math.min(Math.max(0, I.manualMaxPerSec - log.length), Math.floor(n));
  for (let i = 0; i < k; i++) log.push(atMs);
  return k;
}

/** 手動の毎秒の打数が before から変わったときの端数の規則（0 → 正で 0.5、正 → 0 で捨てる） */
export function applyManualRateChange(s: GameState, before: number): void {
  const after = manualRate(s);
  if (before === 0 && after > 0) s.run.digCarry = I.startCarry;
  else if (after === 0) s.run.digCarry = 0;
}

/** 長押しの状態を変える（端数の規則を含む）。アクションの hold と advance の input.hold が使う */
export function setHold(s: GameState, on: boolean): void {
  const before = manualRate(s);
  s.input.hold = on;
  applyManualRateChange(s, before);
}
