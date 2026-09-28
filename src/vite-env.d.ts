/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TARGET: 'web' | 'itch' | 'crazygames' | 'poki' | 'dev';
  readonly VITE_CG_ADS?: 'true' | 'false';
  readonly VITE_TEST_HOOKS?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
