// Playwright の設定（BL-073。QA テスト戦略 §4-3・§5、arch §16-2、DevOps の ci.yml・nightly.yml）
//
// プロジェクト（package.json のスクリプトで選ぶ）
//   chromium       … PR ごと（`npm run test:e2e`。prod-builds と一緒）。デスクトップ 1280×720 で E1・E5・E9 の本筋と共通の検査、チケット別の e2e（BL-097）。
//                    `@nightly` の印のテスト（優先度 中・低、画面サイズの繰り返しなど）は除く。10 分以内が目安（TS-073-07）
//   webkit・firefox・mobile-safari・mobile-chrome
//                  … 毎晩（週 2 回。`npm run test:e2e:nightly`。BL-084 の nightly.yml）。`@nightly` を含む全件
//   chromium-full  … リリース前の e2e-full（`npm run test:e2e:full` は chromium-full と毎晩の 4 つと prod-builds）。全件
//   poc-tools      … PoC の計測・撮影の道具（perf・screens・sdk-live・smoke。外部に通信するものを含む）。
//                    PW_POC=1 のときだけ定義する（誤って CI で動かないように）
//   prod-builds    … 本番の 4 ビルド（dist/web・crazygames・itch・poki）をサブパスで配信して起動する（BL-097。TS-007-03・09・13・
//                    TS-071-03）。PR ごとの `npm run test:e2e` と test:e2e:full に入る（CEO 決定 2026-09-29。CI の e2e ジョブは
//                    BL-095 から本番のビルドも受け取る）。本番のビルドにはテスト用フックが無いので bootGame を使わない。
//                    ビルドが無ければ「dist/<target> がありません」で失敗する（黙って飛ばさない）
//
// サーバー: e2e/support/serve.mjs が既存の e2e のビルドを `vite preview` で配信する（ビルドはしない）。
//   ローカルは先に `npm run build:e2e`。CI は verify ジョブの dist/ を e2e ジョブが受け取る。
//   ポートは 4174（4173 は preview:web・preview:lan の iPhone 確認で使うので避ける）。PW_PORT で変えられる。
//   本番のビルドは e2e/support/serve-prod.mjs が 4175（PW_PROD_PORT）の /html/123/<target>/ で配信する（ビルドはしない。先に `npm run build:all`）。
//   ビルドが無くてもサーバーは起動し、prod-builds のテストだけが理由つきで失敗する。
// ブラウザ: 既定は Playwright の Chromium（channel chromium。CI と同じ）。PW_CHANNEL=chrome でインストール済みの Chrome。
import { defineConfig, devices, type Project } from '@playwright/test';

const HOST = process.env.PW_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PW_PORT ?? 4174);
const PROD_PORT = Number(process.env.PW_PROD_PORT ?? 4175);
const CI = !!process.env.CI;
const CHANNEL = process.env.PW_CHANNEL ?? 'chromium';

/** PoC の道具（技術リードの PoC 報告で使ったもの）。PR・毎晩には入れない */
const POC_TOOLS = ['**/perf.spec.ts', '**/screens.spec.ts', '**/sdk-live.spec.ts', '**/smoke.spec.ts'];
/** 本番のビルドの起動（prod-builds だけで動かす。e2e のビルドの baseURL では動かない） */
const PROD_SPECS = ['**/bl007-prod-builds.spec.ts'];
const IGNORE = [...POC_TOOLS, ...PROD_SPECS];
/** 毎晩だけ動かすテストの印 */
const NIGHTLY_TAG = /@nightly/;

/** 全 E2E 共通の既定（E1・E5・E9 の「対象と環境」: 1280×720、locale en-US） */
const desktop = { viewport: { width: 1280, height: 720 }, locale: 'en-US' } as const;
const chromium = { ...devices['Desktop Chrome'], ...desktop, channel: CHANNEL };

const projects: Project[] = [
  { name: 'chromium', testIgnore: IGNORE, grepInvert: NIGHTLY_TAG, use: chromium },
  { name: 'chromium-full', testIgnore: IGNORE, use: chromium },
  { name: 'webkit', testIgnore: IGNORE, use: { ...devices['Desktop Safari'], ...desktop } },
  { name: 'firefox', testIgnore: IGNORE, use: { ...devices['Desktop Firefox'], ...desktop } },
  { name: 'mobile-safari', testIgnore: IGNORE, use: { ...devices['iPhone 15'], locale: 'en-US' } },
  { name: 'mobile-chrome', testIgnore: IGNORE, use: { ...devices['Pixel 7'], locale: 'en-US', channel: CHANNEL } },
  { name: 'prod-builds', testMatch: PROD_SPECS, use: { ...chromium, baseURL: `http://${HOST}:${PROD_PORT}` } },
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
  // 再実行を使い切っても落ちたテストがこの件数に達したら止める（flaky と test.fail の期待どおりの失敗は数えない）。
  // 全体が落ちる回の時間（PR で上限なしなら約 95 分）と失敗のレポートの大きさを抑える。PR（CI）は 10、毎晩は nightly.yml が
  // PW_MAX_FAILURES=25、手元は 0（上限なし）。実行・修復エンジニアの決定（実行記録 2026-09-29_s2-start.md §5）、CEO 承認（BL-099）
  maxFailures: Number(process.env.PW_MAX_FAILURES ?? (CI ? 10 : 0)),
  // 手元（GPU あり）は時計の待ちが大半なので 4。CI（非公開リポジトリの GitHub のランナーは 2 vCPU で GPU なし）は、
  // 描画（ソフトウェアの WebGL）が CPU を使い切り、4 並びでは 1 件が 60 秒の上限に届いた（2026-09-29 の PR #4）ので vCPU と同じ 2。
  // PW_WORKERS で変えられる
  workers: Number(process.env.PW_WORKERS ?? (CI ? 2 : 4)),
  reporter: [
    ['list'],
    // 失敗したときの記録（CI の成果物 playwright-report/。TS-073-03）
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    // 共通の検査（TS-COM-01〜04）が付かなかったテストがあれば、名前を出して実行を失敗にする（BL-108。CLI の --reporter で置き換えると外れる）
    ['./e2e/support/common-checks-reporter.ts'],
  ],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    headless: process.env.PW_HEADED !== '1',
    // 失敗したときにトレースとスクリーンショットを残す（TS-073-02）。トレースは最初の実行の分だけ（retries の再実行では取らない）。
    // flaky の分析に要るのは最初の失敗で、再実行の分を減らして失敗したときの成果物を小さくする（BL-099。実行・修復エンジニアの意見、
    // QA リードの同意、決定 0006-4）
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'allow',
  },
  projects,
  webServer: [
    {
      command: 'node e2e/support/serve.mjs',
      url: `http://${HOST}:${PORT}`,
      reuseExistingServer: process.env.PW_REUSE === '1',
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // 本番の 4 ビルド（prod-builds。BL-097）。準備の確認は /__health（ビルドが無くても 200）
      command: 'node e2e/support/serve-prod.mjs',
      url: `http://${HOST}:${PROD_PORT}/__health`,
      reuseExistingServer: process.env.PW_REUSE === '1',
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
