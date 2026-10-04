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
    // 文字列からコードを作る抜け道（(() => 0).constructor('return Date.now()')() など。レビュー N-2）
    { selector: "CallExpression[callee.property.name='constructor'], NewExpression[callee.property.name='constructor']", message: `${DET} constructor 経由で関数を作らない（抜け道の禁止）` },
    { selector: "CallExpression[callee.property.value='constructor'], NewExpression[callee.property.value='constructor']", message: `${DET} constructor 経由で関数を作らない（抜け道の禁止）` },
  ],
  // eval・new Function（型情報の規則 no-implied-eval に頼らずに止める。レビュー N-2）
  'no-eval': 'error',
  'no-new-func': 'error',
};

const restrictedImports = (patterns) => ({
  'no-restricted-imports': 'off',
  '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
});
const LAYER = '層をまたぐ import（arch §5）';
const libs = (names, why) => ({ group: names.flatMap((n) => [n, `${n}/*`]), message: why });
/**
 * 層のディレクトリ全体（中のファイルと、index.ts を省いたディレクトリそのものの import。'../core'・'../core/' など）。
 * gitignore の書式なので、'**\/core' は中のファイルもすべて当てる（親のディレクトリが当たると子も当たる）。
 * 一部のファイルだけ許す層（view → core）には使わない（下の bareDir を使う）。レビュー S-7
 */
const dirs = (names, prefix = '**/') => names.flatMap((n) => [`${prefix}${n}`, `${prefix}${n}/**`]);
/** ディレクトリそのものの import だけ（'../../core'・'../../core/'。中のファイルは当てない） */
const bareDir = (name) => `(^|/)${name}/?$`;

/** core: content（型と値）と break_infinity.js だけ */
const coreImports = [
  libs(['phaser', 'preact', 'valibot', 'lz-string', 'zzfx'], `${LAYER}: core は描画・UI・保存のライブラリに依存しない`),
  { group: ['node:*'], message: `${LAYER}: core は Node の API に依存しない` },
  { group: dirs(['save', 'platform', 'app', 'view', 'ui', 'audio', 'i18n', 'tools']), message: `${LAYER}: core から外側の層を import しない` },
];
/** content: core の型だけ（Q-14） */
const contentImports = [
  ...coreImports.slice(0, 2),
  { group: dirs(['save', 'platform', 'app', 'view', 'ui', 'audio', 'i18n', 'tools']), message: `${LAYER}: content から外側の層を import しない` },
  { group: dirs(['core']), allowTypeImports: true, message: `${LAYER}: content は core の型だけを import する（import type。Q-14）` },
];
/** save: core・content・valibot・lz-string と platform の型 */
const saveImports = [
  libs(['phaser', 'preact', 'zzfx'], `${LAYER}: save は描画・UI に依存しない`),
  { group: dirs(['app', 'view', 'ui', 'audio', 'i18n']), message: `${LAYER}: save から app・view・ui を import しない` },
  { group: dirs(['platform']), allowTypeImports: true, message: `${LAYER}: save は platform の型だけを使う（ストレージは引数で受け取る）` },
];
/** tools/sim: core・content だけ */
const simImports = [
  libs(['phaser', 'preact', 'valibot', 'lz-string', 'zzfx'], `${LAYER}: シミュレーターは描画・UI・保存に依存しない`),
  { group: dirs(['save', 'platform', 'app', 'view', 'ui', 'audio', 'i18n'], '**/src/'), message: `${LAYER}: tools/sim は core と content だけを import する` },
];
/** view: core の selectors・events・num・rng と型、Phaser、i18n（Q-14） */
const viewImports = [
  libs(['preact'], `${LAYER}: view は Preact に依存しない`),
  { group: dirs(['ui', 'save', 'platform', 'audio']), message: `${LAYER}: view から ui・save・platform・audio を import しない` },
  {
    group: ['**/core/*', '!**/core/selectors.ts', '!**/core/events.ts', '!**/core/num.ts', '!**/core/rng.ts'],
    allowTypeImports: true,
    message: `${LAYER}: view は core の selectors・events・num・rng と型だけを import する（状態を書き換えない。Q-14）`,
  },
  {
    regex: bareDir('core'),
    allowTypeImports: true,
    message: `${LAYER}: view は core の index（'../core' のようなディレクトリの import）から値を import しない（Q-14。レビュー S-7）`,
  },
  { group: dirs(['app']), allowTypeImports: true, message: `${LAYER}: view は app の型だけを使う` },
];
/** ui: core（selectors・actions の型）・Preact・i18n */
const uiImports = [
  libs(['phaser'], `${LAYER}: ui は Phaser に依存しない`),
  { group: dirs(['view', 'save']), message: `${LAYER}: ui から view・save を import しない（保存は app を通す）` },
];
/** platform: ブラウザの API と SDK。core は型だけ */
const platformImports = [
  libs(['phaser', 'preact'], `${LAYER}: platform は描画・UI に依存しない`),
  { group: dirs(['view', 'ui', 'app', 'save']), message: `${LAYER}: platform から view・ui・app・save を import しない` },
  { group: dirs(['core']), allowTypeImports: true, message: `${LAYER}: platform は core の型だけを使う` },
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
  // ポータルへの loading・gameplay の合図を呼ぶのは app/lifecycle.ts だけ（BL-056・BL-057。PR #16 のレビュー Nit 1）。
  // UI・広告の流れから platform.gameplayStart() などを直接呼ぶと、ライフサイクルの止まる理由の集合とずれる。
  // main.ts の life.loadingStart()・life.loadingStop()（ライフサイクルそのもの）は通す。
  // core・content・save には mathRules の no-restricted-syntax があり、同じ規則を別の設定で重ねると上書きになるので対象にしない
  // （その 3 つは層の規則で platform の値を import できない）
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}', 'src/view/**/*.{ts,tsx}'],
    ignores: ['src/app/lifecycle.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(loadingStart|loadingStop|gameplayStart|gameplayStop)$/]:not([callee.object.name='life'])",
          message: 'loading・gameplay の合図は app/lifecycle.ts だけが呼ぶ（止まる理由は life.setPaused で渡す。BL-056・PR #16 のレビュー Nit 1）',
        },
      ],
    },
  },
  // E2E の spec は共通の検査（通信・Cookie・キー名）の付いた test を使う（BL-073。PR #4 のレビュー S-2）。
  // @playwright/test の test を直接使うと harness の自動の検査が黙って外れるため。PoC の道具（PW_POC=1 のときだけ動く）は除く。
  // 抜け道を塞ぐ（PR #4 の再レビュー R-S2。BL-094。tests/unit/lint-e2e-imports.test.ts で確かめる）:
  // - test は既定の export でもある（import test from '@playwright/test'）ので 'default' も止める
  // - @playwright/test の中身は playwright/test の再 export で、playwright/test からも import できるので両方を止める
  // - 対象のファイルは、Playwright がテストとして読む名前すべて（playwright.config.ts は testMatch を指定しないので、
  //   既定の '**/*.@(spec|test).?(c|m)[jt]s?(x)'）。.spec.ts だけだと e2e/foo.test.ts が抜ける。
  //   JS の名前（.js・.mjs など）でも規則が動くよう、このブロックでも @typescript-eslint のプラグインを読み込む（上と同じ物）
  // - TS の parser が当たるのは上の '**/*.{ts,tsx}' だけなので、型注釈のある e2e/foo.spec.mts・.cts は「Parsing error」で止まる
  //   （止める側に倒れる。E2E は .spec.ts で書く。PR #12 のレビュー N-4。testMatch を狭めると .test.ts が黙って動かなくなるので狭めない）
  // - _baseTest（@playwright/test の型つきの公開の export。素の test と同じ物）も止める（PR #12 のレビュー S-1。BL-108）。
  //   support 経由で素の test から作った fixture・動的 import・.cjs の require は lint では止められないので、
  //   実行時にレポーター（e2e/support/common-checks-reporter.ts）が「共通の検査の印のないテスト」として見つける
  {
    files: ['e2e/**/*.@(spec|test).?(c|m)[jt]s?(x)'],
    ignores: ['e2e/perf.spec.ts', 'e2e/screens.spec.ts', 'e2e/sdk-live.spec.ts', 'e2e/smoke.spec.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: ['@playwright/test', 'playwright/test'].map((name) => ({
            name,
            importNames: ['test', 'default', '_baseTest'],
            message: "E2E の spec は './support/fixtures.ts' の test を使う（共通の検査 TS-COM-01〜04 と TS-073-04 が自動で付く。BL-073・BL-094）",
          })),
        },
      ],
    },
  },
);
