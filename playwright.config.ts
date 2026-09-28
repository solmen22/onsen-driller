// Playwright の設定（BL-073。QA テスト戦略 §4-3・§5、arch §16-2、DevOps の ci.yml・nightly.yml）
//
// プロジェクト（package.json のスクリプトで選ぶ）
//   chromium       … PR ごと（`npm run test:e2e`）。デスクトップ 1280×720 で E1・E5・E9 の本筋と共通の検査。
//                    `@nightly` の印のテスト（優先度 中・低、画面サイズの繰り返しなど）は除く。10 分以内が目安（TS-073-07）
//   webkit・firefox・mobile-safari・mobile-chrome
//                  … 毎晩（週 2 回。`npm run test:e2e:nightly`。BL-084 の nightly.yml）。`@nightly` を含む全件
//   chromium-full  … リリース前の e2e-full（`npm run test:e2e:full` は chromium-full と毎晩の 4 つ）。全件
//   poc-tools      … PoC の計測・撮影の道具（perf・screens・sdk-live・smoke。外部に通信するものを含む）。
//                    PW_POC=1 のときだけ定義する（誤って CI で動かないように）
//
// サーバー: e2e/support/serve.mjs が既存の e2e のビルドを `vite preview` で配信する（ビルドはしない）。
//   ローカルは先に `npm run build:e2e`。CI は verify ジョブの dist/ を e2e ジョブが受け取る。
//   ポートは 4174（4173 は preview:web・preview:lan の iPhone 確認で使うので避ける）。PW_PORT で変えられる。
// ブラウザ: 既定は Playwright の Chromium（channel chromium。CI と同じ）。PW_CHANNEL=chrome でインストール済みの Chrome。
import { defineConfig, devices, type Project } from '@playwright/test';

const HOST = process.env.PW_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PW_PORT ?? 4174);
const CI = !!process.env.CI;
const CHANNEL = process.env.PW_CHANNEL ?? 'chromium';

/** PoC の道具（技術リードの PoC 報告で使ったもの）。PR・毎晩には入れない */
const POC_TOOLS = ['**/perf.spec.ts', '**/screens.spec.ts', '**/sdk-live.spec.ts', '**/smoke.spec.ts'];
/** 毎晩だけ動かすテストの印 */
const NIGHTLY_TAG = /@nightly/;

/** 全 E2E 共通の既定（E1・E5・E9 の「対象と環境」: 1280×720、locale en-US） */
const desktop = { viewport: { width: 1280, height: 720 }, locale: 'en-US' } as const;
const chromium = { ...devices['Desktop Chrome'], ...desktop, channel: CHANNEL };

const projects: Project[] = [
  { name: 'chromium', testIgnore: POC_TOOLS, grepInvert: NIGHTLY_TAG, use: chromium },
  { name: 'chromium-full', testIgnore: POC_TOOLS, use: chromium },
  { name: 'webkit', testIgnore: POC_TOOLS, use: { ...devices['Desktop Safari'], ...desktop } },
  { name: 'firefox', testIgnore: POC_TOOLS, use: { ...devices['Desktop Firefox'], ...desktop } },
  { name: 'mobile-safari', testIgnore: POC_TOOLS, use: { ...devices['iPhone 15'], locale: 'en-US' } },
  { name: 'mobile-chrome', testIgnore: POC_TOOLS, use: { ...devices['Pixel 7'], locale: 'en-US', channel: CHANNEL } },
];
if (process.env.PW_POC === '1') {
  projects.push({
    name: 'poc-tools',
    testMatch: POC_TOOLS,
    timeout: 240_000,
    use: { channel: process.env.PW_CHANNEL ?? 'chrome', launchOptions: { args: (process.env.PW_ARGS ?? '').split(' ').filter(Boolean) } },
  });
}

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  // QA §5: 不安定なテストは 1 回だけ再実行を許す（再実行で通ったものは flaky として報告に残る）
  retries: 1,
  // 時間の大半は Playwright の時計の待ち（実時間の setTimeout）なので、CPU の数より多めに並べてよい。PW_WORKERS で変えられる
  workers: Number(process.env.PW_WORKERS ?? 4),
  reporter: [
    ['list'],
    // 失敗したときの記録（CI の成果物 playwright-report/。TS-073-03）
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    headless: process.env.PW_HEADED !== '1',
    // 失敗したときにトレースとスクリーンショットを残す（TS-073-02）
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'allow',
  },
  projects,
  webServer: {
    command: 'node e2e/support/serve.mjs',
    url: `http://${HOST}:${PORT}`,
    reuseExistingServer: process.env.PW_REUSE === '1',
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
