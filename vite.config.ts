// Vite（arch §16）: mode ごとに dist/<mode> へ出力。SDK の script はそのビルドにだけ入れる
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

const SDK_SCRIPTS: Record<string, string> = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  'e2e-crazygames': 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
  'e2e-poki': 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};

/** 出力のファイル名を英小文字・数字・ハイフンにする（itch.io・Linux は大文字小文字を区別する。DevOps の検査規則） */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

function portalSdk(mode: string): Plugin {
  return {
    name: 'portal-sdk',
    transformIndexHtml() {
      const src = SDK_SCRIPTS[mode];
      return src ? [{ tag: 'script', attrs: { src }, injectTo: 'head-prepend' }] : [];
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), portalSdk(mode)],
  build: {
    outDir: `dist/${mode}`,
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        hashCharacters: 'base36',
        entryFileNames: (c) => `assets/${slug(c.name)}-[hash].js`,
        chunkFileNames: (c) => `assets/${slug(c.name)}-[hash].js`,
        assetFileNames: (a) => `assets/${slug((a.names[0] ?? 'asset').replace(/\.[^.]+$/, ''))}-[hash][extname]`,
      },
    },
  },
  server: { host: false },
}));
