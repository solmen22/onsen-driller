// ドメインイベント（arch §6-3 の一部）。描画・音・UI・ポータルはこれだけを見て動く。
import type { SpringId } from '../content/springs.ts';
import type { GuestId } from '../content/guests.ts';

export type GameEvent =
  | { type: 'BlockBroken'; depth: number; ore: boolean }
  | { type: 'StratumEntered'; band: number }
  | { type: 'SpringFound'; spring: SpringId; depth: number }
  | { type: 'ToolEvolved'; tool: number }
  | { type: 'GuestArrived'; guest: GuestId; first: boolean }
  | { type: 'GuestLeft'; guest: GuestId }
  | { type: 'SlotUnlocked'; n: number }
  | { type: 'Purchased'; item: string; qty: number }
  | { type: 'PrestigeDone'; gained: string };
