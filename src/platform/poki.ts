// Poki HTML5 SDK v2 のアダプタ（arch §12-3）。仕様: https://developers.poki.com/guide/sdk-html5
import { browserLocale, CallLog, gameplayGate, Listeners, withTimeout } from './base.ts';
import { localStore } from './storage.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type LateReward, type Platform, type RewardPlacement, type RewardResult } from './types.ts';

export interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /**
   * 引数はコールバックの形（広告の開始で呼ばれる。音を止める所）。Promise は値なしで決まる（BL-060。2026-10-26 に公式の文書で確認:
   * https://developers.poki.com/guide/sdk-html5 の `PokiSDK.commercialBreak(() => { ... }).then(() => { ... })`）
   */
  commercialBreak(onStart?: () => void): Promise<void>;
  /**
   * 引数はコールバックの形。Promise は success（true なら動画が出たので報酬を付ける、false なら付けない）で決まる
   * （2026-10-26 に公式の文書で確認: 同じページの `PokiSDK.rewardedBreak(() => { ... }).then((success) => { ... })`）。
   * `{ size, onStart }` のようなオブジェクトの形は、公式の文書（HTML5・SDK の概要・エンジン別のページ）には載っていない。
   * 文書に版ごとの違いの記載はなく、版は script の URL の v2 だけ
   */
  rewardedBreak(onStart?: () => void): Promise<boolean>;
  /**
   * 外部へのリンクは、URL を直接開かずにこれを通す（2026-10-26 に公式の文書で確認: https://developers.poki.com/guide/requirements-quality
   * の `PokiSDK.openExternalLink('URL')`。前は HTML5 のページだけを見て「記載がない」としていた〔2026-09-28〕）。
   * 型は省略可のままにし、ない SDK では window.open にする
   */
  openExternalLink?(url: string): void;
}

export interface PokiOptions {
  getSdk: () => PokiSdk | undefined;
  initTimeoutMs?: number;
}

export function createPokiPlatform(opts: PokiOptions): Platform {
  const log = new CallLog();
  const playingL = new Listeners<boolean>();
  const mutedL = new Listeners<boolean>();
  /**
   * SDK の広告の呼び出しが決まるまで（busy の間）ずっと消音する（BL-146。決定 0012 の追記 Q-56 (a)。Poki の要件「広告の間は音を止める」）。
   * onStart は呼ばれないことがある（公式の文書）ので、30 秒の待ちの間・開始の時間切れで画面の側が戻った後も、動画が出ているかもしれない間は
   * 鳴らさない。SDK が決まらないときは、要求から AD_END_TIMEOUT_MS で解き、calls() に muteHold: timeout を残す（Q-56 (b)）。
   * 再生中（onPlaying が true の間）も消音として知らせる（main.ts の onMutedChange が、再生中の広告の上で音を戻さないため）
   */
  let muteHeld = false;
  let mutedSent = false;
  const isMutedNow = (): boolean => muteHeld || playingCount > 0;
  const syncMuted = (): void => {
    const m = isMutedNow();
    if (m === mutedSent) return;
    mutedSent = m;
    mutedL.emit(m);
  };
  const setMuteHeld = (on: boolean, why: 'on' | 'off' | 'timeout' = on ? 'on' : 'off'): void => {
    if (muteHeld === on) return;
    muteHeld = on;
    log.push('muteHold', why);
    syncMuted();
  };
  let muteTimer: ReturnType<typeof setTimeout> | undefined;
  const lateL = new Listeners<LateReward>();
  /** 遅れた報酬の id（要求ごとに 1 つ。Q-45） */
  let lateSeq = 0;
  /** 再生中の広告の数。0 → 1 で onPlaying(true)、1 → 0 で false（CrazyGames のアダプタと同じ。ふだんは 0 か 1） */
  let playingCount = 0;
  const setPlaying = (on: boolean): void => {
    if (on) {
      if (playingCount++ === 0) {
        syncMuted();
        playingL.emit(true);
      }
    } else if (playingCount > 0 && --playingCount === 0) {
      syncMuted();
      playingL.emit(false);
    }
  };
  let sdk: PokiSdk | null = null;
  let inFlight: Promise<RewardResult> | null = null;
  /**
   * SDK の広告の呼び出し（rewardedBreak・commercialBreak）がまだ終わっていない。Poki の広告は同時に 1 つなので、
   * 時間切れで結果を返した後も、SDK が終えるまで次を呼ばない（リワードは failed、ミッドゲームは渡さない）
   */
  let busy = false;
  const storage = localStore();
  /**
   * SDK に送る gameplay の合図（決定 0012 の D-2。PR #84 のレビュー N-2 の案 A）。ライフサイクルが望む状態（want）を覚え、
   * **SDK の広告の呼び出しが決まるまで（busy の間）は送らない**。Poki の要件「広告の間に SDK の合図を出さない」
   * （https://developers.poki.com/guide/requirements-quality）と、例の `.then` の中で gameplayStart の形に合わせる。
   * 開始の時間切れ（Q-35 (d)）で画面の側（ループ・入力・案内）が戻っても、SDK には決まるまで gameplayStart を送らず、
   * 遅れて始まった再生の gameplayStop も送らない。決まった時点で want が送った状態と違えば 1 回だけ送る（往復は 1 回）
   */
  let want = false;
  const gate = gameplayGate(
    log,
    () => sdk?.gameplayStart(),
    () => sdk?.gameplayStop(),
  );
  const sendGameplay = (): void => {
    if (busy) return;
    if (want) gate.start();
    else gate.stop();
  };
  /** SDK の広告の呼び出しが決まった（busy を外し、保留していた合図を送る） */
  const release = (): void => {
    busy = false;
    clearTimeout(muteTimer);
    setMuteHeld(false);
    sendGameplay();
  };

  /**
   * 広告を 1 回流す（BL-060。CrazyGames の request と同じ形。Q-35 (d)・Q-45）。結果はちょうど 1 回返し、onPlaying は true の後に必ず false。
   * - 開始（onStart）が AD_START_TIMEOUT_MS 来なければ failed を返す。その後に遅れて始まったら、再生の間だけ止める
   * - 開始の後に SDK の Promise が AD_END_TIMEOUT_MS 決まらなければ、failed を返して onPlaying(false)（後から来た結果は無視）
   * - 開始の時間切れの後にリワードが最後まで見られたら（rewardedBreak が true）、onLateReward を 1 回出す。onStart が来なくても
   *   出す（onStart は呼ばれないことがある。true は動画が出て見終えたという意味。BL-146）
   * - SDK が決まるまで消音する（要求から最長 AD_END_TIMEOUT_MS。BL-146・Q-56。setMuteHeld）
   * - SDK の例外・reject は failed。rewardedBreak の false も failed（報酬なし）
   */
  function runBreak(call: (onStart: () => void) => Promise<boolean | void>, rewarded: boolean, placement?: RewardPlacement): Promise<RewardResult> {
    return new Promise((resolve) => {
      let phase: 'waiting' | 'playing' | 'over' = 'waiting';
      let settled = false;
      let startTimedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (r: RewardResult): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      const end = (r: RewardResult): void => {
        if (phase === 'over') return;
        clearTimeout(timer);
        const wasPlaying = phase === 'playing';
        phase = 'over';
        if (wasPlaying) setPlaying(false);
        if (startTimedOut && r === 'rewarded' && placement) {
          log.push('lateReward', placement);
          lateL.emit({ id: ++lateSeq, placement });
        }
        settle(r);
      };
      const onStart = (): void => {
        if (phase !== 'waiting') return;
        clearTimeout(timer);
        phase = 'playing';
        setPlaying(true);
        timer = setTimeout(() => {
          log.push('adTimeout', 'end');
          end('failed');
        }, AD_END_TIMEOUT_MS);
      };
      timer = setTimeout(() => {
        if (phase !== 'waiting') return;
        log.push('adTimeout', 'start');
        startTimedOut = true;
        settle('failed'); // 遅れて onStart が来たら、その再生の間は止める（phase は waiting のまま）
      }, AD_START_TIMEOUT_MS);
      busy = true;
      setMuteHeld(true);
      clearTimeout(muteTimer);
      muteTimer = setTimeout(() => setMuteHeld(false, 'timeout'), AD_END_TIMEOUT_MS); // SDK が決まらなくても消音のままにしない（Q-56 (b)）
      let pr: Promise<boolean | void>;
      try {
        pr = call(onStart);
      } catch {
        release();
        end('failed');
        return;
      }
      // 決まったら、先に保留していた合図を送ってから結果を返す（ふつうの経路では want は stop のままなので何も送らず、
      // ad-flow が報酬を付けた後に gameplayStart。開始の時間切れの後なら、ここで gameplayStart が 1 回）
      pr.then(
        (v) => {
          release();
          end(!rewarded || v === true ? 'rewarded' : 'failed');
        },
        () => {
          release();
          end('failed');
        },
      );
    });
  }

  return {
    target: 'poki',
    async init() {
      log.push('init');
      const s = opts.getSdk();
      if (!s) return;
      const r = await withTimeout(s.init(), opts.initTimeoutMs);
      // Poki は init が reject でも続行してよい（公式の例）。SDK 自体は使う
      log.push('initResult', typeof r === 'string' ? r : 'ok');
      sdk = s;
    },
    loadingStart: () => log.push('loadingStart'),
    loadingStop: () => {
      log.push('loadingStop');
      try {
        sdk?.gameLoadingFinished();
      } catch {
        /* 無視 */
      }
    },
    gameplayStart: () => {
      want = true;
      sendGameplay();
    },
    gameplayStop: () => {
      want = false;
      sendGameplay();
    },
    happyTime: () => log.push('happyTime'),
    ads: {
      rewardedAvailable: () => sdk !== null,
      rewardedReady: () => sdk !== null && !busy,
      showRewarded(p) {
        log.push('showRewarded', p);
        const s = sdk;
        if (!s) return Promise.resolve('unavailable');
        if (inFlight) return inFlight;
        if (busy) {
          log.push('adBusy', p); // 前の広告を SDK がまだ終えていない（時間切れの後）
          return Promise.resolve('failed');
        }
        const pr = runBreak((onStart) => s.rewardedBreak(onStart), true, p).finally(() => {
          inFlight = null;
        });
        inFlight = pr;
        return pr;
      },
      async breakOpportunity(p) {
        log.push('breakOpportunity', p);
        const s = sdk;
        if (!s) return;
        if (busy) {
          log.push('adBusy', p);
          return;
        }
        await runBreak((onStart) => s.commercialBreak(onStart), false);
      },
      onPlaying: (cb) => playingL.add(cb),
      onLateReward: (cb) => lateL.add(cb),
    },
    storage,
    locale: browserLocale,
    isMuted: isMutedNow,
    onMutedChange: (cb) => mutedL.add(cb),
    openExternalLink: (url) => {
      log.push('openExternalLink', url);
      if (sdk?.openExternalLink) sdk.openExternalLink(url);
      else window.open(url, '_blank', 'noopener');
    },
    calls: () => log.list(),
  };
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}
