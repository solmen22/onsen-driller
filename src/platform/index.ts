// loadPlatform(): VITE_TARGET（ビルド時の定数）で 1 つだけを選ぶ。ほかの分岐とアダプタはバンドルから落ちる（arch §12-2）
import type { Platform } from './types.ts';

export async function loadPlatform(): Promise<Platform> {
  const target = import.meta.env.VITE_TARGET;
  if (target === 'crazygames') {
    const m = await import('./crazygames.ts');
    return m.createCrazyGamesPlatform({
      getSdk: () => window.CrazyGames?.SDK,
      adsEnabled: import.meta.env.VITE_CG_ADS === 'true',
    });
  }
  if (target === 'poki') {
    const m = await import('./poki.ts');
    return m.createPokiPlatform({ getSdk: () => window.PokiSDK });
  }
  // dev（開発）と、偽の広告を使う e2e（target は web のまま）
  if (target === 'dev' || import.meta.env.VITE_FAKE_ADS === 'true') {
    const m = await import('./dev.ts');
    return m.createDevPlatform({ target: target === 'itch' ? 'itch' : target === 'dev' ? 'dev' : 'web' });
  }
  const m = await import('./web.ts');
  return m.createWebPlatform(target === 'itch' ? 'itch' : 'web');
}

export type { Platform } from './types.ts';
