// 入力（arch §7）: ステージの DOM のポインタとキーボードを受けてアクションにする。Phaser の入力系は使わない
import type { GameStore } from './store.ts';
import type { PerfMonitor } from './perf.ts';

const HOLD_DELAY_MS = 300;

export function setupInput(stage: HTMLElement, store: GameStore, perf: PerfMonitor | null, onFirstInput: () => void): { setEnabled(on: boolean): void } {
  let enabled = true;
  let first = true;
  let holdTimer = 0;
  const firstInput = (): void => {
    if (!first) return;
    first = false;
    onFirstInput();
  };
  const stopHold = (): void => {
    clearTimeout(holdTimer);
    if (store.state.input.hold) store.dispatch({ type: 'hold', on: false });
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!enabled || !e.isPrimary) return;
    e.preventDefault();
    firstInput();
    perf?.markInput(e.timeStamp);
    store.dispatch({ type: 'tap', count: 1 });
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => store.dispatch({ type: 'hold', on: true }), HOLD_DELAY_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) stage.addEventListener(ev, stopHold);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // ポータルの枠をスクロールさせない
    if (!enabled || e.code !== 'Space' || e.repeat) return;
    firstInput();
    perf?.markInput(e.timeStamp);
    store.dispatch({ type: 'tap', count: 1 });
    store.dispatch({ type: 'hold', on: true });
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') stopHold();
  });
  // UI のパネルを押したときも「最初の入力」とみなす
  window.addEventListener('pointerdown', firstInput, { capture: true });
  return {
    setEnabled(on) {
      enabled = on;
      if (!on) stopHold();
    },
  };
}
