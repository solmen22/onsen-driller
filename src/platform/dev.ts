// dev・e2e 用のアダプタ: 画面の上の偽の広告（成功・失敗・在庫なしを切り替えられる）
import { browserLocale, CallLog, gameplayGate, Listeners } from './base.ts';
import { localStore } from './storage.ts';
import type { Platform, RewardResult } from './types.ts';

export interface DevPlatform extends Platform {
  setAdResult(r: RewardResult): void;
}

export function createDevPlatform(adMs = 800): DevPlatform {
  const log = new CallLog();
  const playingL = new Listeners<boolean>();
  const gate = gameplayGate(log, () => {}, () => {});
  let next: RewardResult = 'rewarded';
  const fakeAd = (label: string): Promise<void> =>
    new Promise((resolve) => {
      playingL.emit(true);
      const el = document.createElement('div');
      el.textContent = `FAKE AD (${label})`;
      el.dataset.testid = 'fake-ad';
      el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#000c;color:#fff;font:16px monospace;z-index:9999';
      document.body.appendChild(el);
      setTimeout(() => {
        el.remove();
        playingL.emit(false);
        resolve();
      }, adMs);
    });
  return {
    target: 'dev',
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
      rewardedAvailable: () => next !== 'unavailable',
      async showRewarded(p) {
        log.push('showRewarded', p);
        if (next === 'unavailable') return 'unavailable';
        await fakeAd(`rewarded ${p}`);
        return next;
      },
      async breakOpportunity(p) {
        log.push('breakOpportunity', p);
        await fakeAd(`midgame ${p}`);
      },
      onPlaying: (cb) => playingL.add(cb),
    },
    storage: localStore(),
    locale: browserLocale,
    isMuted: () => false,
    onMutedChange: () => {},
    openExternalLink: (url) => log.push('openExternalLink', url),
    calls: () => log.list(),
    setAdResult: (r) => {
      next = r;
    },
  };
}
