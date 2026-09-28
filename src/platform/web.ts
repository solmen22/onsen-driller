// web（自サイト）・itch のアダプタ: SDK なし・広告なし・localStorage
import { browserLocale, CallLog, gameplayGate } from './base.ts';
import { localStore } from './storage.ts';
import type { Platform } from './types.ts';

export function createWebPlatform(target: 'web' | 'itch'): Platform {
  const log = new CallLog();
  const gate = gameplayGate(log, () => {}, () => {});
  const storage = localStore();
  return {
    target,
    init: async () => {
      log.push('init');
      return Promise.resolve();
    },
    loadingStart: () => log.push('loadingStart'),
    loadingStop: () => log.push('loadingStop'),
    gameplayStart: gate.start,
    gameplayStop: gate.stop,
    happyTime: () => log.push('happyTime'),
    ads: {
      rewardedAvailable: () => false,
      showRewarded: async () => Promise.resolve('unavailable' as const),
      breakOpportunity: async () => Promise.resolve(),
      onPlaying: () => {},
    },
    storage,
    locale: browserLocale,
    isMuted: () => false,
    onMutedChange: () => {},
    openExternalLink: (url) => {
      log.push('openExternalLink', url);
      window.open(url, '_blank', 'noopener');
    },
    calls: () => log.list(),
  };
}
