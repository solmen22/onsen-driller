// ご褒美の口（BL-059 の結線。BL-046 の後の結線）: UI の RewardHooks を core のアクション（useBoost・openVein・claimOffline）につなぐ
// - 壁時計は store.wallTime()（store が R2 の休みを切り詰める pushEvents と同じ時計。PR #42 のレビューの Should）
// - 規則（休み・チケットの枚数・×2 の条件）は core だけが持つ。ここは引数を組み立てて dispatch するだけで、結果（ok・reason）を返す
// - 動画のご褒美（source: 'ad'）は grantAd だけが付ける。呼ぶのは requestReward が 'rewarded' を返したときだけ（BL-059。Q-41）
import type { ActionResult } from '../core/index.ts';
import type { RewardPlacement } from '../platform/types.ts';
import type { RewardHooks } from '../ui/hooks/use-game.ts';
import type { GameStore } from './store.ts';

/** app の側の口: grantAd は core の結果を返す（遅れた報酬〔Q-45〕で、付いたときだけ知らせるため） */
export interface AppRewardHooks extends RewardHooks {
  grantAd(p: RewardPlacement): ActionResult;
  /**
   * 動画を要求する前に呼ぶ（BL-059 の広告の流れ）。R3 は出ている鉱脈を予約する（core の reserveVein。要求の間に消えても、
   * 見終えたら grantAd('R3') が報酬を付ける。PR #55 のレビュー S-5）。R1・R2 は何もしない（R2 の休み・R1 の受け取りは要求の間に変わらない）
   */
  reserveAd(p: RewardPlacement): void;
}

export function createRewardHooks(store: GameStore): AppRewardHooks {
  const useBoost = (source: 'ad' | 'ticket'): ActionResult => store.dispatch({ type: 'useBoost', source, wallMs: store.wallTime() });
  const claimOffline = (mode: 'normal' | 'double', source: 'ad' | 'ticket'): ActionResult =>
    store.dispatch(mode === 'normal' ? { type: 'claimOffline', mode } : { type: 'claimOffline', mode, source });
  return {
    useBoostTicket: () => useBoost('ticket'),
    claimOffline: (mode) => claimOffline(mode, 'ticket'),
    grantAd: (p: RewardPlacement) => {
      switch (p) {
        case 'R1':
          return claimOffline('double', 'ad');
        case 'R2':
          return useBoost('ad');
        case 'R3':
          return store.dispatch({ type: 'openVein', source: 'ad' });
      }
    },
    reserveAd: (p: RewardPlacement) => {
      if (p === 'R3') store.dispatch({ type: 'reserveVein' });
    },
  };
}
