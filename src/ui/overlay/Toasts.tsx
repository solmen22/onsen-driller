// トースト（TST。BL-046。gdd §11-2、Q-37 (c)(d)(f)。TS-046-08〜11）: 画面の下部に 2 秒
// - お客さん: 初来訪だけ（GuestArrived{ first: true }）。温泉チケット +1 も同じトーストに出す（付与は BL-058。口がない間は出さない）
// - 保存の失敗: 保存の状態が ok → failing に変わったときだけ 1 回（起動時からの failing・unavailable・readonly では出さない。
//   出したままの save-warning があるため）
// - 動画の報酬（Q-45）: 開始の時間切れ（「今は広告を表示できません」）の後に始まった広告を最後まで見て、報酬が付いたとき
//   （BL-059 の onLateReward。シートが閉じていても何をもらえたか分かるように）。報酬が付かずに払ったチケットを返したときは
//   「チケットを 1 枚返しました」、上限で返せなかったときは理由（決定 0010 の 11。ja・en）
// - 押せない（pointer-events: none。下の購入ボタン・ステージの操作を妨げない）。role="status"（aria-live="polite"）
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, type TextKey } from '../../i18n/index.ts';
import { useUi } from '../hooks/use-game.ts';
import { ToastQueue, type Toast } from './toast-queue.ts';

function text(x: Toast): string {
  switch (x.kind) {
    case 'guest': {
      const name = t(`guest.${String(x.data.guest)}` as TextKey);
      return x.data.ticket === true ? `${t('toast.guest', { name })} ${t('toast.ticket')}` : t('toast.guest', { name });
    }
    case 'save':
      return t('toast.save');
    case 'ad':
      if (x.data.kind === 'refund') return t('toast.adRefund');
      if (x.data.kind === 'full') return t('toast.adRefundFull');
      return t(`toast.adLate.${String(x.data.placement)}` as TextKey);
    default:
      return '';
  }
}

export function Toasts() {
  const { store, rewards, onLateReward } = useUi();
  const [visible, setVisible] = useState<readonly Toast[]>([]);
  const queue = useRef<ToastQueue | null>(null);
  const ticketOnFirst = rewards !== undefined;

  useEffect(() => {
    const q = new ToastQueue((v) => setVisible(v));
    queue.current = q;
    const offEvent = store.onEvents((evs) => {
      for (const e of evs) {
        if (e.type === 'GuestArrived' && e.first) q.push('guest', e.guest, { guest: e.guest, ticket: ticketOnFirst });
      }
    });
    let prev = store.saveStatus;
    const offSave = store.subscribe(() => {
      const now = store.saveStatus;
      if (prev === 'ok' && now === 'failing') q.push('save', 'failing');
      prev = now;
    });
    const offLate = onLateReward?.((p, kind) => q.push('ad', kind === 'reward' ? p : `${p}:${kind}`, { placement: p, kind }));
    return () => {
      offEvent();
      offSave();
      offLate?.();
      q.dispose();
      queue.current = null;
    };
  }, [store, ticketOnFirst, onLateReward]);

  return (
    <div class="toasts" role="status" aria-live="polite" data-testid="toasts">
      {visible.map((x) => (
        <div key={x.id} class="toast" data-testid="toast" data-kind={x.kind} data-key={x.key}>
          {text(x)}
        </div>
      ))}
    </div>
  );
}
