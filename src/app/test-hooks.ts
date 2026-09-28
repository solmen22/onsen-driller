// テスト用フック window.__game（arch §8-4 の PoC 版）。VITE_TEST_HOOKS=true のビルドにだけ入る
import { advance, stateHash, type Action, type GameState } from '../core/index.ts';
import type { Platform } from '../platform/types.ts';
import type { View } from '../view/game.ts';
import type { Loop } from './loop.ts';
import type { PerfMonitor } from './perf.ts';
import type { GameStore } from './store.ts';

export interface HookDeps {
  store: GameStore;
  loop: Loop;
  perf: PerfMonitor | null;
  platform: Platform;
  view: View;
  contextEvents: string[];
}

export function install(d: HookDeps): void {
  const hooks = {
    version: __APP_VERSION__,
    target: d.platform.target,
    getState: (): GameState => d.store.state,
    stateHash: (): string => stateHash(d.store.state),
    dispatch: (a: Action) => d.store.dispatch(a),
    pause: () => d.loop.pause(),
    resume: () => d.loop.resume(),
    advance: (ms: number) => advance(d.store.state, ms),
    perf: { reset: () => d.perf?.reset(), stats: () => d.perf?.stats() ?? null },
    view: {
      renderer: () => d.view.rendererName(),
      particles: () => d.view.aliveParticles(),
      loseContext: () => d.view.loseContext(),
      restoreContext: () => d.view.restoreContext(),
      contextEvents: () => [...d.contextEvents],
      frame: () => d.view.game.loop.frame,
      /** 描画結果の色の種類の数（真っ黒・真っ白なら 1〜2）。コンテキスト喪失からの復帰の確認用 */
      snapshotColors: () =>
        new Promise<number>((resolve) => {
          d.view.game.renderer.snapshot((img) => {
            if (!(img instanceof HTMLImageElement)) return resolve(-1);
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            if (!ctx) return resolve(-1);
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            const set = new Set<number>();
            for (let i = 0; i < data.length; i += 4 * 97) set.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
            resolve(set.size);
          });
        }),
    },
    platform: {
      calls: () => d.platform.calls(),
      showRewarded: (p: 'R1' | 'R2' | 'R3') => d.platform.ads.showRewarded(p),
      breakOpportunity: (p: 'M1' | 'M2') => d.platform.ads.breakOpportunity(p),
      rewardedAvailable: () => d.platform.ads.rewardedAvailable(),
      setAdResult: (r: 'rewarded' | 'failed' | 'unavailable') => {
        const p = d.platform as Platform & { setAdResult?: (x: typeof r) => void };
        p.setAdResult?.(r);
      },
    },
  };
  (window as unknown as Record<string, unknown>)['__game'] = hooks;
}
