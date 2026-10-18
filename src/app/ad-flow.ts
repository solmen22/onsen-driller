// 広告の流れ（arch §12-4・gdd §13。BL-059）: シート → 広告 → 報酬、ミッドゲームの機会、広告の間の停止
// - リワード（R1〜R3）: requestReward(p) は「保存を 1 回試す → showRewarded(p) → 'rewarded' のときだけ grant(p)」。
//   要求中にもう一度呼ばれたら同じ Promise を返す（連打しても要求も報酬も 1 回。TS-059-02）。アダプタの reject は 'failed'。
//   アダプタが同じ要求に結果を 2 回返しても、Promise は 1 回しか決まらないので報酬は 1 回（TS-059-06）。
//   保存の失敗・抑止（読み取り専用・録画モード・デモ）でも広告は要求する（Q-41 (a)。TS-059-16）
// - ミッドゲーム（M1・M2）: core の BreakOpportunity のイベントを受けたときだけ breakOpportunity(placement) を呼ぶ
//   （広告のタイマーは持たない。gdd §13-1。フラグが false なら core がイベントを出さない。Q-41 (e)）。
//   受けた時点で止まる理由 'break' を立て、Promise が決まったら外す。ストアはイベントの購読者に同じステップの通知より先に届けるので、
//   幕間（interlude）の理由が外れる前に 'break' が立ち、合図は gameplayStop → gameplayStart の 1 往復だけ（Nit 2。TS-059-11）
// - 広告の間の停止: 理由（hidden・ad〔onPlaying〕・break）からループ・掘削の入力・音を決める（syncLoop。PR #16 のレビュー S-3）。
//   広告の最中にタブを見せてもループは動かず、隠れている間に広告が終わっても見えるまで動かない（TS-059-13）
// - 広告の終わり（onPlaying(false)）で BL-104 の音の再開の関数を呼ぶ（TS-059-15）
// - 遅れた報酬（Q-45。決定 0010 の 5）: アダプタの開始の時間切れで failed を返した後に、遅れて始まり最後まで見られた広告は、
//   アダプタの onLateReward（要求ごとの id つき）を受けて報酬を 1 回だけ付ける。同じ id は 2 回目から無視し（壊れたアダプタでも二重にしない）、
//   その要求の placement に付ける（今の要求〔pending〕とは別。今の要求の Promise・報酬には触れない）。core が断ったら
//   （R2 が休み中・R3 の鉱脈が消えたなど）何も付けず、知らせもしない。付けたら onLateReward の購読者（UI のトースト・シート）に知らせる
// - 1 つの止まる理由の書き手は 1 か所: ライフサイクルの 'ad'・'break' と、入力の 'ad' を書くのはこのファイルだけ
import type { GameEvent } from '../core/index.ts';
import type { LateReward, Platform, RewardPlacement, RewardResult } from '../platform/types.ts';
import type { PauseReason } from './lifecycle.ts';

export interface AdFlowDeps {
  ads: Platform['ads'];
  /** ポータルの消音（CrazyGames の muteAudio など） */
  isMuted: () => boolean;
  life: { setPaused(r: PauseReason, on: boolean): void };
  input: { setBlocked(r: 'ad', on: boolean): void };
  loop: { pause(): void; resume(): void };
  /** タブが隠れているか（document.hidden） */
  isHidden: () => boolean;
  setMuted: (m: boolean) => void;
  /** BL-104 の音の再開（止まった AudioContext を戻す。running なら何もしない） */
  resumeAudio: () => void;
  /** 広告の前の保存（autosave.saveNow('ad')。結果は見ない） */
  saveBeforeAd: () => void;
  /** 'rewarded' のとき（と遅れた報酬のとき）だけ呼ぶ（app/rewards.ts の grantAd）。core が受けたら ok: true */
  grant: (p: RewardPlacement) => { ok: boolean };
  onError?: (e: unknown) => void;
}

export interface AdFlow {
  /** UI の Ctx に渡す要求の口（シートの「動画」・おかえりの ×2） */
  requestReward(p: RewardPlacement): Promise<RewardResult>;
  /** store.onEvents に渡す（BreakOpportunity だけを見る） */
  onEvents(evs: readonly GameEvent[]): void;
  /** visibilitychange で呼ぶ（ループを理由から決め直す） */
  syncHidden(): void;
  /** 遅れた報酬（Q-45）を付けたときに呼ぶ（UI のトースト・シート）。戻り値で購読をやめる */
  onLateReward(cb: (p: RewardPlacement) => void): () => void;
  /** テスト用: 今ミッドゲームの機会を渡している途中か */
  readonly breaking: boolean;
}

export function createAdFlow(d: AdFlowDeps): AdFlow {
  const onError = d.onError ?? (() => {});
  let adPlaying = false;
  let breaking = false;
  let pending: Promise<RewardResult> | null = null;
  /** 遅れた報酬を付けた（か断られた）要求の id。同じ id を 2 回扱わない（Q-45） */
  const lateSeen = new Set<number>();
  const lateSubs = new Set<(p: RewardPlacement) => void>();

  const syncLoop = (): void => {
    if (d.isHidden() || adPlaying || breaking) d.loop.pause();
    else d.loop.resume();
  };
  const syncInput = (): void => d.input.setBlocked('ad', adPlaying || breaking);

  d.ads.onPlaying((playing) => {
    if (playing === adPlaying) return; // 壊れたアダプタの二重の通知は無視する（TS-059-06）
    adPlaying = playing;
    d.life.setPaused('ad', playing);
    syncInput();
    d.setMuted(playing || d.isMuted());
    syncLoop();
    if (!playing) d.resumeAudio();
  });

  d.ads.onLateReward((r: LateReward) => {
    if (lateSeen.has(r.id)) return;
    lateSeen.add(r.id);
    let ok = false;
    try {
      ok = d.grant(r.placement).ok;
    } catch (e) {
      onError(e);
    }
    if (!ok) return;
    for (const cb of [...lateSubs]) {
      try {
        cb(r.placement);
      } catch (e) {
        onError(e);
      }
    }
  });

  const run = async (p: RewardPlacement): Promise<RewardResult> => {
    try {
      d.saveBeforeAd();
    } catch (e) {
      onError(e); // 保存の失敗で広告の流れを止めない（Q-41 (a)）
    }
    let r: RewardResult;
    try {
      r = await d.ads.showRewarded(p);
    } catch (e) {
      onError(e);
      r = 'failed';
    }
    if (r === 'rewarded') {
      try {
        d.grant(p);
      } catch (e) {
        onError(e);
      }
    }
    return r;
  };

  const runBreak = (placement: 'M1' | 'M2'): void => {
    if (breaking) return; // 機会が重なったら後のものは渡さない（1 つずつ）
    breaking = true;
    d.life.setPaused('break', true);
    syncInput();
    syncLoop();
    const done = (): void => {
      breaking = false;
      syncInput();
      syncLoop();
      d.life.setPaused('break', false);
    };
    let pr: Promise<void>;
    try {
      pr = d.ads.breakOpportunity(placement);
    } catch (e) {
      onError(e);
      done();
      return;
    }
    pr.then(done, (e: unknown) => {
      onError(e); // ミッドゲームの失敗は何も出さない（Q-41 (d)）
      done();
    });
  };

  return {
    requestReward(p) {
      if (pending) return pending;
      const pr = run(p).finally(() => {
        pending = null;
      });
      pending = pr;
      return pr;
    },
    onEvents(evs) {
      for (const e of evs) if (e.type === 'BreakOpportunity') runBreak(e.placement);
    },
    syncHidden: syncLoop,
    onLateReward(cb) {
      lateSubs.add(cb);
      return () => {
        lateSubs.delete(cb);
      };
    },
    get breaking() {
      return breaking;
    },
  };
}
