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
| `FC_SHRINK_LIMIT_MS` | 反例の縮小（shrink）の時間の上限（ミリ秒。0 以上の整数。**既定 10000**、`0` は上限なし）。最初の失敗から数える（BL-140） |

- 縮小の時間の上限（BL-140。PR #62 の再レビューの N-7）: `fcRuns` は fast-check のプラグイン `shrinkTimeLimit`（`tests/helpers/fc-runs.ts`）を付ける。性質が破れたら、最初の失敗から 10 秒で縮小を打ち切り、その時点の反例（縮めた途中）・`seed`・`path` と「打ち切った」旨で赤になる（`gameStateArb` の性質は同期で動き、vitest の `testTimeout` では止まらない。変異で 10 分を超えても終わらなかった）。失敗が見つかる前は何もしないので、試行の回数・時間は変わらない。最後まで縮めたいときは `FC_SHRINK_LIMIT_MS=0` と報告の `seed`・`path` で流し直す。
- `test:property:full` は最初に使ったシードを 1 行で出す（GitHub Actions では `$GITHUB_STEP_SUMMARY` にも書く）。
- 反例が出たら、その行のコマンドで再現する: `FC_SEED=<seed> FC_RUNS_SCALE=5 npm run test:property:full -- tests/unit/num.test.ts`。fast-check の報告に出る `path` を使えば、その反例だけを速く再現できる（一時的に `fc.assert` の第 2 引数へ `{ ...fcRuns(...), path: '<path>' }` を渡す。lint がエラーにするので、コミットの前に戻す）。
- 所要時間（倍率 5）: 手元の Windows で 1〜2 分（シードによる。1 時間ぶんの刻み幅の比較〔`tests/property/timestep.test.ts`〕が最も重い）。

## セーブの見本（BL-028）
- `tests/fixtures/saves/v{N}/` に、版ごとの 4 種（`early`・`pre-prestige`・`post-prestige`・`max`）の封筒の文字列（ストレージの値と同じ 1 行の JSON）を置く。`newer/` には今の版より新しい版の見本を置く。
- 版 1 の見本は**合成**（今の状態から版 2 で足した欄を除いて作った）。版 1 のビルド（main `9b16498`）で 4 本とも補正なしに読めることを確かめた（2026-10-26）。版 2 以降は、その版のビルドの道具で書く。
- **見本は消さない・上書きしない**（gdd §10）。見本ごとの内容のハッシュを `save-fixtures.test.ts` に固定している。新しい見本は表に行を足すだけで、既存の行は変えない。`tests/unit/save-fixtures.test.ts` が、どの版の見本も今の版で補正なしに読めること・不変条件・200KB 以下・新しい版を上書きしないことを確かめる。
- 移行のコードが失敗した枠は `migrateFailed` になり、`newer` と同じく読み取り専用で起動する（壊れた枠として上書きしない。直したビルドで読めるように）。
- `SAVE_SCHEMA_VERSION` を上げたら:
  1. `src/save/migrate.ts` の `STEPS` に移行の関数を 1 つ足す（各段階の後に形を確かめる）。
  2. `tools/fixtures/save-fixtures.ts` に今の版の書き方を足し、`tools/fixtures/make-save-fixtures.ts` の `writers` に加える。
  3. `node tools/fixtures/make-save-fixtures.ts` を流す（ない見本だけを書く。新しい版の見本と、次の版を模した `newer/` の見本が増える）。増えた見本のハッシュを `save-fixtures.test.ts` の表に足す。
  4. arch §11 の「版の履歴」に 1 行足す。
