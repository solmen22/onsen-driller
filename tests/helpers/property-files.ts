// BL-090: `npm run test:property:full`（vitest.property.config.ts）が流すファイルの選び方。config とテスト（property-files.test.ts）で共有する。
// 対象は「fast-check を読み込む .test.ts」。外して困るのは「入れ損ね」（毎晩の反例探しから黙って抜ける）だけなので、多めに拾う側に倒す
// （PR #14 の追加の差分のレビュー S-2）:
// - 引用符の種類・行末のコメント・改行を含む import・型だけの import も拾う
// - 文字列の中の `from 'fast-check'`（tests/unit/lint-fc-runs.test.ts の例など）も拾う。その場合は 1 回余計に流れるだけ
// 値の読み込みが `import fc from 'fast-check'` の形に限ること・fc.assert は .test.ts の中だけで呼ぶこと・呼び出しごとに fcRuns を
// 通すことは ESLint（eslint.config.js の BL-090 のブロック）が保証する。なので、性質テストのある .test.ts はすべてここに入る
import { readdirSync, readFileSync } from 'node:fs';

/** fast-check を読み込む文（`from 'fast-check'`・`from "fast-check"`。多めに拾う） */
export const FAST_CHECK_IMPORT = /\bfrom\s*['"]fast-check['"]/;

/** ファイルの中身が fast-check を読み込むか */
export const importsFastCheck = (source: string): boolean => FAST_CHECK_IMPORT.test(source);

/** testsDir（`tests/` の URL）の中の .test.ts のうち、fast-check を読み込むもの（`tests/...` の形・名前の順） */
export function propertyTestFiles(testsDir: URL): string[] {
  return readdirSync(testsDir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.test.ts') && importsFastCheck(readFileSync(new URL(f, testsDir), 'utf8')))
    .map((f) => `tests/${f}`)
    .sort();
}
