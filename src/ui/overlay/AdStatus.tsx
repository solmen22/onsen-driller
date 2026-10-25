// 動画の広告の要求の案内（BL-059。シート〔RewardSheet〕とおかえり〔WelcomeModal〕で同じものを使う）
// - 待ち（決定 0010 の 7）: 要求してから広告が始まるまで「広告を読み込んでいます…」（ad-loading。role="status"）を出す。
//   CrazyGames では開始まで最長 30 秒待つので、止まったと感じさせない。広告が始まる（onAdPlaying(true)）・失敗する・
//   時間切れ（failed）になると消える。広告が終わった後に結果が返るまでの間にもう一度出さない（1 回の要求で 1 回だけ）
// - 失敗（failed・unavailable）: 「今は広告を表示できません」（ad-unavailable。role="status"）をそのまま出す（トーストにしない。Q-41 (d)）
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { useUi } from '../hooks/use-game.ts';

export interface AdWaiting {
  /** 待ちの案内を出すか（要求中で、まだ広告が始まっていない） */
  readonly waiting: boolean;
  /**
   * 要求を始める。requestReward を呼ぶ**前に、同じ呼び出しの中で**呼ぶ（「始まった」の印を戻す。前の要求の印を持ち越さない）。
   * 広告が requestReward の中ですぐ始まっても（dev・e2e のテスト用の広告、Poki の onStart）、印の戻しが後から来て案内が
   * 広告の再生中に出たままになることはない（PR #68 のレビュー S-1。effect で戻すと順番が逆になった）。
   * 戻り値の end は、要求の結果の処理（then の中。成功・失敗とも）で呼ぶ。これより後に始まった広告は数えない。
   * end は自分の要求の間だけ効く（すぐ次の要求を始めた後に、古い要求の end が来ても、新しい要求を倒さない。BL-141 N-6）
   */
  begin(): () => void;
}

/** 要求ごとの「広告が始まったか」。広告の開始は、begin から end までの間だけ数える */
export function useAdWaiting(requesting: boolean): AdWaiting {
  const { onAdPlaying } = useUi();
  const [started, setStarted] = useState(false);
  /**
   * 今の要求の番号（0 は要求の外。ミッドゲームなど要求の外で始まった広告を数えない）。
   * 倒すのは結果の処理の end で行い、描画の後の effect では行わない。effect だと、結果の直後（ほぼ 1 フレーム）に
   * もう一度押したとき、古い effect が新しい要求の印を倒しうる（PR #68 の再レビュー N-6）
   */
  const live = useRef(0);
  const seq = useRef(0);
  useEffect(
    () =>
      onAdPlaying?.((playing) => {
        if (playing && live.current !== 0) setStarted(true);
      }),
    [onAdPlaying],
  );
  return {
    waiting: requesting && !started,
    begin: () => {
      const id = ++seq.current;
      live.current = id;
      setStarted(false);
      return () => {
        if (live.current === id) live.current = 0;
      };
    },
  };
}

export function AdStatus({ waiting, failed }: { waiting: boolean; failed: boolean }) {
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
