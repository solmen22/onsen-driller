// ESLint（arch §5）: 層をまたぐ import と、決定論を壊す API を禁止する（BL-006。Q-14）
// 規則が効くことは tests/unit/lint-rules.test.ts で確かめる（仮のパスに違反のコードを渡す）。
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const DET = '決定論（arch §5・§8）: core・content・save・tools/sim では';

/** 決定論を壊すグローバル（core・content・save・tools/sim） */
const determinismGlobals = [
  { name: 'Date', message: `${DET} Date を使わない（時刻は app から引数で渡す）` },
  { name: 'performance', message: `${DET} performance を使わない（時刻は app から引数で渡す）` },
  { name: 'crypto', message: `${DET} crypto の乱数を使わない（rng.ts の sfc32・hash32 を使う）` },
  { name: 'globalThis', message: `${DET} globalThis 経由の参照をしない（抜け道の禁止）` },
  { name: 'self', message: `${DET} self 経由の参照をしない（抜け道の禁止）` },
];
/** ブラウザの API（core・content・save・tools/sim） */
const browserGlobals = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'location',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'alert',
].map((name) => ({ name, message: 'core・content・save・tools/sim ではブラウザの API を使わない（arch §5。保存は platform.storage を受け取る）' }));
/** タイマー（core・content だけ） */
const timerGlobals = [
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setImmediate',
  'queueMicrotask',
  'requestIdleCallback',
].map((name) => ({ name, message: 'core・content ではタイマーを使わない（時間は step の引数で進める。arch §7）' }));

const mathRules = {
  'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: `${DET} Math.random を使わない（rng.ts を使う）` }],
  'no-restricted-syntax': [
    'error',
    { selector: "MemberExpression[object.name='Math'][computed=true]", message: `${DET} Math[...] の形で参照しない（抜け道の禁止）` },
    {
      selector: "Identifier[name='Math']:not(MemberExpression > Identifier.object):not(MemberExpression > Identifier.property):not(Property > Identifier.key)",
      message: `${DET} Math を値として扱わない（別名・分割代入の抜け道の禁止）`,
    },
  ],
};

const restrictedImports = (patterns) => ({
  'no-restricted-imports': 'off',
  '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
});
const LAYER = '層をまたぐ import（arch §5）';
const libs = (names, why) => ({ group: names.flatMap((n) => [n, `${n}/*`]), message: why });

/** core: content（型と値）と break_infinity.js だけ */
const coreImports = [
  libs(['phaser', 'preact', 'valibot', 'lz-string', 'zzfx'], `${LAYER}: core は描画・UI・保存のライブラリに依存しない`),
  { group: ['node:*'], message: `${LAYER}: core は Node の API に依存しない` },
  { group: ['**/save/**', '**/platform/**', '**/app/**', '**/view/**', '**/ui/**', '**/audio/**', '**/i18n/**', '**/tools/**'], message: `${LAYER}: core から外側の層を import しない` },
];
/** content: core の型だけ（Q-14） */
const contentImports = [
  ...coreImports.slice(0, 2),
  { group: ['**/save/**', '**/platform/**', '**/app/**', '**/view/**', '**/ui/**', '**/audio/**', '**/i18n/**', '**/tools/**'], message: `${LAYER}: content から外側の層を import しない` },
  { group: ['**/core/**'], allowTypeImports: true, message: `${LAYER}: content は core の型だけを import する（import type。Q-14）` },
];
/** save: core・content・valibot・lz-string と platform の型 */
const saveImports = [
  libs(['phaser', 'preact', 'zzfx'], `${LAYER}: save は描画・UI に依存しない`),
  { group: ['**/app/**', '**/view/**', '**/ui/**', '**/audio/**', '**/i18n/**'], message: `${LAYER}: save から app・view・ui を import しない` },
  { group: ['**/platform/**'], allowTypeImports: true, message: `${LAYER}: save は platform の型だけを使う（ストレージは引数で受け取る）` },
];
/** tools/sim: core・content だけ */
const simImports = [
  libs(['phaser', 'preact', 'valibot', 'lz-string', 'zzfx'], `${LAYER}: シミュレーターは描画・UI・保存に依存しない`),
  { group: ['**/src/save/**', '**/src/platform/**', '**/src/app/**', '**/src/view/**', '**/src/ui/**', '**/src/audio/**', '**/src/i18n/**'], message: `${LAYER}: tools/sim は core と content だけを import する` },
];
/** view: core の selectors・events・num・rng と型、Phaser、i18n（Q-14） */
const viewImports = [
  libs(['preact'], `${LAYER}: view は Preact に依存しない`),
  { group: ['**/ui/**', '**/save/**', '**/platform/**', '**/audio/**'], message: `${LAYER}: view から ui・save・platform・audio を import しない` },
  {
    group: ['**/core/*', '!**/core/selectors.ts', '!**/core/events.ts', '!**/core/num.ts', '!**/core/rng.ts'],
    allowTypeImports: true,
    message: `${LAYER}: view は core の selectors・events・num・rng と型だけを import する（状態を書き換えない。Q-14）`,
  },
  { group: ['**/app/**'], allowTypeImports: true, message: `${LAYER}: view は app の型だけを使う` },
];
/** ui: core（selectors・actions の型）・Preact・i18n */
const uiImports = [
  libs(['phaser'], `${LAYER}: ui は Phaser に依存しない`),
  { group: ['**/view/**', '**/save/**'], message: `${LAYER}: ui から view・save を import しない（保存は app を通す）` },
];
/** platform: ブラウザの API と SDK。core は型だけ */
const platformImports = [
  libs(['phaser', 'preact'], `${LAYER}: platform は描画・UI に依存しない`),
  { group: ['**/view/**', '**/ui/**', '**/app/**', '**/save/**'], message: `${LAYER}: platform から view・ui・app・save を import しない` },
  { group: ['**/core/**'], allowTypeImports: true, message: `${LAYER}: platform は core の型だけを使う` },
];

export default defineConfig(
  { ignores: ['dist/', 'node_modules/', 'public/', 'perf-results/', 'playwright-report/', 'test-results/', 'release/'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  { files: ['tools/**', 'tests/**', 'scripts/**', 'e2e/**', '*.config.*'], languageOptions: { globals: globals.node } },
  // 決定論（core・content: タイマーも禁止）
  {
    files: ['src/core/**', 'src/content/**'],
    linterOptions: { noInlineConfig: true },
    rules: { ...mathRules, 'no-restricted-globals': ['error', ...determinismGlobals, ...browserGlobals, ...timerGlobals] },
  },
  {
    files: ['src/save/**'],
    linterOptions: { noInlineConfig: true },
    rules: { ...mathRules, 'no-restricted-globals': ['error', ...determinismGlobals, ...browserGlobals] },
  },
  { files: ['tools/sim/**'], rules: { ...mathRules, 'no-restricted-globals': ['error', ...determinismGlobals, ...browserGlobals] } },
  // 層をまたぐ import
  { files: ['src/core/**'], rules: restrictedImports(coreImports) },
  { files: ['src/content/**'], rules: restrictedImports(contentImports) },
  { files: ['src/save/**'], rules: restrictedImports(saveImports) },
  { files: ['tools/sim/**'], rules: restrictedImports(simImports) },
  { files: ['src/view/**'], rules: restrictedImports(viewImports) },
  { files: ['src/ui/**'], rules: restrictedImports(uiImports) },
  { files: ['src/platform/**'], rules: restrictedImports(platformImports) },
);
