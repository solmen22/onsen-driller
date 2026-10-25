// 広告の流れ（arch §12-4・gdd §13。BL-059）: シート → 広告 → 報酬、ミッドゲームの機会、広告の間の停止
// - リワード（R1〜R3）: requestReward(p) は「保存を 1 回試す → showRewarded(p) → 'rewarded' のときだけ grant(p)」。
//   要求中にもう一度呼ばれたら同じ Promise を返す（連打しても要求も報酬も 1 回。TS-059-02）。アダプタの reject は 'failed'。
//   アダプタが同じ要求に結果を 2 回返しても、Promise は 1 回しか決まらないので報酬は 1 回（TS-059-06）。
//   保存の失敗・抑止（読み取り専用・録画モード・デモ）でも広告は要求する（Q-41 (a)。TS-059-16）
// - ミッドゲーム（M1・M2）: core の BreakOpportunity のイベントを受けたときだけ breakOpportunity(placement) を呼ぶ
//   （広告のタイマーは持たない。gdd §13-1。フラグが false なら core がイベントを出さない。Q-41 (e)）。
//   受けた時点で止まる理由 'break' を立て、Promise が決まったら外す。ストアはイベントの購読者に同じステップの通知より先に届けるので、
//   幕間（interlude）の理由が外れる前に 'break' が立ち、合図は gameplayStop → gameplayStart の 1 往復だけ（Nit 2。TS-059-11）
// - 広告の間の停止: 理由（hidden・ad〔onPlaying〕・break・prestige）からループを決める（syncLoop。PR #16 のレビュー S-3）。
//   掘削の入力・音は ad・break から決める。広告の最中にタブを見せてもループは動かず、隠れている間に広告が終わっても見えるまで動かない（TS-059-13）
// - 転生の確認の画面（BL-021。Q-47 (j)）: 開いている間（setPrestigeConfirm(true)）はループを止め、gameplay の理由 'prestige' を立てる。
//   ループの判定をここ 1 か所にまとめるので、確認の画面を開いている間に広告が終わってもループは動かない（PR #68 の QA の申し送り）。
//   タブが隠れて確認の画面が閉じたときは、'prestige' の理由を見えるようになるまで外さない（非表示の間は gameplayStart を出さない。
//   非表示を合図にしない CrazyGames でも同じ。決定 0010 の 15）。見えるようになったら（syncHidden）外す
// - 広告の終わり（onPlaying(false)）で BL-104 の音の再開の関数を呼ぶ（TS-059-15）
// - 遅れた報酬（Q-45。決定 0010 の 5）: アダプタの開始の時間切れで failed を返した後に、遅れて始まり最後まで見られた広告は、
//   アダプタの onLateReward（要求ごとの id つき）を受けて報酬を 1 回だけ付ける。同じ id は 2 回目から無視し（壊れたアダプタでも二重にしない）、
//   その要求の placement に付ける（今の要求〔pending〕とは別。今の要求の Promise・報酬には触れない）。core が断ったら
//   （R2 が休み中・R3 の鉱脈が消えたなど）何も付けず、知らせもしない。付けたら onLateReward の購読者（UI のトースト・シート）に知らせる
// - 払ったチケットの返却（決定 0010 の 11）: 遅れた報酬を core が断ったら（R2 が効果中か休み中・R1 が受け取り済み）、refund(p) を呼ぶ。
//   返すかどうか（チケットで払った回か・まだ返していないか）は core が決める。返した（refund）・上限で 0 枚（full）なら、
//   その種類を添えて購読者に知らせる（トースト）。返さないなら何も知らせない
// - 要求の前に予約する（reserve。R3 は鉱脈。要求の間に鉱脈が消えても、見終えたら報酬を付ける。PR #55 のレビュー S-5）
// - リワードの要求の間の停止（Poki だけ。pauseForReward。BL-060。PR #68 のレビュー S-2）: 要求の始まり（showRewarded の前）に
//   止まる理由 'reward' を立て、結果が決まって報酬を付けた後に外す（'break' と同じ扱い: gameplay・入力・ループを止める）。
//   Poki の「Order of events」の gameplayStop → rewardedBreak → gameplayStart の順になり、往復は 1 回（onPlaying の 'ad' は重なるだけ）。
//   CrazyGames は要求の間はポータルの側でゲームを止めるので立てない（シートの待ちの間もゲームは動く。Q-37 (e)）
// - 1 つの止まる理由の書き手は 1 か所: ライフサイクルの 'ad'・'break'・'prestige'・'reward' と、入力の 'ad' を書くのはこのファイルだけ
import type { GameEvent } from '../core/index.ts';
import type { LateReward, Platform, RewardPlacement, RewardResult, Target } from '../platform/types.ts';
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
  /** 要求の前の予約（R3 は出ている鉱脈を予約する。app/rewards.ts の reserveAd。PR #55 のレビュー S-5） */
  reserve?: (p: RewardPlacement) => void;
  /** 'rewarded' のとき（と遅れた報酬のとき）だけ呼ぶ（app/rewards.ts の grantAd）。core が受けたら ok: true */
  grant: (p: RewardPlacement) => { ok: boolean };
  /** 遅れた報酬を core が断ったときの、払ったチケットの返却（app/rewards.ts の refundAd。決定 0010 の 11） */
  refund?: (p: RewardPlacement) => 'refund' | 'full' | null;
  /** リワードの要求の始まりから結果まで gameplay を止めるか（Poki だけ。pausesForReward。BL-060・S-2） */
  pauseForReward?: boolean;
  onError?: (e: unknown) => void;
}

/**
 * そのポータルで、リワードの要求の間（広告の開始を待つ間も）gameplay を止めるか（BL-060。PR #68 のレビュー S-2）。
 * - poki: 止める（https://developers.poki.com/guide/sdk-overview の「Order of events」: gameplayStop() → rewardedBreak() → gameplayStart()）
 * - crazygames: 止めない（要求の間はポータルの側でゲームを止める。公式 https://docs.crazygames.com/sdk/game/ ）
 * - web・itch・dev: SDK がない。止めない（今までの形のまま）
 */
export const pausesForReward = (t: Target): boolean => t === 'poki';

/** 遅れた報酬（Q-45）の知らせの種類: reward は報酬が付いた、refund は払ったチケットを返した、full は上限で返せなかった（決定 0010 の 11） */
export type LateKind = 'reward' | 'refund' | 'full';

export interface AdFlow {
  /** UI の Ctx に渡す要求の口（シートの「動画」・おかえりの ×2） */
  requestReward(p: RewardPlacement): Promise<RewardResult>;
  /** store.onEvents に渡す（BreakOpportunity だけを見る） */
  onEvents(evs: readonly GameEvent[]): void;
  /** visibilitychange で呼ぶ（ループと、隠れている間に閉じた確認の画面の 'prestige' の理由を決め直す） */
  syncHidden(): void;
  /**
   * 転生の確認の画面（M3）が開いた（true）・閉じた（false）。app/main.ts が onPrestigeConfirmChange から呼ぶ（BL-021。Q-47 (j)）。
   * 開いている間はループと gameplay を止める。閉じたときに隠れていたら、'prestige' の理由は見えるまで残す（決定 0010 の 15）
   */
  setPrestigeConfirm(open: boolean): void;
  /** 遅れた報酬（Q-45）を付けたときに呼ぶ（UI のトースト・シート）。戻り値で購読をやめる */
  onLateReward(cb: (p: RewardPlacement, kind: LateKind) => void): () => void;
  /**
   * 広告の再生の始まり・終わり（アダプタの onPlaying。二重の通知は除いた後）を購読する。戻り値で購読をやめる。
   * UI の待ちの案内（「広告を読み込んでいます…」）を、広告が始まったら消すのに使う（決定 0010 の 7）
   */
  onAdPlaying(cb: (playing: boolean) => void): () => void;
  /** テスト用: 今ミッドゲームの機会を渡している途中か */
  readonly breaking: boolean;
}

export function createAdFlow(d: AdFlowDeps): AdFlow {
  const onError = d.onError ?? (() => {});
  let adPlaying = false;
  let breaking = false;
  /** 転生の確認の画面を開いているか */
  let prestigeConfirm = false;
  /** ライフサイクルの 'prestige' を立てているか（確認の画面が開いている間と、隠れている間に閉じてから見えるまで） */
  let prestigeHeld = false;
  /** リワードの要求の間（pauseForReward のときだけ立つ） */
  let rewarding = false;
  let pending: Promise<RewardResult> | null = null;
  /** 遅れた報酬を付けた（か断られた）要求の id。同じ id を 2 回扱わない（Q-45） */
  const lateSeen = new Set<number>();
  const lateSubs = new Set<(p: RewardPlacement, kind: LateKind) => void>();
  const playingSubs = new Set<(playing: boolean) => void>();

  const syncLoop = (): void => {
    if (d.isHidden() || adPlaying || breaking || prestigeConfirm || rewarding) d.loop.pause();
    else d.loop.resume();
  };
  const syncPrestige = (): void => {
    const held = prestigeConfirm || (prestigeHeld && d.isHidden());
    if (held === prestigeHeld) return;
    prestigeHeld = held;
    d.life.setPaused('prestige', held);
  };
  const syncInput = (): void => d.input.setBlocked('ad', adPlaying || breaking || rewarding);
  /** リワードの要求の間の停止を立てる・外す（pauseForReward のときだけ。外すのは報酬を付けた後） */
  const setRewarding = (on: boolean): void => {
    if (!d.pauseForReward || rewarding === on) return;
    rewarding = on;
    d.life.setPaused('reward', on);
    syncInput();
    syncLoop();
  };

  d.ads.onPlaying((playing) => {
    if (playing === adPlaying) return; // 壊れたアダプタの二重の通知は無視する（TS-059-06）
    adPlaying = playing;
    d.life.setPaused('ad', playing);
    syncInput();
    d.setMuted(playing || d.isMuted());
    syncLoop();
    if (!playing) d.resumeAudio();
    for (const cb of [...playingSubs]) {
      try {
        cb(playing);
      } catch (e) {
        onError(e);
      }
    }
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
    let kind: LateKind | null = ok ? 'reward' : null;
    if (!ok) {
      try {
        kind = d.refund?.(r.placement) ?? null;
      } catch (e) {
        onError(e);
      }
    }
    if (kind === null) return;
    for (const cb of [...lateSubs]) {
      try {
        cb(r.placement, kind);
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
    try {
      d.reserve?.(p); // 要求を始めた時点で予約する（R3 の鉱脈が要求の間に消えても、見終えたら報酬を付ける。S-5）
    } catch (e) {
      onError(e);
    }
    // Poki: rewardedBreak の前に gameplayStop（S-2）。SDK を呼ばずに返るとき（SDK がない・前の広告がまだ）は立てない（N-1）
    if (d.ads.rewardedReady?.() !== false) setRewarding(true);
    try {
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
    } finally {
      setRewarding(false); // 報酬を付けた後に gameplayStart（往復は 1 回）
    }
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
    syncHidden() {
      syncPrestige();
      syncLoop();
    },
    setPrestigeConfirm(open) {
      if (open === prestigeConfirm) return;
      prestigeConfirm = open;
      syncPrestige();
      syncLoop();
    },
    onLateReward(cb) {
      lateSubs.add(cb);
      return () => {
        lateSubs.delete(cb);
      };
    },
    onAdPlaying(cb) {
      playingSubs.add(cb);
      return () => {
        playingSubs.delete(cb);
      };
    },
    get breaking() {
      return breaking;
    },
  };
}
