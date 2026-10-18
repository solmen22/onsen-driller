// ご褒美のシート（SH。BL-046。gdd §5-9・§11-2・§13-2、Q-37 (b)・Q-41。TS-046-01〜05）
// - R2（掘削ブースト）: 「動画を見て受け取る」（動画アイコン）・「チケットで受け取る（×枚数）」・「閉じる」
// - R3（ラッキー鉱脈）: 「動画ですぐ開ける」（動画アイコン）・「自分で叩く（15 回）」・「閉じる」
// - ボタンはどれも同じ部品（.sheet-btn。同じ大きさ・字体・色）で、どれかだけを強調しない（「見ない」を同じ大きさで）
// - 動画は要求の口（BL-059 の requestReward）があり、rewardedAvailable() が true のときだけ出す（押しても効果のないボタンを残さない）
// - チケット 0 枚（または BL-058 の口がない）では「チケットで受け取る」を表示したまま押せない（×0。並びを変えない）
// - 要求中（結果が返るまで）は、どのボタンも押せず、Esc・×・背景でも閉じない（Q-41 (b)）
// - 失敗（failed・unavailable）では「今は広告を表示できません」（ad-unavailable）をシートの中に出したままにする（トーストにしない）。
//   その後に rewardedAvailable() を読み直し、false なら動画のボタンを隠す
import { useRef, useState } from 'preact/hooks';
import { boostMult, veinView } from '../../core/index.ts';
import { PARAMS } from '../../content/params.ts';
import { t } from '../../i18n/index.ts';
import type { RewardPlacement } from '../../platform/types.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { Dialog } from './Dialog.tsx';

/** gdd §5-9 の表示用の数（規則は core〔BL-058〕と content/params.ts。ここで数を書き直さない） */
const BOOST_MIN = PARAMS.boost.durationMs / 60_000;

export function RewardSheet({ placement, onClose }: { placement: Extract<RewardPlacement, 'R2' | 'R3'>; onClose: () => void }) {
  const { platform, rewards, requestReward } = useUi();
  const tickets = useGame((s) => s.meta.tickets);
  // R3 の「自分で叩く」の残りの回数（core の veinView。叩いた分だけ減る）
  const hitsLeft = useGame((s) => veinView(s).hitsLeft);
  const [requesting, setRequesting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [videoOk, setVideoOk] = useState(() => requestReward !== undefined && platform.ads.rewardedAvailable());
  /** 1 回押したら閉じるまで次を受け付けない（すばやく 2 回押しても 1 回。TS-046-04） */
  const used = useRef(false);

  const once = (fn: () => void): void => {
    if (used.current || requesting) return;
    used.current = true;
    fn();
  };

  const onVideo = (): void => {
    if (!requestReward || requesting || used.current) return;
    setRequesting(true);
    setFailed(false);
    requestReward(placement).then(
      (r) => {
        setRequesting(false);
        if (r === 'rewarded') {
          used.current = true;
          onClose();
          return;
        }
        setFailed(true);
        setVideoOk(platform.ads.rewardedAvailable());
      },
      () => {
        setRequesting(false);
        setFailed(true);
        setVideoOk(platform.ads.rewardedAvailable());
      },
    );
  };

  const canTicket = rewards !== undefined && tickets > 0;
  const title = placement === 'R2' ? t('sheet.boost.title') : t('sheet.vein.title');
  const desc =
    placement === 'R2'
      ? t('sheet.boost.desc', { n: BOOST_MIN, d: boostMult().drill, a: boostMult().auto }) // 実際の倍率（自動掘削機は ×4。BL-059）
      : t('sheet.vein.desc', { n: PARAMS.vein.incomeSec });
  return (
    <Dialog testId="sheet-reward" titleId="sheet-reward-title" title={title} onDismiss={onClose} dismissable={!requesting} variant="sheet">
      <div class="sheet-body" data-placement={placement} aria-busy={requesting}>
        <p class="sheet-desc">{desc}</p>
        {videoOk && (
          <button type="button" class="sheet-btn" data-testid="sheet-video" disabled={requesting} onClick={onVideo}>
            <span class="video-icon" aria-hidden="true" />
            {placement === 'R2' ? t('sheet.video') : t('sheet.videoOpen')}
          </button>
        )}
        {failed && (
          <p class="sheet-note" data-testid="ad-unavailable" role="status">
            {t('ad.unavailable')}
          </p>
        )}
        {placement === 'R2' ? (
          <button
            type="button"
            class="sheet-btn"
            data-testid="sheet-ticket"
            data-count={tickets}
            disabled={!canTicket || requesting}
            aria-disabled={!canTicket || requesting}
            onClick={() =>
              once(() => {
                rewards?.useBoostTicket();
                onClose();
              })
            }
          >
            <span class="ticket-icon" aria-hidden="true" />
            {t('sheet.ticket', { n: tickets })}
          </button>
        ) : (
          <button type="button" class="sheet-btn" data-testid="sheet-hits" disabled={requesting} onClick={() => once(onClose)}>
            {t('sheet.hits', { n: hitsLeft })}
          </button>
        )}
        <button type="button" class="sheet-btn" data-testid="sheet-close" disabled={requesting} onClick={() => once(onClose)}>
          {t('sheet.close')}
        </button>
      </div>
    </Dialog>
  );
}
