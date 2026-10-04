// モーダル・シートが開いているか（BL-046。Q-37 (e)）。開いている間は、app が掘削の入力を止め（input.setBlocked('modal')）、
// App は 1〜5（タブ）・Shift（購入数）を使わない（後ろの画面を変えない）。Dialog が開くときに push し、閉じるときに戻す
let open = 0;
const subs = new Set<(open: boolean) => void>();

const emit = (): void => {
  for (const fn of subs) fn(open > 0);
};

/** モーダルを 1 つ開いたことにする。返す関数で閉じたことにする（2 回呼んでも 1 回と数える） */
export function pushModal(): () => void {
  open++;
  if (open === 1) emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open = Math.max(0, open - 1);
    if (open === 0) emit();
  };
}

/** どれかのモーダル・シートが開いているか */
export const isModalOpen = (): boolean => open > 0;

/** 開いている／いないが変わったときに呼ぶ（0 → 1 と 1 → 0 のときだけ） */
export function onModalChange(fn: (open: boolean) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
