// ドメインイベント（arch §6-3）。描画・音・UI・ポータルはこれだけを見て動く。値は JSON にできる形だけ（Decimal は文字列）
import type { GuestId } from '../content/guests.ts';
import type { SpringId } from '../content/springs.ts';
import type { OreId } from './state.ts';

export type GameEvent =
  /** ブロックを壊した。ore は鉱石の ID か null、coins は得たコイン（num.ts の toStr の形） */
  | { type: 'BlockBroken'; depth: number; ore: OreId | null; coins: string }
  /** 周回の中で初めて新しい帯に入った（band は 0 始まり。帯 2 なら 1） */
  | { type: 'StratumEntered'; band: number }
  /** ミッドゲーム広告の機会（M2＝帯 4〜6 の幕間の終わり。M1＝転生の演出の後〔S3〕）。Q-06 */
  | { type: 'BreakOpportunity'; placement: 'M1' | 'M2'; band?: number }
  | { type: 'SpringFound'; spring: SpringId; depth: number }
  | { type: 'ToolEvolved'; tool: number }
  | { type: 'GuestArrived'; guest: GuestId; first: boolean }
  | { type: 'GuestLeft'; guest: GuestId }
  | { type: 'SlotUnlocked'; n: number }
  | { type: 'Purchased'; item: string; qty: number }
  | { type: 'PrestigeDone'; gained: string };

export type GameEventType = GameEvent['type'];
