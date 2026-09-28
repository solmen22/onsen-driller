// ESLint（arch §5）: 層をまたぐ import と、決定論を壊す API を禁止する
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const determinismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: '決定論: core では rng.ts（sfc32・hash32）を使う' },
    { object: 'Date', property: 'now', message: '決定論: 時刻は app から引数で渡す（arch §8-2）' },
    { object: 'performance', property: 'now', message: '決定論: 時刻は app から引数で渡す（arch §8-2）' },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "NewExpression[callee.name='Date']", message: '決定論: new Date() を使わない' },
  ],
  'no-restricted-globals': [
    'error',
    ...['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch'].map(
      (name) => ({ name, message: 'core・content・save・sim ではブラウザ API を使わない' }),
    ),
  ],
};

const coreImportRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        { group: ['phaser', 'phaser/*', 'preact', 'preact/*'], message: 'core は描画・UI に依存しない（arch §5）' },
        { group: ['**/platform/**', '**/app/**', '**/view/**', '**/ui/**', '**/audio/**'], message: '層をまたぐ import（arch §5）' },
      ],
    },
  ],
};

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
  {
    files: ['src/core/**', 'src/content/**', 'src/save/**', 'tools/sim/bots.ts', 'tools/sim/sim.ts'],
    rules: { ...determinismRules, ...coreImportRules },
  },
  {
    files: ['src/save/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['phaser', 'preact', '**/view/**', '**/ui/**', '**/app/**'], message: '層をまたぐ import（arch §5）' }] },
      ],
    },
  },
  {
    files: ['src/ui/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['phaser', 'phaser/*', '**/view/**'], message: 'ui は Phaser に依存しない（arch §5）' }] }] },
  },
  {
    files: ['src/view/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['preact', 'preact/*', '**/ui/**'], message: 'view は Preact に依存しない（arch §5）' }] }] },
  },
);
