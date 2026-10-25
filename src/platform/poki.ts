// Poki HTML5 SDK v2 のアダプタ（arch §12-3）。仕様: https://developers.poki.com/guide/sdk-html5
import { browserLocale, CallLog, gameplayGate, Listeners, withTimeout } from './base.ts';
import { localStore } from './storage.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type LateReward, type Platform, type RewardPlacement, type RewardResult } from './types.ts';

export interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(onStart?: () => void): Promise<boolean>;
  /** 公式の HTML5 ページには記載がない（2026-09-28 確認）。あれば使い、なければ window.open */
  openExternalLink?(url: string): void;
}

export interface PokiOptions {
  getSdk: () => PokiSdk | undefined;
  initTimeoutMs?: number;
}

export function createPokiPlatform(opts: PokiOptions): Platform {
  const log = new CallLog();
  const playingL = new Listeners<boolean>();
  const lateL = new Listeners<LateReward>();
  /** 遅れた報酬の id（要求ごとに 1 つ。Q-45） */
  let lateSeq = 0;
  /** 再生中の広告の数。0 → 1 で onPlaying(true)、1 → 0 で false（CrazyGames のアダプタと同じ。ふだんは 0 か 1） */
  let playingCount = 0;
  const setPlaying = (on: boolean): void => {
    if (on) {
      if (playingCount++ === 0) playingL.emit(true);
    } else if (playingCount > 0 && --playingCount === 0) playingL.emit(false);
  };
  let sdk: PokiSdk | null = null;
  let inFlight: Promise<RewardResult> | null = null;
  /**
   * SDK の広告の呼び出し（rewardedBreak・commercialBreak）がまだ終わっていない。Poki の広告は同時に 1 つなので、
   * 時間切れで結果を返した後も、SDK が終えるまで次を呼ばない（リワードは failed、ミッドゲームは渡さない）
   */
  let busy = false;
  const storage = localStore();
  const gate = gameplayGate(
    log,
    () => sdk?.gameplayStart(),
    () => sdk?.gameplayStop(),
  );

  /**
   * 広告を 1 回流す（BL-060。CrazyGames の request と同じ形。Q-35 (d)・Q-45）。結果はちょうど 1 回返し、onPlaying は true の後に必ず false。
   * - 開始（onStart）が AD_START_TIMEOUT_MS 来なければ failed を返す。その後に遅れて始まったら、再生の間だけ止める
   * - 開始の後に SDK の Promise が AD_END_TIMEOUT_MS 決まらなければ、failed を返して onPlaying(false)（後から来た結果は無視）
   * - 開始の時間切れの後に遅れて始まったリワードが最後まで見られたら（rewardedBreak が true）、onLateReward を 1 回出す
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
        if (startTimedOut && wasPlaying && r === 'rewarded' && placement) {
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
      let pr: Promise<boolean | void>;
      try {
        pr = call(onStart);
      } catch {
        busy = false;
        end('failed');
        return;
      }
      pr.then(
        (v) => {
          busy = false;
          end(!rewarded || v === true ? 'rewarded' : 'failed');
        },
        () => {
          busy = false;
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
    gameplayStart: gate.start,
    gameplayStop: gate.stop,
    happyTime: () => log.push('happyTime'),
    ads: {
      rewardedAvailable: () => sdk !== null,
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
    isMuted: () => false,
    onMutedChange: () => {},
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
