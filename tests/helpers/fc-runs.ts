// BL-090: fast-check の性質テストの試行回数とシードを 1 か所で決める。
// 性質テストはすべて `fc.assert(..., fcRuns(<既定の回数>, <既定のシード>))` と書き、直書きの numRuns を残さない
// （tests/helpers/fc-runs.test.ts が検査する）。
// - PR・手元の `npm run test`: 環境変数がなければ、各テストが渡した既定の回数・シードのまま（今までと同じ。時間を増やさない）
// - `npm run test:property:full`（毎晩の nightly.yml。vitest.property.config.ts）: 既定の回数 × 5、シードは実行ごとに変える
// 環境変数（どちらのコマンドでも効く。空の文字列は「指定なし」）
//   FC_NUM_RUNS   … すべての性質の試行回数をこの数にする（正の整数。FC_RUNS_SCALE より優先）
//   FC_RUNS_SCALE … 各性質の既定の回数に掛ける倍率（正の数。端数は切り上げ）
//   FC_SEED       … すべての性質のシード（整数）。反例の再現は `FC_SEED=<seed> npm run test:property:full -- <ファイル>`
// 形の正しくない値は例外にする（毎晩の設定の誤りを、黙って既定の回数で流して見逃さないように）。使い方の説明は docs/testing.md

export interface FcRunOptions {
  numRuns: number;
  seed?: number;
}

export type FcEnv = Readonly<Record<string, string | undefined>>;

const value = (env: FcEnv, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v === undefined || v === '' ? undefined : v;
};

function parse(env: FcEnv, key: string, ok: (n: number) => boolean, what: string): number | undefined {
  const v = value(env, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!ok(n)) throw new Error(`${key}=${v} は${what}ではない（tests/helpers/fc-runs.ts）`);
  return n;
}

/** 環境変数 env から試行の設定を決める（テスト用に env を受け取る形。ふつうは fcRuns を使う） */
export function fcRunsFrom(env: FcEnv, numRuns: number, seed?: number): FcRunOptions {
  if (!Number.isSafeInteger(numRuns) || numRuns < 1) throw new Error(`既定の試行回数 ${numRuns} は正の整数ではない`);
  const fixed = parse(env, 'FC_NUM_RUNS', (n) => Number.isSafeInteger(n) && n >= 1, '正の整数');
  const scale = parse(env, 'FC_RUNS_SCALE', (n) => Number.isFinite(n) && n > 0, '正の数');
  const envSeed = parse(env, 'FC_SEED', (n) => Number.isSafeInteger(n), '整数');
  const runs = fixed ?? (scale === undefined ? numRuns : Math.max(1, Math.ceil(numRuns * scale)));
  const s = envSeed ?? seed;
  return s === undefined ? { numRuns: runs } : { numRuns: runs, seed: s };
}

/**
 * fc.assert の第 2 引数。numRuns は PR での既定の回数、seed は PR での既定のシード（省くと fast-check が毎回変える。今までと同じ）
 * @example fc.assert(fc.property(arb, (x) => ...), fcRuns(300, 20260928))
 */
export const fcRuns = (numRuns: number, seed?: number): FcRunOptions => fcRunsFrom(process.env, numRuns, seed);

/**
 * `npm run test:property:full` の中か（vitest.property.config.ts が FC_PROPERTY_FULL=1 を渡す）。
 * 性質テストと同じファイルにある実時間の検査（TS-012-13 の 50ms など）は、この実行では飛ばす（数分続く重い計算の後は
 * CPU の状態で揺れて落ちることがある。反例を探す実行の目的の外で、実時間の検査は PR の `npm run test` で毎回見ている）
 */
export const inPropertyFullRun = (): boolean => process.env.FC_PROPERTY_FULL === '1';
