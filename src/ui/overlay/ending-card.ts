// エンディングのカード（簡易版。BL-023。gdd §5-8）を出す・閉じたの受け渡し。
// - 出すのを決めるのは app の ad-flow（M1 の広告・リワードの要求・確認の画面が終わってから。止める理由 'ending' も ad-flow が立てる）。
//   ad-flow が showEndingCard() を呼ぶと、UI（App）がカードを出す（おかえりが出ている間は、閉じた後に出す。Q-55 (d)）
// - UI はカードを飛ばしたら endingCardClosed() を呼ぶ。app はそれを受けて 'ending' を外す（main.ts が onEndingCardClosed でつなぐ）
// - タブが隠れてもカードは閉じない（Q-55 (f)）。読み直したら出さない（endingSeen は保存済み。Q-55 (a)）
let requested = false;
const showSubs = new Set<(show: boolean) => void>();
const closedSubs = new Set<() => void>();

/** カードを出す（app の ad-flow だけが呼ぶ）。出ている間にもう一度呼んでも 1 枚 */
export function showEndingCard(): void {
  if (requested) return;
  requested = true;
  for (const fn of [...showSubs]) fn(true);
}

/** カードを飛ばした（UI だけが呼ぶ）。出ていなければ何もしない */
export function endingCardClosed(): void {
  if (!requested) return;
  requested = false;
  for (const fn of [...showSubs]) fn(false);
  for (const fn of [...closedSubs]) fn();
}

/** カードを出すように言われているか */
export const isEndingCardRequested = (): boolean => requested;

/** 出す・閉じたの変化を購読する（UI）。戻り値で購読をやめる */
export function onEndingCardRequest(fn: (show: boolean) => void): () => void {
  showSubs.add(fn);
  return () => showSubs.delete(fn);
}

/** 閉じたことを購読する（app。'ending' を外す）。戻り値で購読をやめる */
export function onEndingCardClosed(fn: () => void): () => void {
  closedSubs.add(fn);
  return () => closedSubs.delete(fn);
}
