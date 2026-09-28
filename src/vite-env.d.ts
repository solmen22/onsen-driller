/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET: 'web' | 'itch' | 'crazygames' | 'poki' | 'dev';
  readonly VITE_CG_ADS?: 'true' | 'false';
  readonly VITE_TEST_HOOKS?: 'true' | 'false';
  /** e2e（web）で dev アダプタの偽の広告を使う（target は VITE_TARGET のまま） */
  readonly VITE_FAKE_ADS?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json の version（vite.config.ts・vitest.config.ts の define で埋め込む） */
declare const __APP_VERSION__: string;
