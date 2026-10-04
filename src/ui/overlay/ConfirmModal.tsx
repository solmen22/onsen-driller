// 確認（M3。BL-046。gdd §11-2。TS-046-12）: 転生（S3 の BL-045）・読み込み・初めから（S3 の BL-029）だけに使う。
// ほかの操作に確認をはさまない。Esc・×・背景・「いいえ」は取り消し、「はい」だけが操作を行う
import { useRef } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { Dialog } from './Dialog.tsx';

export interface ConfirmProps {
  title: string;
  message: string;
  onOk: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, onOk, onCancel }: ConfirmProps) {
  const done = useRef(false);
  const once = (fn: () => void) => (): void => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  const cancel = once(onCancel);
  return (
    <Dialog testId="modal-confirm" titleId="modal-confirm-title" title={title} onDismiss={cancel}>
      <div class="sheet-body">
        <p class="sheet-desc">{message}</p>
        <button type="button" class="sheet-btn" data-testid="confirm-ok" onClick={once(onOk)}>
          {t('modal.confirm.ok')}
        </button>
        <button type="button" class="sheet-btn" data-testid="confirm-cancel" onClick={cancel}>
          {t('modal.confirm.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
