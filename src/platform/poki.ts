// Poki HTML5 SDK v2 のアダプタ（arch §12-3）。仕様: https://developers.poki.com/guide/sdk-html5
import { browserLocale, CallLog, gameplayGate, Listeners, withTimeout } from './base.ts';
import { localStore } from './storage.ts';
import type { Platform, RewardResult } from './types.ts';

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
  let sdk: PokiSdk | null = null;
  let inFlight: Promise<RewardResult> | null = null;
  const storage = localStore();
  const gate = gameplayGate(
    log,
    () => sdk?.gameplayStart(),
    () => sdk?.gameplayStop(),
  );

  async function runBreak<T>(fn: (onStart: () => void) => Promise<T>): Promise<T | 'error'> {
    let started = false;
    try {
      return await fn(() => {
        started = true;
        playingL.emit(true);
      });
    } catch {
      return 'error';
    } finally {
      if (started) playingL.emit(false);
    }
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
        inFlight ??= runBreak((onStart) => s.rewardedBreak(onStart))
          .then((ok): RewardResult => (ok === true ? 'rewarded' : 'failed'))
          .finally(() => {
            inFlight = null;
          });
        return inFlight;
      },
      async breakOpportunity(p) {
        log.push('breakOpportunity', p);
        const s = sdk;
        if (!s) return;
        await runBreak((onStart) => s.commercialBreak(onStart));
      },
      onPlaying: (cb) => playingL.add(cb),
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
