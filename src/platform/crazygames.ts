// CrazyGames HTML5 SDK v3 のアダプタ（arch §12-3）。
// 仕様: https://docs.crazygames.com/sdk/intro/ ・ /sdk/video-ads/ ・ /sdk/data/ ・ /sdk/game/ ・ /sdk/user/
import { browserLocale, CallLog, gameplayGate, Listeners, withTimeout } from './base.ts';
import { localStore } from './storage.ts';
import type { KeyValueStore, Platform, RewardResult } from './types.ts';

export type CgAdType = 'midgame' | 'rewarded';
/** 既知のエラーコード（docs.crazygames.com/sdk/video-ads/）。未知の値も来うるので code は string で受ける */
export type CgAdErrorCode = 'unfilled' | 'adblock' | 'adsDisabledBasicLaunch' | 'adCooldown' | 'other';
export interface CgAdError {
  code: string;
  message?: string;
}
export interface CgAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: CgAdError) => void;
}
/** アダプタが使う SDK の部分（モックはこの形を満たす） */
export interface CrazySdk {
  init(): Promise<void>;
  /** 'local'・'crazygames'・'disabled' */
  environment: string;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (s: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: CgAdType, cb: CgAdCallbacks): void;
    hasAdblock?(): Promise<boolean>;
  };
  data?: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
  user?: { systemInfo?: { locale?: string } };
}

export interface CrazyGamesOptions {
  getSdk: () => CrazySdk | undefined;
  /** Basic Launch 中は false（VITE_CG_ADS）。広告を一度も要求しない */
  adsEnabled: boolean;
  initTimeoutMs?: number;
}

export function createCrazyGamesPlatform(opts: CrazyGamesOptions): Platform {
  const log = new CallLog();
  const playingL = new Listeners<boolean>();
  const mutedL = new Listeners<boolean>();
  let sdk: CrazySdk | null = null; // init が成功し environment が disabled でないときだけ入る
  let adblock = false;
  let muted = false;
  let inFlight: Promise<RewardResult> | null = null;
  let storage: KeyValueStore = localStore();
  const safe = (name: string, fn: (s: CrazySdk) => void): void => {
    log.push(name);
    if (!sdk) return;
    try {
      fn(sdk);
    } catch {
      /* SDK の例外でゲームを止めない */
    }
  };
  const gate = gameplayGate(
    log,
    () => sdk?.game.gameplayStart(),
    () => sdk?.game.gameplayStop(),
  );

  function request(type: CgAdType): Promise<RewardResult> {
    return new Promise((resolve) => {
      const s = sdk;
      if (!s) return resolve('unavailable');
      let started = false;
      let done = false;
      const finish = (r: RewardResult): void => {
        if (done) return;
        done = true;
        if (started) playingL.emit(false);
        resolve(r);
      };
      log.push('requestAd', type);
      try {
        s.ad.requestAd(type, {
          adStarted: () => {
            started = true;
            playingL.emit(true);
          },
          adFinished: () => finish('rewarded'),
          adError: (e) => {
            log.push('adError', e.code);
            if (e.code === 'adblock') adblock = true;
            finish(e.code === 'unfilled' || e.code === 'adblock' || e.code === 'adsDisabledBasicLaunch' ? 'unavailable' : 'failed');
          },
        });
      } catch {
        finish('failed');
      }
    });
  }

  return {
    target: 'crazygames',
    async init() {
      log.push('init');
      const s = opts.getSdk();
      if (!s) return;
      const r = await withTimeout(s.init(), opts.initTimeoutMs);
      if (r === 'timeout' || r === 'error') {
        log.push('initFailed', r);
        return;
      }
      if (s.environment === 'disabled') {
        log.push('environment', 'disabled'); // CrazyGames 以外のドメイン: web と同じ動作にする
        return;
      }
      log.push('environment', s.environment);
      sdk = s;
      if (s.data) {
        const d = s.data;
        storage = {
          kind: 'sdk',
          // 読めないときは例外をそのまま投げる（「ない」＝null と区別する。KeyValueStore.get の約束。レビュー S-1）
          get: (k) => d.getItem(k),
          set: (k, v) => {
            try {
              d.setItem(k, v);
              return true;
            } catch {
              return false;
            }
          },
          remove: (k) => {
            try {
              d.removeItem(k);
            } catch {
              /* 無視 */
            }
          },
        };
      }
      muted = !!s.game.settings?.muteAudio;
      s.game.addSettingsChangeListener?.((st) => {
        muted = !!st.muteAudio;
        mutedL.emit(muted);
      });
      if (opts.adsEnabled && s.ad.hasAdblock) {
        try {
          adblock = await s.ad.hasAdblock();
        } catch {
          /* 無視 */
        }
      }
    },
    loadingStart: () => safe('loadingStart', (s) => s.game.loadingStart()),
    loadingStop: () => safe('loadingStop', (s) => s.game.loadingStop()),
    gameplayStart: gate.start,
    gameplayStop: gate.stop,
    happyTime: () => safe('happyTime', (s) => s.game.happytime()),
    ads: {
      rewardedAvailable: () => opts.adsEnabled && sdk !== null && !adblock,
      showRewarded(p) {
        log.push('showRewarded', p);
        if (!(opts.adsEnabled && sdk !== null && !adblock)) return Promise.resolve('unavailable');
        // 連打しても要求は 1 回
        inFlight ??= request('rewarded').finally(() => {
          inFlight = null;
        });
        return inFlight;
      },
      async breakOpportunity(p) {
        log.push('breakOpportunity', p);
        if (!opts.adsEnabled || !sdk) return;
        await request('midgame');
      },
      onPlaying: (cb) => playingL.add(cb),
    },
    get storage() {
      return storage;
    },
    locale: () => sdk?.user?.systemInfo?.locale ?? browserLocale(),
    isMuted: () => muted,
    onMutedChange: (cb) => mutedL.add(cb),
    openExternalLink: (url) => {
      log.push('openExternalLink', url);
      window.open(url, '_blank', 'noopener');
    },
    calls: () => log.list(),
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazySdk };
  }
}
