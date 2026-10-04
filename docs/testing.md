# テスト（Vitest）

（BL-090。性質テストの回数・シードの決め方。E2E は `playwright.config.ts` の冒頭の説明を見る）

| コマンド | 中身 | いつ |
|---|---|---|
| `npm run test` | `tests/**/*.test.ts` の全件（unit・integration・property・balance の短縮版）。性質テストは各テストの既定の回数・固定シード | PR ごと（CI の verify） |
| `npm run test:property:full` | 性質テスト（fast-check を読み込む `.test.ts`。`tests/helpers/property-files.ts` が多めに拾う）の全件を、**既定の回数の 5 倍**・**実行ごとに変わるシード**で流す。ファイルは 1 つずつ流す（`vitest.property.config.ts`） | 毎晩（`nightly.yml`。BL-084） |

## 性質テスト（fast-check）の書き方（BL-090）
- `fc.assert`（`fc.check`）の第 2 引数は、呼び出しごとに必ず `fcRuns(<既定の回数>[, <既定のシード>])`（`tests/helpers/fc-runs.ts`）を直接書く。`numRuns` を直書きしない。
- シードは原則として付ける（PR の CI を決定的にする）。付けない場合は理由をコメントに書く（PR #14 のレビュー N-2）。回帰を捕まえるための性質は、直す前のコードで赤になるシードを選ぶ（例: `tests/unit/num-normalize.test.ts`）。
- fast-check は `import fc from 'fast-check'` の形だけで読み込み（型は `import type` で可）、`fc.assert` は `.test.ts` の中だけで呼ぶ。`test:property:full` の対象は「fast-check を読み込む `.test.ts`」なので、共通の関数に隠すと漏れる（対象から漏れないことは `tests/helpers/property-files.test.ts` が構文木で確かめる）。
- 上の 3 つは ESLint（`eslint.config.js` の BL-090 のブロック。`no-restricted-syntax`）が呼び出しごとに検査する（`npm run lint`。`tests/` では `eslint-disable` のコメントは効かない。規則が効くことは `tests/unit/lint-fc-runs.test.ts` で確かめる。PR #14 のレビュー S-1）。第 2 引数の省略・`{ numRuns }`・`{ seed }`・`{ ...fcRuns() }`、`fc` 以外の名前での読み込み（`import * as`・名前つき import・`require`・動的 import）、`fc` の別名、`fc.configureGlobal`、同じ名前の別の `fcRuns` は、すべてエラーになる。
- 既定の回数・シードは PR の `npm run test` で使う値。`npm run test:property:full` はそれに倍率を掛け、シードを置き換える。
- 実時間の検査（「50ms 以内」など）を性質テストと同じファイルに書くときは、`it.skipIf(inPropertyFullRun())` にする（重い計算の後は CPU の状態で揺れるため。PR の `npm run test` では毎回見る）。

## 環境変数（どちらのコマンドでも効く）
| 変数 | 意味 |
|---|---|
| `FC_NUM_RUNS` | すべての性質の試行回数をこの数にする（正の整数。`FC_RUNS_SCALE` より優先） |
| `FC_RUNS_SCALE` | 各性質の既定の回数に掛ける倍率（正の数。`test:property:full` の既定は 5） |
| `FC_SEED` | すべての性質のシード（整数）。`test:property:full` で指定しなければ実行ごとに変わる |

- `test:property:full` は最初に使ったシードを 1 行で出す（GitHub Actions では `$GITHUB_STEP_SUMMARY` にも書く）。
- 反例が出たら、その行のコマンドで再現する: `FC_SEED=<seed> FC_RUNS_SCALE=5 npm run test:property:full -- tests/unit/num.test.ts`。fast-check の報告に出る `path` を使えば、その反例だけを速く再現できる（一時的に `fc.assert` の第 2 引数へ `{ ...fcRuns(...), path: '<path>' }` を渡す。lint がエラーにするので、コミットの前に戻す）。
- 所要時間（倍率 5）: 手元の Windows で 1〜2 分（シードによる。1 時間ぶんの刻み幅の比較〔`tests/property/timestep.test.ts`〕が最も重い）。
