// ビルドの mode の一覧（arch §16-1。BL-007）。vite.config.ts とテスト（tests/unit/build-modes.test.ts）が使う
export interface BuildMode {
  /** 出力先（リポジトリからの相対） */
  outDir: string;
  /** index.html に入れる SDK の script（なければ null） */
  sdk: string | null;
  /** 本番に出すビルドか（テスト用フックを含めてはいけない） */
  production: boolean;
}

export const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
export const POKI_SDK = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

export const BUILD_MODES: Readonly<Record<string, BuildMode>> = {
  web: { outDir: 'dist/web', sdk: null, production: true },
  crazygames: { outDir: 'dist/crazygames', sdk: CRAZYGAMES_SDK, production: true },
  itch: { outDir: 'dist/itch', sdk: null, production: true },
  poki: { outDir: 'dist/poki', sdk: POKI_SDK, production: true },
  e2e: { outDir: 'dist/e2e-web', sdk: null, production: false },
  'e2e-crazygames': { outDir: 'dist/e2e-crazygames', sdk: CRAZYGAMES_SDK, production: false },
  // PoC の確認用（build:e2e には入れない）
  'e2e-poki': { outDir: 'dist/e2e-poki', sdk: POKI_SDK, production: false },
};

/** mode を解決する。開発サーバー（serve）は development・test も受け付ける。定義のない mode のビルドは失敗させる（TS-007-14） */
export function resolveMode(mode: string, command: 'build' | 'serve'): BuildMode {
  const m = BUILD_MODES[mode];
  if (m) return m;
  if (command === 'serve' || mode === 'test') return { outDir: `dist/${mode}`, sdk: null, production: false };
  throw new Error(`vite build: 定義のない mode "${mode}"（${Object.keys(BUILD_MODES).join('・')} のどれか。.env.<mode> と tools/build/modes.ts に足す）`);
}
