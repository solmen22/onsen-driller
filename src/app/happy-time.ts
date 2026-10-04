// CrazyGames の happytime（祝いの合図）を送る場面（gdd §13 の「控えめに使う」・arch §12-3。BL-057）
// 次のときだけ送る: 最初の源泉（セーブ全体で最初の 1 つ）・各お客さんの初来訪・転生の完了・エンディング（S3 以降。イベントが入ったら足す）。
// ほかのアダプタの happyTime は記録するだけ（SDK を呼ばない）
import type { GameEvent, GameState } from '../core/index.ts';

/** e が happytime を送る場面か。s はイベントを反映した後の状態（ストアの onEvents の時点） */
export function isHappyMoment(e: GameEvent, s: Readonly<GameState>): boolean {
  switch (e.type) {
    case 'SpringFound':
      // 見つけた源泉が図鑑のただ 1 つ＝セーブ全体で最初の源泉（転生の後の再発見では送らない）
      return s.collection.springsSeen.length === 1 && s.collection.springsSeen[0] === e.spring;
    case 'GuestArrived':
      return e.first;
    case 'PrestigeDone':
      return true;
    default:
      return false;
  }
}
