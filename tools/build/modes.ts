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

// ---- 本番のビルドの環境変数の固定（レビュー S-8） ----
// Vite は .env.local・.env.<mode>.local・シェルの環境変数も読むので、手元の設定でテスト用フック・偽の広告・
// CrazyGames の広告の有無・ターゲットが本番のビルドに入りうる。本番の mode ではこれらを固定し、手元の値が違えばビルドを止める。

/** 本番のビルドで固定する変数 */
export const LOCKED_ENV_KEYS = ['VITE_TARGET', 'VITE_TEST_HOOKS', 'VITE_FAKE_ADS', 'VITE_CG_ADS'] as const;
export type LockedEnvKey = (typeof LOCKED_ENV_KEYS)[number];

/** .env の書式（KEY=VALUE。# から後はコメント、前後の空白と引用符は除く）を読む */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m?.[1] || m[2] === undefined) continue;
    let v = m[2];
    const q = /^(['"])(.*)\1$/.exec(v);
    v = q?.[2] ?? v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/**
 * 本番の mode で使う値。ターゲットは mode の名前、テスト用フック・偽の広告は false。
 * VITE_CG_ADS は crazygames だけがリポジトリの .env.crazygames の値（Basic Launch は false、Full Launch は true。
 * test-strategy §4-3）を使い、ほかのターゲットは false
 * @param committed リポジトリにある .env と .env.<mode> を読んだ値（.local とシェルの環境変数は含めない）
 */
export function lockedEnv(mode: string, committed: Readonly<Record<string, string>>): Record<LockedEnvKey, string> {
  return {
    VITE_TARGET: mode,
    VITE_TEST_HOOKS: 'false',
    VITE_FAKE_ADS: 'false',
    VITE_CG_ADS: mode === 'crazygames' && committed.VITE_CG_ADS === 'true' ? 'true' : 'false',
  };
}

/** Vite が実際に解決した値（loadEnv の結果）のうち、固定の値と違うもの（本番のビルドを止める理由） */
export function envOverrides(locked: Readonly<Record<LockedEnvKey, string>>, resolved: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const k of LOCKED_ENV_KEYS) {
    const v = resolved[k];
    if (v !== undefined && v !== locked[k]) out.push(`${k}=${v}（本番の値は ${locked[k]}）`);
  }
  return out;
}

/**
 * 本番の mode のビルドの環境を検査し、define に入れる値を返す（vite.config.ts が使う）。
 * 手元の上書きがあれば例外（ビルドを止める）。本番でない mode は空の define を返す
 * @param readFile リポジトリの .env ファイルを読む（なければ null）
 * @param resolved Vite の loadEnv(mode, envDir, 'VITE_') の結果（.env.local・.env.<mode>.local・シェルの環境変数を含む）
 */
export function productionEnvDefine(
  mode: string,
  build: BuildMode,
  readFile: (name: string) => string | null,
  resolved: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  if (!build.production) return {};
  const committed = { ...parseEnvText(readFile('.env') ?? ''), ...parseEnvText(readFile(`.env.${mode}`) ?? '') };
  const locked = lockedEnv(mode, committed);
  const bad = envOverrides(locked, resolved);
  if (bad.length > 0) {
    throw new Error(
      `vite build --mode ${mode}: 本番のビルドに手元の設定が入ります（${bad.join('、')}）。` +
        '.env.local・.env.<mode>.local・シェルの環境変数から外してください（テスト用のビルドは npm run build:e2e）',
    );
  }
  const define: Record<string, string> = { 'import.meta.env.DEV': 'false' };
  for (const k of LOCKED_ENV_KEYS) define[`import.meta.env.${k}`] = JSON.stringify(locked[k]);
  return define;
}
