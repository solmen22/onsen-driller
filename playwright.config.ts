// Playwright（PoC）: この PC の Chrome を使う（ブラウザのダウンロードをしない）。
// サーバーは vite preview で起動し、テストの終了時に自動で止まる
import { defineConfig } from '@playwright/test';

const PORT = 4174;
const HOST = process.env.PW_HOST ?? '127.0.0.1';

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: process.env.PW_HEADED !== '1',
    baseURL: `http://${HOST}:${PORT}`,
    launchOptions: { args: (process.env.PW_ARGS ?? '').split(' ').filter(Boolean) },
  },
  webServer: {
    command: `npx vite preview --outDir ${process.env.PW_DIST ?? 'dist/e2e'} --port ${PORT} --strictPort --host ${HOST}`,
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
