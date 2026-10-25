// 止める理由と出来事の購読の配線（BL-021。PR #75 のレビュー S-2 の案 (a)）。決定どおりに動くかが「呼ぶ順」で決まる配線を関数にまとめ、
// main.ts とテスト（tests/integration/ad-flow.test.ts）が同じものを使う（テストが配線を写すと、main.ts の配線を消しても気づけないため）
// - wireVisibility: タブの表示・非表示と、転生の確認の画面の開閉を ad-flow とライフサイクルにつなぐ。
//   隠れたら「hidden を立てる → 確認の画面を閉じる → ad-flow に知らせる」の順（決定 0010 の 14 (b)・15。閉じても、'prestige' の理由は
//   見えるまで ad-flow が持つので、非表示の間は gameplayStart を出さない。非表示を合図にしない CrazyGames でも同じ）
// - subscribeSaveThenAds: ストアの出来事を「保存（PrestigeDone なら saveNow('prestige')）→ 広告の流れ（BreakOpportunity）」の順で購読する。
//   ストアは購読の順に同期で届けるので、転生の確定 → 転生の保存 → M1 の順になる（TS-021-24・45）
// - ライフサイクルの 'hidden' を書くのはこのファイルだけ（1 つの理由の書き手は 1 か所。'interlude' は main.ts、'ad'・'break'・'prestige' は ad-flow）
import type { GameEvent } from '../core/index.ts';
import type { AdFlow } from './ad-flow.ts';
import { saveReasonForEvents, type SaveReason } from './autosave.ts';
import type { PauseReason } from './lifecycle.ts';

export interface VisibilityWiringDeps {
  life: { setPaused(r: PauseReason, on: boolean): void };
  ads: Pick<AdFlow, 'syncHidden' | 'setPrestigeConfirm'>;
  /** タブが隠れているか（document.hidden） */
  isHidden: () => boolean;
  /** 転生の確認の画面（ui/overlay/prestige-confirm.ts の onPrestigeConfirmChange・dismissPrestigeConfirm） */
  prestigeConfirm: { onChange(fn: (open: boolean) => void): () => void; dismiss(): void };
}

export interface VisibilityWiring {
  /** visibilitychange で呼ぶ */
  readonly onVisibilityChange: () => void;
  /** 確認の画面の購読をやめる（テスト用） */
  readonly dispose: () => void;
}

/** 起動時の hidden を立て、確認の画面の開閉を ad-flow につなぐ。返す onVisibilityChange を visibilitychange に渡す */
export function wireVisibility(d: VisibilityWiringDeps): VisibilityWiring {
  // 転生の確認の画面（M3）を開いている間はループと gameplay を止める（見せた湯の華と実際に得る湯の華をずらさない。Q-47 (j)）。
  // 止める判定は ad-flow の 1 か所（hidden・ad・break・prestige）。開いている間に広告が終わってもループは動かない（PR #68 の QA の申し送り）
  const off = d.prestigeConfirm.onChange((open) => d.ads.setPrestigeConfirm(open));
  d.life.setPaused('hidden', d.isHidden());
  return {
    onVisibilityChange() {
      const hidden = d.isHidden();
      d.life.setPaused('hidden', hidden);
      // 確認の画面を開いたまま隠れたら閉じる（戻ったら開き直したときの値を見せる。留守の早送りで値がずれないように。決定 0010 の 14 (b)）
      if (hidden) d.prestigeConfirm.dismiss();
      d.ads.syncHidden();
    },
    dispose: off,
  };
}

/** 出来事を「保存 → 広告の流れ」の順で購読する（TS-021-45）。戻り値で両方の購読をやめる */
export function subscribeSaveThenAds(
  store: { onEvents(fn: (evs: readonly GameEvent[]) => void): () => void },
  autosave: { saveNow(reason: SaveReason): boolean },
  ads: Pick<AdFlow, 'onEvents'>,
): () => void {
  // 転生の後はすぐ保存する（BL-021。録画モード・読み取り専用・デモでは autosave の isSuppressed で書かない）
  const offSave = store.onEvents((evs) => {
    const reason = saveReasonForEvents(evs);
    if (reason) autosave.saveNow(reason);
  });
  const offAds = store.onEvents((evs) => ads.onEvents(evs));
  return () => {
    offSave();
    offAds();
  };
}
