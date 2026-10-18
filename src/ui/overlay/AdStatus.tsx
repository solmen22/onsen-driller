// 動画の広告の要求の案内（BL-059。シート〔RewardSheet〕とおかえり〔WelcomeModal〕で同じものを使う）
// - 待ち（決定 0010 の 7）: 要求してから広告が始まるまで「広告を読み込んでいます…」（ad-loading。role="status"）を出す。
//   CrazyGames では開始まで最長 30 秒待つので、止まったと感じさせない。広告が始まる（onAdPlaying(true)）・失敗する・
//   時間切れ（failed）になると消える。広告が終わった後に結果が返るまでの間にもう一度出さない（1 回の要求で 1 回だけ）
// - 失敗（failed・unavailable）: 「今は広告を表示できません」（ad-unavailable。role="status"）をそのまま出す（トーストにしない。Q-41 (d)）
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { useUi } from '../hooks/use-game.ts';

/** 要求中で、まだ広告が始まっていないか（要求ごとに数え直す） */
function useAdWaiting(requesting: boolean): boolean {
  const { onAdPlaying } = useUi();
  const [started, setStarted] = useState(false);
  // 要求の始まり・終わりで「始まった」を戻す（前の要求やミッドゲームの広告の印を持ち越さない）
  useEffect(() => {
    setStarted(false);
  }, [requesting]);
  useEffect(
    () =>
      onAdPlaying?.((playing) => {
        if (playing) setStarted(true);
      }),
    [onAdPlaying],
  );
  return requesting && !started;
}

export function AdStatus({ requesting, failed }: { requesting: boolean; failed: boolean }) {
  const waiting = useAdWaiting(requesting);
  return (
    <>
      {waiting && (
        <p class="sheet-note" data-kind="loading" data-testid="ad-loading" role="status">
          {t('ad.loading')}
        </p>
      )}
      {failed && (
        <p class="sheet-note" data-testid="ad-unavailable" role="status">
          {t('ad.unavailable')}
        </p>
      )}
    </>
  );
}
