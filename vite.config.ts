// Vite（arch §16）: mode ごとに dist/<出力先> へ出力。SDK の script はそのビルドにだけ入れる
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { productionEnvDefine, resolveMode } from './tools/build/modes.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const root = fileURLToPath(new URL('.', import.meta.url));
/** リポジトリの .env ファイルを読む（なければ null） */
const readRepoFile = (name: string): string | null => {
  const u = new URL(`./${name}`, import.meta.url);
  return existsSync(u) ? readFileSync(u, 'utf8') : null;
};

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
  // 本番の mode のビルドは、テスト用フック・偽の広告・CrazyGames の広告・ターゲットを固定する。
  // .env.local・.env.<mode>.local・シェルの環境変数で違う値になっていればビルドを止める（レビュー S-8）
  const envDefine = command === 'build' ? productionEnvDefine(mode, m, readRepoFile, loadEnv(mode, root, 'VITE_')) : {};
  return {
    base: './',
    plugins: [preact(), portalSdk(m.sdk)],
    define: { __APP_VERSION__: JSON.stringify(pkg.version), ...envDefine },
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
