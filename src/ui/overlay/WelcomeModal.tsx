// おかえり（M1。BL-046。gdd §9・§11-2、QA §3-5、Q-37 (e)。TS-046-06・07）
// - 「受け取る」「動画を見て ×2」（動画アイコン）「チケットで ×2（×枚数）」。「受け取る」は常に 1 タップで押せる（確認をはさまない。
//   動画が使えない・チケット 0 枚・動画の要求中でも押せる。放置報酬を広告で人質にしない）
// - Esc・×・背景で閉じても「受け取る」（×1）と同じ（閉じ方で放置の報酬を失わせない）。受け取りは 1 回だけ
// - 出す条件（60 秒分以上）と金額の計算は S3 の BL-030。ここは部品だけ（金額は表記済みの文字で受け取る）
import { useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { Dialog } from './Dialog.tsx';

export type WelcomeChoice = 'claim' | 'video' | 'ticket';

export interface WelcomeProps {
  /** 留守の間に得たコイン（表記済み） */
  amount: string;
  /** 受け取り（×1・×2）。動画の ×2 は requestReward('R1') が rewarded のときだけ。1 回だけ呼ぶ */
  onClaim: (choice: WelcomeChoice) => void;
  /** チケットで ×2 を使えるか（BL-058 の口。ない間は押せない） */
  ticketHook?: boolean;
  /** ×2 を受け取れるか（core の offlineClaimView の canDouble。留守が 60 秒未満なら false で、動画を出さずチケットも押せない） */
  canDouble?: boolean;
}

export function WelcomeModal({ amount, onClaim, ticketHook = false, canDouble = true }: WelcomeProps) {
  const { platform, requestReward } = useUi();
  const tickets = useGame((s) => s.meta.tickets);
  const [requesting, setRequesting] = useState(false);
  const [videoOk, setVideoOk] = useState(() => requestReward !== undefined && platform.ads.rewardedAvailable());
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  const finish = (c: WelcomeChoice): void => {
    if (done.current) return;
    done.current = true;
    onClaim(c);
  };

  const onVideo = (): void => {
    if (!requestReward || requesting || done.current) return;
    setRequesting(true);
    setFailed(false);
    const after = (ok: boolean): void => {
      setRequesting(false);
      if (ok) {
        finish('video');
        return;
      }
      setFailed(true);
      setVideoOk(platform.ads.rewardedAvailable());
    };
    requestReward('R1').then(
      (r) => after(r === 'rewarded'),
      () => after(false),
    );
  };

  const canTicket = canDouble && ticketHook && tickets > 0;
  return (
    // 閉じても ×1 で受け取る。動画の要求中でも「受け取る」は押せるので、閉じるのも止めない
    <Dialog testId="modal-welcome" titleId="modal-welcome-title" title={t('modal.welcome.title')} onDismiss={() => finish('claim')}>
      <div class="sheet-body">
        <p class="sheet-desc" data-testid="welcome-amount">
          {t('modal.welcome.earned', { n: amount })}
        </p>
        <button type="button" class="sheet-btn" data-testid="welcome-claim" onClick={() => finish('claim')}>
          {t('modal.welcome.claim')}
        </button>
        {videoOk && canDouble && (
          <button
            type="button"
            class="sheet-btn"
            data-testid="welcome-video"
            data-kind="video"
            data-state={requesting ? 'loading' : undefined}
            disabled={requesting}
            onClick={onVideo}
          >
            <span class="video-icon" aria-hidden="true" />
            {t('modal.welcome.video')}
          </button>
        )}
        {failed && (
          <p class="sheet-note" data-testid="ad-unavailable" role="status">
            {t('ad.unavailable')}
          </p>
        )}
        <button
          type="button"
          class="sheet-btn"
          data-testid="welcome-ticket"
          data-count={tickets}
          disabled={!canTicket || requesting}
          aria-disabled={!canTicket || requesting}
          onClick={() => finish('ticket')}
        >
          <span class="ticket-icon" aria-hidden="true" />
          {t('modal.welcome.ticket', { n: tickets })}
        </button>
      </div>
    </Dialog>
  );
}
