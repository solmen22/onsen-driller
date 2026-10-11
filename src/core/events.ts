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
  | { type: 'PrestigeDone'; gained: string }
  // ---- ご褒美（BL-058。gdd §5-9） ----
  /**
   * 温泉チケットを得る出来事。n は実際に増えた枚数、overflow は上限で増やせなかった枚数（coins〔Decimal の文字列〕に替えた）。
   * source は 4 つに閉じる（QA §3-2(b)・Q-36 (a) の条件 3。足すには QA リードの同意が要る）。新しいゲームの 2 枚は初期値でイベントにしない
   */
  | { type: 'TicketGained'; source: TicketSource; n: number; overflow: number; coins: string }
  /** 掘削ブーストの開始（remainingMs はロジックの時間、readyAtWallMs は次に使える壁時計の時刻） */
  | { type: 'BoostStarted'; source: 'ad' | 'ticket'; remainingMs: number; readyAtWallMs: number }
  /** 掘削ブーストの効果が終わった（休みは壁時計で続く） */
  | { type: 'BoostEnded' }
  /** ラッキー鉱脈が出た（expiresAtMs はロジックの時間） */
  | { type: 'VeinSpawned'; depth: number; expiresAtMs: number }
  /** ラッキー鉱脈を開いた（source は広告か 15 回の打撃）。coins は得たコイン、ticket は温泉チケットが当たったか（増えた枚数は TicketGained） */
  | { type: 'VeinOpened'; source: 'ad' | 'hits'; coins: string; ticket: boolean }
  /** ラッキー鉱脈が開かれずに消えた（報酬なし） */
  | { type: 'VeinExpired' }
  /** おかえりの収入を受け取った（R1。mode が double なら source は ad か ticket） */
  | { type: 'OfflineClaimed'; mode: 'normal' | 'double'; source?: 'ad' | 'ticket'; coins: string };

/** 温泉チケットを得る出来事の種類（QA §3-2(b)。この 4 つに閉じる） */
export type TicketSource = 'guestFirstVisit' | 'achievement' | 'prestige' | 'vein';
export const TICKET_SOURCES: readonly TicketSource[] = ['guestFirstVisit', 'achievement', 'prestige', 'vein'];

export type GameEventType = GameEvent['type'];
