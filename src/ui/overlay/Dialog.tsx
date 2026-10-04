// モーダル・シートの共通の枠（BL-046。gdd §11-2・§11-6、Q-37 (e)・Q-41 (b)）
// - role="dialog"・aria-modal="true"・見出しと aria-labelledby で結ぶ
// - 開いたときのフォーカスはダイアログの本体（tabindex="-1"）。どのボタンにも置かない（掘るために押していた Space で、
//   開いた直後に広告やチケットを誤って押さないため）。Tab は中で回る。閉じたら開く前の要素（例 btn-boost）に戻す
// - Esc・×ボタン・背景（ステージを含むダイアログの外）の押下で onDismiss（dismissable が false の間は無効。要求中など）
// - 開いている間は modal-state に数える（app が掘削の入力を止める。1〜5・Shift は App が使わない）
// - 背景は画面全体を覆うので、閉じるための押下はステージに届かない（掘削に数えない）
// - 背景は click で閉じる（pointerdown では閉じない）。タッチでは pointerdown で背景を消すと、後に来る click が
//   後ろのボタンに届くため（PR #32 のレビューの S-1）。pointerdown は preventDefault だけ（ステージ・フォーカスに届けない）
// - フォーカスがダイアログの外に落ちたとき（要求中に押したボタンが disabled になる・消える）は本体に戻す。
//   落ちた後の Esc・Tab も document で拾う（一番上のダイアログだけ。PR #32 のレビューの S-2）
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { pushModal } from './modal-state.ts';

export interface DialogProps {
  testId: string;
  /** 見出しの id（aria-labelledby） */
  titleId: string;
  title: string;
  /** Esc・×・背景で閉じたとき */
  onDismiss: () => void;
  /** false の間は Esc・×・背景で閉じない（広告の要求中。Q-41 (b)） */
  dismissable?: boolean;
  /** 下から出るシート（SH）か、中央のモーダル（M1・M3） */
  variant?: 'sheet' | 'modal';
  children: ComponentChildren;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ testId, titleId, title, onDismiss, dismissable = true, variant = 'modal', children }: DialogProps) {
  const body = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const dismiss = useRef({ onDismiss, dismissable });
  dismiss.current = { onDismiss, dismissable };

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const pop = pushModal();
    body.current?.focus();
    return () => {
      pop();
      // 開く前の要素に戻す（消えていれば何もしない）
      if (before && before !== document.body && before.isConnected && typeof before.focus === 'function') before.focus();
    };
  }, []);

  // 描画のたびに: フォーカスが外に落ちていたら（body・中の disabled のボタン）本体に戻す（S-2 (a)）
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || (b.contains(a) && (a as HTMLButtonElement).disabled === true)) b.focus();
  });

  // フォーカスがダイアログの外にあるときの Esc・Tab（S-2 (b)）。中にあるときは下の onKeyDown が扱う
  useEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent): void => {
      const l = layer.current;
      if (!l || !body.current || (e.target instanceof Node && l.contains(e.target))) return;
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      const layers = document.querySelectorAll('.overlay');
      if (layers[layers.length - 1] !== l) return; // 一番上のダイアログだけ
      body.current.focus();
      onKeyDown(e);
    };
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => document.removeEventListener('keydown', onDocKeyDown, true);
  }, []);

  const tryDismiss = (): void => {
    if (dismiss.current.dismissable) dismiss.current.onDismiss();
  };

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      tryDismiss();
      return;
    }
    if (e.key !== 'Tab' || !body.current) return;
    // フォーカスを中に閉じ込める（最後 → 最初、最初〔か本体〕→ 最後）
    const items = Array.from(body.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === body.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || active === body.current)) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div class={`overlay overlay-${variant}`} data-testid={`${testId}-layer`} onKeyDown={onKeyDown} ref={layer}>
      <div
        class="overlay-backdrop"
        data-testid={`${testId}-backdrop`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={tryDismiss}
      />
      <div
        class={`dialog dialog-${variant}`}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={body}
      >
        <div class="dialog-head">
          <h2 class="dialog-title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            class="dialog-x"
            data-testid={`${testId}-x`}
            aria-label={t('modal.close')}
            title={t('modal.close')}
            disabled={!dismissable}
            onClick={tryDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
