// ステージの大きさの見張り（BL-114）。Phaser に依存しない小さな部品（unit で確かめる。view/game.ts が使う）
/** ScaleManager のうち、親の大きさの見直しに使うところ（テストで偽物を渡せるように） */
export interface ParentScale {
  getParentBounds(): unknown;
  refresh(): unknown;
}

/** ResizeObserver の作り方（テストで偽物を渡せるように。既定はブラウザの ResizeObserver） */
export type ResizeObserverFactory = (cb: () => void) => { observe(el: Element): void; disconnect(): void };

const browserResizeObserver: ResizeObserverFactory = (cb) => new ResizeObserver(() => cb());

/**
 * ステージ（キャンバスの親）の大きさが変わるたびに、ScaleManager の親の大きさを測り直して描き直す（BL-114）。
 * Phaser 4.2.1 の ScaleManager は `screen.orientation` の change で refresh するが、その change が私たちのレイアウトの切り替え
 * （ui/layout.ts の ResizeObserver で `data-layout` が縦 ↔ 横）の**後に**届くと、古い親の大きさで描き直し、最後に親の大きさ
 * （parentSize）だけを新しい値にする。以後の毎フレームの確認は「差がない」と判断するので、キャンバスが古い大きさのまま残る。
 * ステージそのものの大きさの変化を見て毎回 getParentBounds → refresh を呼び、Phaser のイベントの順番に頼らない。
 * ステージは grid の minmax(0, 1fr)・overflow: hidden で、キャンバスの大きさで広がらないので、描き直しで観察が繰り返さない
 */
export function watchParentSize(parent: Element, scale: ParentScale, makeObserver: ResizeObserverFactory = browserResizeObserver): () => void {
  const ro = makeObserver(() => {
    scale.getParentBounds();
    scale.refresh();
  });
  ro.observe(parent);
  return () => ro.disconnect();
}
