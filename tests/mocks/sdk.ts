// ポータル SDK のモック（QA test-strategy §4-2 の振る舞い。arch §12-3 の API 一覧と同期させる）
import type { CgAdCallbacks, CgAdErrorCode, CgAdType, CrazySdk } from '../../src/platform/crazygames.ts';
import type { PokiSdk } from '../../src/platform/poki.ts';

export type CgAdBehavior = 'finish' | CgAdErrorCode | 'silent';

export interface CrazyMock extends CrazySdk {
  log: string[];
  adBehavior: CgAdBehavior;
  initBehavior: 'ok' | 'reject' | 'hang';
  store: Map<string, string>;
  setMute(m: boolean): void;
}

export function crazyMock(env: 'local' | 'crazygames' | 'disabled' = 'local'): CrazyMock {
  const log: string[] = [];
  const listeners: ((s: { muteAudio?: boolean }) => void)[] = [];
  const store = new Map<string, string>();
  const m: CrazyMock = {
    log,
    adBehavior: 'finish',
    initBehavior: 'ok',
    store,
    environment: env,
    init: () => {
      log.push('init');
      if (m.initBehavior === 'reject') return Promise.reject(new Error('init failed'));
      if (m.initBehavior === 'hang') return new Promise(() => {});
      return Promise.resolve();
    },
    game: {
      loadingStart: () => log.push('loadingStart'),
      loadingStop: () => log.push('loadingStop'),
      gameplayStart: () => log.push('gameplayStart'),
      gameplayStop: () => log.push('gameplayStop'),
      happytime: () => log.push('happytime'),
      settings: { muteAudio: false },
      addSettingsChangeListener: (fn) => listeners.push(fn),
    },
    ad: {
      requestAd: (type: CgAdType, cb: CgAdCallbacks) => {
        log.push(`requestAd:${type}`);
        const b = m.adBehavior;
        queueMicrotask(() => {
          if (b === 'silent') return;
          if (b === 'finish') {
            cb.adStarted?.();
            cb.adFinished?.();
          } else cb.adError?.({ code: b, message: b });
        });
      },
      hasAdblock: () => Promise.resolve(false),
    },
    data: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        if (v.length > 1_000_000) throw new Error('dataLimitExcedeed');
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    },
    user: { systemInfo: { locale: 'ja-JP' } },
    setMute: (mute) => {
      for (const fn of listeners) fn({ muteAudio: mute });
    },
  };
  return m;
}

export interface PokiMock extends PokiSdk {
  log: string[];
  rewarded: boolean;
  initReject: boolean;
}

export function pokiMock(): PokiMock {
  const log: string[] = [];
  const m: PokiMock = {
    log,
    rewarded: true,
    initReject: false,
    init: () => (log.push('init'), m.initReject ? Promise.reject(new Error('x')) : Promise.resolve()),
    gameLoadingFinished: () => log.push('gameLoadingFinished'),
    gameplayStart: () => log.push('gameplayStart'),
    gameplayStop: () => log.push('gameplayStop'),
    commercialBreak: (onStart) => {
      log.push('commercialBreak');
      onStart?.();
      return Promise.resolve();
    },
    rewardedBreak: (onStart) => {
      log.push('rewardedBreak');
      onStart?.();
      return Promise.resolve(m.rewarded);
    },
  };
  return m;
}
