// BL-090: `npm run test:property:full`（毎晩の nightly.yml）の設定。
// fast-check の性質テスト（tests/ の中で fast-check を読み込む .test.ts。新しい性質テストも自動で入る）の全件を、
// 試行回数を既定の 5 倍にし（FC_RUNS_SCALE・FC_NUM_RUNS で変えられる）、実行ごとに変わるシード（FC_SEED で固定できる）で流す。
// 使ったシードは最初に 1 行で出し、GitHub Actions では $GITHUB_STEP_SUMMARY にも書く（反例が出たら、その行のコマンドで再現する）
// 回数・シードの読み方は tests/helpers/fc-runs.ts、説明は docs/testing.md。PR の `npm run test`（vitest.config.ts）は変えない
import { randomInt } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

/** 既定の倍率（PR の回数の 5 倍。10 倍では手元の Windows で約 3 分かかり〔1 時間ぶんの刻み幅の比較が 200 回で約 100 秒〕、ubuntu の 2 CPU の上限 3 分に収まらない） */
const DEFAULT_SCALE = '5';

const env = (key: string): string | undefined => {
  const v = process.env[key]?.trim();
  return v === undefined || v === '' ? undefined : v;
};
const seed = env('FC_SEED') ?? String(randomInt(1, 2 ** 31));
const fixedRuns = env('FC_NUM_RUNS');
const scale = env('FC_RUNS_SCALE') ?? DEFAULT_SCALE;

// 対象は「fast-check を import fc from 'fast-check' で読み込む .test.ts」（コメントの中の文字列に左右されない）。
// ESLint（eslint.config.js の BL-090 のブロック）が、fast-check はこの形でしか読み込めないこと・fc.assert は .test.ts の中だけで
// 呼ぶこと・呼び出しごとに fcRuns を通すことを保証するので、性質テストは漏れなくここに入る（PR #14 のレビュー S-1・N-1）
const FAST_CHECK_IMPORT = /^import fc\b[^;]*\bfrom 'fast-check';?\s*$/m;
const testsDir = new URL('./tests/', import.meta.url);
const propertyFiles = readdirSync(testsDir, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.test.ts') && FAST_CHECK_IMPORT.test(readFileSync(new URL(f, testsDir), 'utf8')))
  .map((f) => `tests/${f}`)
  .sort();

const runs = fixedRuns === undefined ? `FC_RUNS_SCALE=${scale}` : `FC_NUM_RUNS=${fixedRuns}`;
const line = `test:property:full: FC_SEED=${seed} ${runs}（${propertyFiles.length} ファイル）。再現: FC_SEED=${seed} ${runs} npm run test:property:full -- <ファイル>`;
console.log(line);
const summary = env('GITHUB_STEP_SUMMARY');
if (summary !== undefined) appendFileSync(summary, `- ${line}\n`);

// include は置き換える（mergeConfig は配列をつなげてしまい、全テストが入る）
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: propertyFiles,
    // ファイルを 1 つずつ流す（重い性質テストと同時に動くと、同じファイルにある実時間の検査〔TS-012-13 の 50ms など〕が CPU の取り合いで落ちる）
    fileParallelism: false,
    // 5 倍の回数で 1 件が数十秒かかる（1 時間ぶんの刻み幅の比較など）。遅いランナーでも打ち切らない
    testTimeout: 600_000,
    env: { FC_PROPERTY_FULL: '1', FC_SEED: seed, ...(fixedRuns === undefined ? { FC_RUNS_SCALE: scale } : { FC_NUM_RUNS: fixedRuns }) },
  },
});
