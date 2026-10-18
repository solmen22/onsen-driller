// BL-090（PR #14 のレビュー S-1）: 性質テストは呼び出しごとに fcRuns を通す。eslint.config.js の BL-090 のブロック。
// ファイル単位の文字列の検索（前の検査）では、fcRuns を使うファイルに足した呼び出しや、fc 以外の名前で読み込んだ fast-check が素通りした。
// ESLint の Node API（lintText）に仮のパスを渡す（ファイルは作らない）。型情報を使う規則は仮のファイルでは動かないので外す
// （この規則は型情報を使わない。lint-rules.test.ts・lint-e2e-imports.test.ts と同じ）。
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RULE = 'no-restricted-syntax';

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfig: [{ files: ['**/*.{ts,tsx}'], ...tseslint.configs.disableTypeChecked }],
  });
});

interface Hit {
  rule: string;
  line: number;
}
async function hits(filePath: string, code: string): Promise<Hit[]> {
  const [r] = await eslint.lintText(code, { filePath });
  if (!r) throw new Error('no result');
  // 解析の失敗（ruleId が null）と「設定が当たらず無視された」警告も数える（黙って通さない）
  return r.messages.map((m) => ({ rule: m.ruleId ?? `fatal:${m.message}`, line: m.line }));
}
const rules = async (filePath: string, code: string): Promise<string[]> => (await hits(filePath, code)).map((h) => h.rule);

const HEAD = "import fc from 'fast-check';\nimport { fcRuns } from '../helpers/fc-runs.ts';\nconst p = fc.property(fc.integer(), (x) => x === x);\n";
const TEST = 'tests/unit/__fixture__.test.ts';

describe('正しい書き方はエラーにならない', () => {
  const ok: Record<string, string> = {
    '回数だけ': `${HEAD}fc.assert(p, fcRuns(100));`,
    '回数とシード': `${HEAD}fc.assert(p, fcRuns(2000, 20261007));\nfc.assert(fc.asyncProperty(fc.integer(), async () => true), fcRuns(10));`,
    'fc.check も fcRuns': `${HEAD}export const r = fc.check(p, fcRuns(100, 1));`,
    '型の import と fc.Arbitrary': "import fc, { type Arbitrary } from 'fast-check';\nimport type { Property } from 'fast-check';\nexport const a: fc.Arbitrary<number> | Arbitrary<number> = fc.integer();\nexport type P = Property<[number]>;",
  };
  for (const [name, code] of Object.entries(ok))
    it(`${TEST}: ${name}`, async () => {
      expect(await rules(TEST, code)).toEqual([]);
    });
  it('tests/arbitraries の共通の生成器（fc.assert を呼ばない）', async () => {
    expect(await rules('tests/arbitraries/__fixture__.ts', "import fc from 'fast-check';\nexport const arb = fc\n  .integer()\n  .map((x) => x + 1);")).toEqual([]);
  });
});

describe('S-1 fcRuns を通さない呼び出しは、呼び出しごとにエラーになる', () => {
  it('fcRuns を使うファイルに足した、第 2 引数のない呼び出し（ファイル単位の検査の抜け道）は、その行だけがエラー', async () => {
    const h = await hits(TEST, `${HEAD}fc.assert(p, fcRuns(100));\nfc.assert(p);\nfc.assert(p, fcRuns(5, 1));`);
    expect(h).toEqual([{ rule: RULE, line: 5 }]);
  });

  const bad: Record<string, string> = {
    '第 2 引数なし': `${HEAD}fc.assert(p);`,
    'numRuns の直書き': `${HEAD}fc.assert(p, { numRuns: 100 });`,
    'seed だけの直書き': `${HEAD}fc.assert(p, { seed: 5 });`,
    'fcRuns を広げて上書き': `${HEAD}fc.assert(p, { ...fcRuns(100), path: '1:2' });`,
    '変数を経由する': `${HEAD}const runs = fcRuns(100);\nfc.assert(p, runs);`,
    'fc.check の第 2 引数なし': `${HEAD}export const r = fc.check(p);`,
    'fcRuns() の結果を加工する': `${HEAD}fc.assert(p, Object.assign(fcRuns(100), { seed: 1 }));`,
    // fc の別名・間接の呼び出し
    'fc.assert を変数に入れる': `${HEAD}const a = fc.assert;\na(p, fcRuns(1));`,
    '.call': `${HEAD}fc.assert.call(null, p);`,
    'fc[...]': `${HEAD}fc['assert'](p);`,
    '分割代入': `${HEAD}const { assert } = fc;\nassert(p);`,
    'fc の別名': `${HEAD}const f = fc;\nf.assert(p);`,
    '同じ名前の別の fc': "const fc = { assert: (..._a: unknown[]) => undefined };\nfc.assert(1, 2);",
    'fc を引数で渡す': `${HEAD}export const g = (x: typeof fc): void => { x.assert(p); };\ng(fc);`,
    'configureGlobal': `${HEAD}fc.configureGlobal({ seed: 1 });`,
    // fc 以外の名前で読み込む fast-check
    'import * as': "import * as fast from 'fast-check';\nfast.assert(fast.property(fast.integer(), () => true));",
    '名前つき import': "import { assert, integer, property } from 'fast-check';\nassert(property(integer(), () => true));",
    '既定の export を別の名前で': "import fast from 'fast-check';\nfast.assert(fast.property(fast.integer(), () => true));",
    '{ default as }': "import { default as fast } from 'fast-check';\nfast.assert(fast.property(fast.integer(), () => true));",
    'fc と名前つきの値を一緒に': "import fc, { assert } from 'fast-check';\nassert(fc.property(fc.integer(), () => true));",
    'require': "const fast = require('fast-check');\nfast.assert(fast.property(fast.integer(), () => true));",
    '動的 import': "const fast = await import('fast-check');\nfast.default.assert(fast.default.property(fast.default.integer(), () => true));",
    'import = require': "import fast = require('fast-check');\nfast.assert(fast.property(fast.integer(), () => true));",
    '再 export（全部）': "export * from 'fast-check';",
    '再 export（名前つき）': "export { default as fast } from 'fast-check';",
    '@fast-check/vitest': "import { test } from '@fast-check/vitest';\ntest.prop([1])('x', () => true);",
    // fcRuns という名前の別物
    '同じ名前の関数を定義': `import fc from 'fast-check';\nconst fcRuns = (n: number): { seed: number } => ({ seed: n });\nfc.assert(fc.property(fc.integer(), () => true), fcRuns(1));`,
    '別の関数を fcRuns として読み込む': `import fc from 'fast-check';\nimport { fcRunsFrom as fcRuns } from '../helpers/fc-runs.ts';\nfc.assert(fc.property(fc.integer(), () => true), fcRuns({}, 1));`,
    '別のファイルの fcRuns': `import fc from 'fast-check';\nimport { fcRuns } from './my-runs.ts';\nfc.assert(fc.property(fc.integer(), () => true), fcRuns(1));`,
    '引数の名前が fcRuns': `import fc from 'fast-check';\nexport function g(fcRuns: (n: number) => { numRuns: number }): void {\n  fc.assert(fc.property(fc.integer(), () => true), fcRuns(1));\n}`,
    // numRuns を後から書き換える
    'numRuns の代入': `${HEAD}const r = fcRuns(1);\nr.numRuns = 5;`,
  };
  for (const [name, code] of Object.entries(bad))
    it(`${TEST}: ${name}`, async () => {
      expect(await rules(TEST, code)).toContain(RULE);
    });

  it('どの性質テストの置き場所・名前でも効く', async () => {
    for (const f of ['tests/property/__fixture__.test.ts', 'tests/__fixture__.test.ts', 'tests/unit/sub/__fixture__.test.mts', 'tests/unit/__fixture__.test.tsx'])
      expect(await rules(f, `${HEAD}fc.assert(p);`), f).toContain(RULE);
  });

  it('.test.ts でないファイルでは、fcRuns を通していても fc.assert を呼べない（test:property:full の対象から漏れるため）', async () => {
    for (const f of ['tests/arbitraries/__fixture__.ts', 'tests/helpers/__fixture__.ts', 'tests/helpers/fc-runs.ts'])
      expect(await rules(f, `${HEAD}export const check = (): void => fc.assert(p, fcRuns(1));`), f).toContain(RULE);
  });

  it('無効化のコメント（eslint-disable）は tests/ では効かない（N-4）', async () => {
    for (const d of ['// eslint-disable-next-line no-restricted-syntax\n', '/* eslint-disable */\n', '// eslint-disable-next-line\n'])
      for (const f of [TEST, 'tests/arbitraries/__fixture__.ts', 'tests/helpers/fc-runs.ts', 'tests/helpers/fc-runs.test.ts'])
        expect(await rules(f, `${HEAD}${d}fc.assert(p, { numRuns: 5 });`), `${f}: ${d}`).toContain(RULE);
  });

  it('ヘルパーのテスト（numRuns の語を使う）でも、fcRuns を通さない呼び出しはエラー', async () => {
    expect(await rules('tests/helpers/fc-runs.test.ts', `${HEAD}fc.assert(p);`)).toContain(RULE);
    expect(await rules('tests/helpers/fc-runs.test.ts', `export const o = { numRuns: 1 };`)).toEqual([]);
  });
});
