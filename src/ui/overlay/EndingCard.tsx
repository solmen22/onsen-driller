// エンディングのカード（簡易版。BL-023。gdd §5-8。完全版〔温泉街・宴・クレジット〕は BL-025 で差し替える）。CEO 決定 2026-11-15 の Q-55 (e)(f):
// - 見出しと文言 1〜3 行。開いたら「飛ばす」にフォーカス。Enter・Space・Esc で飛ばす（キーの自動リピートでは閉じない＝掘るために
//   押していた Space で開いた直後に閉じない）。カードの外のタップでは閉じない（背景は押下を止めるだけ）
// - 開いている間は modal-state に数える（app が掘削の入力を止める）。ゲームの停止（'ending'）は app の ad-flow が立てて外す
// - タブが隠れても閉じない
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { pushModal } from './modal-state.ts';

const SKIP_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape']);

export function EndingCard({ onSkip }: { onSkip: () => void }) {
  const skipBtn = useRef<HTMLButtonElement>(null);
  const skip = useRef(onSkip);
  skip.current = onSkip;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const pop = pushModal();
    skipBtn.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (!SKIP_KEYS.has(e.key)) return;
      e.preventDefault(); // フォーカスのあるボタンの click と二重にしない・後ろの画面に届けない
      e.stopPropagation();
      if (e.repeat) return; // 自動リピートでは閉じない
      skip.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      pop();
      if (before && before !== document.body && before.isConnected && typeof before.focus === 'function') before.focus();
    };
  }, []);

  return (
    <div class="overlay overlay-modal" data-testid="modal-ending-layer">
      <div class="overlay-backdrop" data-testid="modal-ending-backdrop" onPointerDown={(e) => e.preventDefault()} />
      <div class="dialog dialog-modal" data-testid="modal-ending" role="dialog" aria-modal="true" aria-labelledby="ending-title">
        <div class="dialog-head">
          <h2 class="dialog-title" id="ending-title">
            {t('ending.title')}
          </h2>
        </div>
        <div class="sheet-body">
          <p class="sheet-desc">{t('ending.body')}</p>
          <button type="button" class="sheet-btn" data-testid="ending-skip" ref={skipBtn} onClick={() => skip.current()}>
            {t('ending.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
