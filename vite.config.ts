// Vite（arch §16）: mode ごとに dist/<出力先> へ出力。SDK の script はそのビルドにだけ入れる
import { readFileSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { resolveMode } from './tools/build/modes.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** 出力のファイル名を英小文字・数字・ハイフンにする（itch.io・Linux は大文字小文字を区別する。DevOps の検査規則。ADR D12） */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-');

function portalSdk(src: string | null): Plugin {
  return {
    name: 'portal-sdk',
    transformIndexHtml() {
      return src ? [{ tag: 'script', attrs: { src }, injectTo: 'head-prepend' }] : [];
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const m = resolveMode(mode, command);
  return {
    base: './',
    plugins: [preact(), portalSdk(m.sdk)],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    build: {
      outDir: m.outDir,
      emptyOutDir: true,
      target: 'es2022',
      // 本番にソースマップを含めない（Q-15）
      sourcemap: false,
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
  };
});
