// 転生の確認の画面（M3。BL-045）を開いているか（BL-021。Q-47 (j)。CEO 決定 2026-10-18）。
// 開いている間は、app がループを止め、gameplay を止める理由 'prestige' を立てる（自動掘りで最深が増えて、見せた獲得量と実際に得る量が
// ずれないように）。止める判定は app/ad-flow.ts の 1 か所（hidden・ad・break・prestige）。確認の画面は開くときに
// openPrestigeConfirm(onDismiss) を呼び、閉じるとき（確定・キャンセル・Esc・背景）に返された関数を呼ぶ。
// **確定は「dispatch({type:'prestige'}) → 閉じる関数」の順**にする（TS-021-45）。dispatch で core の BreakOpportunity（M1）が届き、
// 'break' が先に立つので、'prestige' を外しても gameplayStart → gameplayStop の行き来が出ない（止まっているので値は同じ）。
// タブが隠れたら app が dismissPrestigeConfirm() を呼び、開いている確認の画面をすべて閉じる（onDismiss で UI が画面を閉じる）。
// 戻ったときは、開き直したときの値を見せる（留守の間の進み〔BL-030〕で値がずれないように。決定 0010 の 14 (b)。Q-50 (b)）
interface Entry {
  close: () => void;
  onDismiss?: () => void;
}

const entries = new Set<Entry>();
const subs = new Set<(open: boolean) => void>();

const emit = (open: boolean): void => {
  for (const fn of [...subs]) fn(open);
};

/**
 * 確認の画面を開いたことにする。返す関数で閉じたことにする（2 回呼んでも 1 回と数える）。
 * onDismiss は、app が外から閉じさせたとき（タブが隠れた）に呼ぶ（UI はここで画面を閉じる。返した関数は呼ばなくてよい）
 */
export function openPrestigeConfirm(onDismiss?: () => void): () => void {
  const e: Entry = {
    close: () => {
      if (!entries.delete(e)) return;
      if (entries.size === 0) emit(false);
    },
    onDismiss,
  };
  entries.add(e);
  if (entries.size === 1) emit(true);
  return e.close;
}

/** 開いている確認の画面をすべて閉じる（タブが隠れたとき。app/main.ts だけが呼ぶ）。UI には onDismiss で知らせる */
export function dismissPrestigeConfirm(): void {
  for (const e of [...entries]) {
    e.close();
    e.onDismiss?.();
  }
}

/** 確認の画面が開いているか */
export const isPrestigeConfirmOpen = (): boolean => entries.size > 0;

/** 開いている／いないが変わったときに呼ぶ（0 → 1 と 1 → 0 のときだけ）。戻り値で購読をやめる */
export function onPrestigeConfirmChange(fn: (open: boolean) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
