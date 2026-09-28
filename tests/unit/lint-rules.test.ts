// BL-006: 層と決定論の lint の規則が効くこと（TS-006-05・06・08・12。ESLint の Node API に仮のパスを渡す）
// 型情報を使う規則は仮のファイルでは動かないので、このテストでは外す（層と決定論の規則は型情報を使わない）。
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

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
  // 解析の失敗（ruleId が null）も違反として数える
  return r.messages.map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const DET_LAYERS = ['src/core', 'src/content', 'src/save', 'tools/sim'];
const TIMER_LAYERS = ['src/core', 'src/content'];

describe('TS-006-05 決定論を壊す API（core・content・save・tools/sim）', () => {
  const codes = ['export const a = Math.random();', 'export const a = Date.now();', 'export const a = performance.now();', 'export const a = new Date();'];
  for (const dir of DET_LAYERS)
    for (const code of codes)
      it(`${dir}: ${code}`, async () => {
        expect((await ruleIds(`${dir}/__fixture__.ts`, code)).length).toBeGreaterThan(0);
      });
});

describe('TS-006-12 lint の抜け道', () => {
  const loopholes = [
    'export const a = Date();',
    'export const a = globalThis.Math.random();',
    'const { random } = Math;\nexport const a = random();',
    "export const a = Math['random']();",
    'const m = Math;\nexport const a = m.random();',
    'export const a = crypto.getRandomValues(new Uint32Array(1));',
    'export const a = crypto.randomUUID();',
    'export const a = self.performance;',
  ];
  for (const dir of DET_LAYERS)
    for (const code of loopholes)
      it(`${dir}: ${code.replace(/\n/g, ' ')}`, async () => {
        expect((await ruleIds(`${dir}/__fixture__.ts`, code)).length).toBeGreaterThan(0);
      });

  const timers = ['setTimeout(() => {}, 1);', 'setInterval(() => {}, 1);', 'requestAnimationFrame(() => {});'];
  for (const dir of TIMER_LAYERS)
    for (const code of timers)
      it(`${dir}: ${code}`, async () => {
        expect(await ruleIds(`${dir}/__fixture__.ts`, code)).toContain('no-restricted-globals');
      });

  it('view・app では同じコードが通る（誤検出がない）', async () => {
    for (const dir of ['src/view', 'src/app'])
      for (const code of [...loopholes.slice(0, 5), 'setTimeout(() => {}, 1);', 'requestAnimationFrame(() => {});'])
        expect(await ruleIds(`${dir}/__fixture__.ts`, code), `${dir}: ${code}`).toEqual([]);
  });

  it('core の無効化のコメント（eslint-disable）は効かない（TS-006-14）', async () => {
    const ids = await ruleIds('src/core/__fixture__.ts', '// eslint-disable-next-line\nexport const a = Math.random();');
    expect(ids).toContain('no-restricted-properties');
  });
});

describe('TS-006-06 層をまたぐ import', () => {
  const cases: [string, string[]][] = [
    ['src/core', ['../save/codec.ts', '../platform/types.ts', '../app/store.ts', '../view/game.ts', '../ui/format.ts', 'phaser', 'preact', 'preact/hooks']],
    ['src/content', ['../save/codec.ts', '../platform/types.ts', '../app/store.ts', '../view/game.ts', '../ui/format.ts', 'phaser', 'preact']],
    ['src/save', ['../app/store.ts', '../view/game.ts', '../ui/format.ts', '../platform/storage.ts', 'phaser', 'preact']],
    ['tools/sim', ['../../src/view/game.ts', '../../src/ui/format.ts', '../../src/app/store.ts', '../../src/platform/types.ts', '../../src/save/codec.ts', 'phaser', 'preact']],
  ];
  for (const [dir, mods] of cases)
    for (const m of mods)
      it(`${dir} → ${m}`, async () => {
        expect(await ruleIds(`${dir}/__fixture__.ts`, `import { x } from '${m}';\nexport const a = x;`)).toContain(
          '@typescript-eslint/no-restricted-imports',
        );
      });

  it('許される import は通る', async () => {
    const ok: [string, string][] = [
      ['src/core/__fixture__.ts', "import { PARAMS } from '../content/params.ts';\nexport const a = PARAMS;"],
      ['src/core/__fixture__.ts', "import Decimal from 'break_infinity.js';\nexport const a = Decimal;"],
      ['src/content/__fixture__.ts', "import type { GameState } from '../core/state.ts';\nexport type A = GameState;"],
      ['src/save/__fixture__.ts', "import { createInitialState } from '../core/state.ts';\nexport const a = createInitialState;"],
      ['src/save/__fixture__.ts', "import type { KeyValueStore } from '../platform/types.ts';\nexport type A = KeyValueStore;"],
      ['src/view/__fixture__.ts', "import { buyQuote } from '../core/selectors.ts';\nexport const a = buyQuote;"],
      ['src/view/__fixture__.ts', "import type { GameState } from '../core/state.ts';\nexport type A = GameState;"],
      ['src/view/__fixture__.ts', "import Phaser from 'phaser';\nexport const a = Phaser;"],
      ['tools/sim/__fixture__.ts', "import { step } from '../../src/core/step.ts';\nexport const a = step;"],
    ];
    for (const [p, code] of ok) expect(await ruleIds(p, code), `${p}: ${code}`).toEqual([]);
  });
});

describe('TS-006-11・13 view・content の値の import（Q-14）', () => {
  it('content は core の値を import できない（型だけ）', async () => {
    expect(await ruleIds('src/content/__fixture__.ts', "import { dispatch } from '../core/actions.ts';\nexport const a = dispatch;")).toContain(
      '@typescript-eslint/no-restricted-imports',
    );
  });
  it('view は actions・step・index.ts の値を import できない', async () => {
    for (const m of ['../../core/actions.ts', '../../core/step.ts', '../../core/index.ts', '../../core/state.ts'])
      expect(await ruleIds('src/view/scenes/__fixture__.ts', `import { x } from '${m}';\nexport const a = x;`), m).toContain(
        '@typescript-eslint/no-restricted-imports',
      );
  });
});

describe('レビュー S-7: ディレクトリの import（index.ts を省いた形）でも層の規則に当たる', () => {
  const RULE = '@typescript-eslint/no-restricted-imports';
  const blocked: [string, string][] = [
    // view → core の index（状態を書き換える dispatch など）
    ['src/view/scenes/__fixture__.ts', "import { dispatch } from '../../core';\nexport const a = dispatch;"],
    ['src/view/__fixture__.ts', "import { dispatch } from '../core/';\nexport const a = dispatch;"],
    ['src/view/__fixture__.ts', "import { dispatch } from '../core/index';\nexport const a = dispatch;"],
    // view → platform・save・ui
    ['src/view/__fixture__.ts', "import { loadPlatform } from '../platform';\nexport const a = loadPlatform;"],
    ['src/view/__fixture__.ts', "import { x } from '../save';\nexport const a = x;"],
    ['src/view/__fixture__.ts', "import { x } from '../ui';\nexport const a = x;"],
    // content・platform → core の値
    ['src/content/__fixture__.ts', "import { num } from '../core';\nexport const a = num;"],
    ['src/platform/__fixture__.ts', "import { num } from '../core';\nexport const a = num;"],
    ['src/platform/__fixture__.ts', "import { x } from '../save';\nexport const a = x;"],
    // save → platform の値・app
    ['src/save/__fixture__.ts', "import { loadPlatform } from '../platform';\nexport const a = loadPlatform;"],
    ['src/save/__fixture__.ts', "import { x } from '../app';\nexport const a = x;"],
    // core → 外側の層
    ['src/core/__fixture__.ts', "import { x } from '../save';\nexport const a = x;"],
    ['src/core/__fixture__.ts', "import { x } from '../platform/';\nexport const a = x;"],
    ['src/core/__fixture__.ts', "import { x } from '../view';\nexport const a = x;"],
    // ui → view・save、tools/sim → save・platform
    ['src/ui/__fixture__.ts', "import { x } from '../view';\nexport const a = x;"],
    ['src/ui/__fixture__.ts', "import { x } from '../save';\nexport const a = x;"],
    ['tools/sim/__fixture__.ts', "import { x } from '../../src/save';\nexport const a = x;"],
    ['tools/sim/__fixture__.ts', "import { x } from '../../src/platform';\nexport const a = x;"],
    // 遠回りのパス（途中で core を通る）
    ['src/content/__fixture__.ts', "import { num } from '../core/../core/num.ts';\nexport const a = num;"],
  ];
  for (const [p, code] of blocked)
    it(`${p}: ${code.split('\n')[0]}`, async () => {
      expect(await ruleIds(p, code)).toContain(RULE);
    });

  it('型だけの import と、view に許された core のファイルは今までどおり通る', async () => {
    const ok: [string, string][] = [
      ['src/view/__fixture__.ts', "import type { GameState } from '../core';\nexport type A = GameState;"],
      ['src/view/__fixture__.ts', "import { buyQuote } from '../core/selectors.ts';\nexport const a = buyQuote;"],
      ['src/view/__fixture__.ts', "import { num } from '../core/num.ts';\nexport const a = num;"],
      ['src/content/__fixture__.ts', "import type { GameState } from '../core';\nexport type A = GameState;"],
      ['src/platform/__fixture__.ts', "import type { GameState } from '../core';\nexport type A = GameState;"],
      ['src/save/__fixture__.ts', "import type { KeyValueStore } from '../platform';\nexport type A = KeyValueStore;"],
      ['src/save/__fixture__.ts', "import { createInitialState } from '../core';\nexport const a = createInitialState;"],
      ['src/core/__fixture__.ts', "import { PARAMS } from '../content/params.ts';\nexport const a = PARAMS;"],
      ['src/core/__fixture__.ts', "import { TOOLS } from '../content/tools.ts';\nexport const a = TOOLS;"],
    ];
    for (const [p, code] of ok) expect(await ruleIds(p, code), `${p}: ${code}`).toEqual([]);
  });
});

describe('レビュー N-2: eval・new Function・constructor 経由の関数の生成（core・content・save・tools/sim）', () => {
  const codes = [
    "export const a = eval('Date.now()');",
    "export const a = new Function('return Date.now()')();",
    "export const a = Function('return Date.now()')();",
    "export const a = (() => 0).constructor('return Date.now()')();",
    "export const a = new (() => 0).constructor('return 1')();",
    "export const a = (() => 0)['constructor']('return Date.now()')();",
  ];
  for (const dir of DET_LAYERS)
    for (const code of codes)
      it(`${dir}: ${code}`, async () => {
        expect((await ruleIds(`${dir}/__fixture__.ts`, code)).length).toBeGreaterThan(0);
      });
});

describe('TS-006-08 view の演出だけの乱数は通る', () => {
  it('src/view/fx/particles.ts の Math.random', async () => {
    expect(await ruleIds('src/view/fx/particles.ts', 'export const a = Math.floor(Math.random() * 3);')).toEqual([]);
  });
  it('core の Math.floor・Math.max は通る', async () => {
    expect(await ruleIds('src/core/__fixture__.ts', 'export const a = Math.floor(1.5) + Math.max(1, 2);')).toEqual([]);
  });
});
