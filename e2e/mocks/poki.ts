// Poki HTML5 SDK v2 のモック（QA テスト戦略 §4-2 の Poki の表。L2 の契約テストだけ。E2E 用のビルドは作らない〔QA §9 #1〕）。
// S1 の tests/mocks/sdk.ts から移した（BL-072。置き場所は e2e/mocks/。確認事項 Q-28）。
// SDK の仕様（arch §12-3）が変わったら、アダプタ（src/platform/poki.ts）とこのモックを同じ PR で直す（readme.md）
// BL-060: openExternalLink の URL の記録と、広告を手で進める形（manual）を足した。manual でなければ前と同じ動き
// （呼ばれたらすぐ onStart → 結果で resolve）
import type { PokiSdk } from '../../src/platform/poki.ts';

export interface PokiMock extends PokiSdk {
  log: string[];
  rewarded: boolean;
  initReject: boolean;
  /** openExternalLink に渡された URL */
  links: string[];
  /** true なら、広告は start()・finish() を呼ぶまで始まらず終わらない（時間切れ・遅れた開始を確かめる） */
  manual: boolean;
  /** manual の広告を始める（onStart を呼ぶ） */
  start(): void;
  /** manual の広告を終える（rewardedBreak は rewarded の値、commercialBreak は undefined で resolve。reject なら reject） */
  finish(reject?: boolean): void;
}

export function pokiMock(): PokiMock {
  const log: string[] = [];
  let pending: { onStart?: () => void; resolve: (v: boolean | void) => void; reject: (e: unknown) => void; rewarded: boolean } | null = null;
  const run = (name: string, rewarded: boolean, onStart?: () => void): Promise<boolean | void> => {
    log.push(name);
    if (!m.manual) {
      onStart?.();
      return Promise.resolve(rewarded ? m.rewarded : undefined);
    }
    return new Promise((resolve, reject) => {
      pending = { onStart, resolve, reject, rewarded };
    });
  };
  const m: PokiMock = {
    log,
    rewarded: true,
    initReject: false,
    links: [],
    manual: false,
    init: () => (log.push('init'), m.initReject ? Promise.reject(new Error('x')) : Promise.resolve()),
    gameLoadingFinished: () => log.push('gameLoadingFinished'),
    gameplayStart: () => log.push('gameplayStart'),
    gameplayStop: () => log.push('gameplayStop'),
    commercialBreak: (onStart) => run('commercialBreak', false, onStart) as Promise<void>,
    rewardedBreak: (onStart) => run('rewardedBreak', true, onStart) as Promise<boolean>,
    openExternalLink: (url) => {
      log.push('openExternalLink');
      m.links.push(url);
    },
    start: () => pending?.onStart?.(),
    finish: (reject = false) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (reject) p.reject(new Error('sdk'));
      else p.resolve(p.rewarded ? m.rewarded : undefined);
    },
  };
  return m;
}
