// Poki HTML5 SDK v2 のモック（QA テスト戦略 §4-2 の Poki の表。L2 の契約テストだけ。E2E 用のビルドと契約テストの広げ方は S4 の BL-060）。
// S1 の tests/mocks/sdk.ts から移した（BL-072。置き場所は e2e/mocks/。確認事項 Q-28）。中身は変えていない。
// SDK の仕様（arch §12-3）が変わったら、アダプタ（src/platform/poki.ts）とこのモックを同じ PR で直す（readme.md）
import type { PokiSdk } from '../../src/platform/poki.ts';

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
