// BL-094（PR #4 の再レビュー R-S2）: E2E の spec が共通の検査の付かない test を import できないこと。
// eslint.config.js の e2e のブロック。ESLint の Node API（lintText）に仮のパスを渡す（ファイルは作らない）。
// 型情報を使う規則は仮のファイルでは動かないので外す（この規則は型情報を使わない。lint-rules.test.ts と同じ）。
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RULE = '@typescript-eslint/no-restricted-imports';

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfig: [{ files: ['**/*.{ts,tsx}'], ...tseslint.configs.disableTypeChecked }],
  });
});

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath });
  if (!r) throw new Error('no result');
  // 解析の失敗（ruleId が null）と「設定が当たらず無視された」警告も、違反として数える（黙って通さない）
  return r.messages.map((m) => m.ruleId ?? `fatal:${m.message}`);
}

/** 共通の検査の付かない test を使う spec の書き方（R-S2 の 3 つと、S-2 で止めていた形） */
const RAW_TEST: string[] = [
  // ① 既定の export
  "import test from '@playwright/test';\ntest('x', () => {});",
  "import test, { expect } from '@playwright/test';\ntest('x', () => { expect(1).toBe(1); });",
  "import { default as t } from '@playwright/test';\nt('x', () => {});",
  // ② playwright/test（@playwright/test の中身）
  "import { test } from 'playwright/test';\ntest('x', () => {});",
  "import test from 'playwright/test';\ntest('x', () => {});",
  "import * as pw from 'playwright/test';\npw.test('x', () => {});",
  // S-2 で止めていた形（今までどおり）
  "import { test } from '@playwright/test';\ntest('x', () => {});",
  "import { test as t } from '@playwright/test';\nt('x', () => {});",
  "import * as pw from '@playwright/test';\npw.test('x', () => {});",
];

describe('R-S2 共通の検査の付かない test の import は、E2E の spec でエラーになる', () => {
  for (const code of RAW_TEST)
    it(`e2e/__fixture__.spec.ts: ${code.split('\n')[0]}`, async () => {
      expect(await ruleIds('e2e/__fixture__.spec.ts', code)).toContain(RULE);
    });

  // ③ .spec.ts 以外でも Playwright がテストとして読む名前（既定の testMatch '**/*.@(spec|test).?(c|m)[jt]s?(x)'）
  const names = [
    'e2e/foo.test.ts',
    'e2e/sub/foo.test.ts',
    'e2e/foo.spec.tsx',
    'e2e/foo.test.tsx',
    'e2e/foo.spec.js',
    'e2e/foo.test.mjs',
    'e2e/foo.spec.jsx',
    'e2e/foo.test.mts',
    'e2e/foo.spec.cts',
  ];
  for (const name of names)
    for (const code of [RAW_TEST[0]!, RAW_TEST[3]!, RAW_TEST[6]!])
      it(`${name}: ${code.split('\n')[0]}`, async () => {
        expect(await ruleIds(name, code)).toContain(RULE);
      });
});

describe('R-S2 正しい書き方と対象外のファイルはエラーにならない（誤検出がない）', () => {
  const ok: [string, string][] = [
    // fixtures.ts の test・expect
    ['e2e/__fixture__.spec.ts', "import { test, expect } from './support/fixtures.ts';\ntest('x', () => { expect(1).toBe(1); });"],
    ['e2e/__fixture__.test.ts', "import { test, expect } from './support/fixtures.ts';\ntest('x', () => { expect(1).toBe(1); });"],
    ['e2e/__fixture__.spec.js', "import { test, expect } from './support/fixtures.ts';\ntest('x', () => { expect(1).toBe(1); });"],
    // 型の import と、test 以外の値（expect など）は @playwright/test・playwright/test から使ってよい
    ['e2e/__fixture__.spec.ts', "import type { Page } from '@playwright/test';\nexport type P = Page;"],
    ['e2e/__fixture__.spec.ts', "import { type Page, type BrowserContext } from '@playwright/test';\nexport type P = [Page, BrowserContext];"],
    ['e2e/__fixture__.spec.ts', "import { expect as pwExpect } from '@playwright/test';\nexport const e = pwExpect;"],
    ['e2e/__fixture__.spec.ts', "import type { Page } from 'playwright/test';\nexport type P = Page;"],
    // spec でないファイル（support・helpers）は fixtures.ts を作る側なので対象外
    ['e2e/support/__fixture__.ts', "import { test as base } from '@playwright/test';\nexport const t = base;"],
    ['e2e/__fixture__.ts', "import test from '@playwright/test';\nexport const t = test;"],
    // PoC の道具（PW_POC=1 のときだけ動く）は対象外のまま
    ['e2e/perf.spec.ts', "import { test } from '@playwright/test';\ntest('x', () => {});"],
    ['e2e/screens.spec.ts', "import { test } from '@playwright/test';\ntest('x', () => {});"],
    ['e2e/sdk-live.spec.ts', "import { test } from '@playwright/test';\ntest('x', () => {});"],
    ['e2e/smoke.spec.ts', "import { test } from '@playwright/test';\ntest('x', () => {});"],
    // e2e の外（Vitest のテスト）は対象外
    ['tests/unit/__fixture__.test.ts', "import { test } from '@playwright/test';\nexport const t = test;"],
  ];
  for (const [p, code] of ok)
    it(`${p}: ${code.split('\n')[0]}`, async () => {
      expect(await ruleIds(p, code)).toEqual([]);
    });
});
