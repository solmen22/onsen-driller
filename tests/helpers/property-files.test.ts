// BL-090（PR #14 の追加の差分のレビュー S-2）: `npm run test:property:full` の対象の選び方（tests/helpers/property-files.ts）。
// lint が通す書き方で fast-check を読み込む .test.ts が、毎晩の full から黙って外れないこと
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { importsFastCheck, propertyTestFiles } from './property-files.ts';

const testsDir = new URL('../', import.meta.url);
const MOD = 'fast-check';

describe('importsFastCheck — lint が通す書き方はすべて拾う（多めに拾う側）', () => {
  const yes = [
    `import fc from '${MOD}';`,
    `import fc from "${MOD}";`, // 二重引用符
    `import fc from '${MOD}'; // コメント`, // 行末のコメント
    `import fc from '${MOD}' /* コメント */;`,
    `import fc from '${MOD}'`, // セミコロンなし
    `  import fc from '${MOD}';`, // 字下げ
    `import fc, { type Arbitrary } from '${MOD}';`,
    `import fc, {\n  type Arbitrary,\n  type Property,\n} from '${MOD}';`, // 改行を含む
    `import type { Arbitrary } from '${MOD}';`, // 型だけ（1 回余計に流れるだけ）
    `import fc from'${MOD}';`, // 空白なし
  ];
  for (const src of yes)
    it(JSON.stringify(src), () => {
      expect(importsFastCheck(src)).toBe(true);
    });
  it('fast-check を読み込まないファイルは拾わない', () => {
    for (const src of ["import { describe } from 'vitest';", `import x from '${MOD}-extra';`, `import x from '@${MOD}/vitest';`, '// fc.assert(p)'])
      expect(importsFastCheck(src), src).toBe(false);
  });
});

/** TypeScript の構文木で、fast-check の import・export … from があるか（正規表現とは別の方法で確かめる） */
function astImportsFastCheck(file: string, source: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  return sf.statements.some(
    (st) =>
      (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) &&
      st.moduleSpecifier !== undefined &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === MOD,
  );
}

describe('propertyTestFiles — fast-check を読み込む .test.ts はすべて test:property:full の対象に入る', () => {
  const all = readdirSync(testsDir, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.test.ts'));
  const byAst = all.filter((f) => astImportsFastCheck(f, readFileSync(new URL(f, testsDir), 'utf8'))).map((f) => `tests/${f}`);
  const selected = propertyTestFiles(testsDir);

  it('構文木で fast-check を読み込むファイルは、1 つも漏れずに対象に入る', () => {
    expect(byAst.length, '前提: 性質テストがある').toBeGreaterThan(0);
    expect(byAst.filter((f) => !selected.includes(f))).toEqual([]);
  });
  it('対象は .test.ts だけ（共通の関数のファイルは入らない）・名前の順・重複なし', () => {
    expect(selected.every((f) => f.startsWith('tests/') && f.endsWith('.test.ts'))).toBe(true);
    expect(selected).toEqual([...new Set(selected)].sort());
  });
});
