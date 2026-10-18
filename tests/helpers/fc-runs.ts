// BL-090: fast-check の性質テストの試行回数とシードを 1 か所で決める。
// 性質テストはすべて `fc.assert(..., fcRuns(<既定の回数>, <既定のシード>))` と書き、直書きの numRuns を残さない
// （ESLint の no-restricted-syntax が呼び出しごとに検査する。eslint.config.js の BL-090 のブロック・tests/unit/lint-fc-runs.test.ts）。
// - PR・手元の `npm run test`: 環境変数がなければ、各テストが渡した既定の回数・シードのまま（今までと同じ。時間を増やさない）
// - `npm run test:property:full`（毎晩の nightly.yml。vitest.property.config.ts）: 既定の回数 × 5、シードは実行ごとに変える
// 環境変数（どちらのコマンドでも効く。空の文字列は「指定なし」）
//   FC_NUM_RUNS   … すべての性質の試行回数をこの数にする（正の整数。FC_RUNS_SCALE より優先）
//   FC_RUNS_SCALE … 各性質の既定の回数に掛ける倍率（正の数。端数は切り上げ）
//   FC_SEED       … すべての性質のシード（整数）。反例の再現は `FC_SEED=<seed> npm run test:property:full -- <ファイル>`
//   FC_SHRINK_LIMIT_MS … 反例の縮小（shrink）に使う時間の上限（ミリ秒。0 以上の整数。0 は上限なし。既定 SHRINK_LIMIT_MS）
// 形の正しくない値は例外にする（毎晩の設定の誤りを、黙って既定の回数で流して見逃さないように）。使い方の説明は docs/testing.md

import fc from 'fast-check';

export interface FcRunOptions {
  numRuns: number;
  seed?: number;
  /** 縮小の時間の上限（shrinkTimeLimit）。上限なし（FC_SHRINK_LIMIT_MS=0）のときは持たない */
  plugins?: fc.Plugin<unknown>[];
}

/**
 * 反例の縮小の時間の上限の既定（BL-140。PR #62 の再レビューの N-7）。gameStateArb の状態は大きく、テストは同期で動くので
 * vitest の testTimeout では止まらず、変異で 10 分を超えても縮小が終わらなかった。最初の失敗からこの時間で縮小を打ち切り、
 * その時点の反例（縮めた途中）とシード・path で赤にする。性質が成り立っている間は何もしない（試行の回数・時間は変わらない）
 */
export const SHRINK_LIMIT_MS = 10_000;

/**
 * fast-check のプラグイン: 最初の失敗から limitMs が過ぎたら、以後の実行（縮小の候補）を中断として返し、縮小を打ち切る。
 * 失敗が見つかっていれば、fast-check はその時点の反例で失敗を報告する（RunExecution の interrupt。失敗の扱いは変わらない）。
 * 失敗が見つかる前は何もしない（fc.interruptAfterTimeLimit と違い、遅いだけの緑の実行を打ち切ったり赤にしたりしない）。
 * 打ち切ったときは、fast-check の報告の後ろに打ち切ったことと、続きを縮める方法を足す。
 * 性質は同期でも非同期でも、predicate の結果をそのまま返す（打ち切りの判定は実行の前だけ）
 */
export function shrinkTimeLimit(limitMs: number, now: () => number = () => performance.now()): fc.Plugin<unknown> {
  if (!Number.isFinite(limitMs) || limitMs <= 0) throw new Error(`縮小の時間の上限 ${limitMs} は正の数ではない`);
  return () => {
    let firstFailureAt: number | undefined;
    let cut = false;
    return {
      decorateRun: (nestedRun) => (value) => {
        if (firstFailureAt !== undefined && now() - firstFailureAt >= limitMs) {
          cut = true;
          return new fc.PreconditionFailure(true);
        }
        const mark = (out: fc.PreconditionFailure | fc.PropertyFailure | null): void => {
          if (firstFailureAt === undefined && out !== null && !fc.PreconditionFailure.isFailure(out)) firstFailureAt = now();
        };
        const out = nestedRun(value);
        if (out !== null && 'then' in out) {
          return out.then((r) => {
            mark(r);
            return r;
          });
        }
        mark(out);
        return out;
      },
      onAllRunsComplete: (details) => {
        if (!cut || !details.failed) return;
        const base = fc.defaultReportMessage(details) ?? 'Property failed';
        throw new Error(
          `${base}\n\n反例の縮小を最初の失敗から ${limitMs}ms で打ち切った（BL-140。縮めた途中の反例）。` +
            `最後まで縮めるには FC_SHRINK_LIMIT_MS=0 と、上の seed・path で流し直す（docs/testing.md）`,
          { cause: details.errorInstance },
        );
      },
    };
  };
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
  const shrinkMs = parse(env, 'FC_SHRINK_LIMIT_MS', (n) => Number.isSafeInteger(n) && n >= 0, '0 以上の整数') ?? SHRINK_LIMIT_MS;
  const runs = fixed ?? (scale === undefined ? numRuns : Math.max(1, Math.ceil(numRuns * scale)));
  const s = envSeed ?? seed;
  const out: FcRunOptions = s === undefined ? { numRuns: runs } : { numRuns: runs, seed: s };
  if (shrinkMs > 0) out.plugins = [shrinkTimeLimit(shrinkMs)];
  return out;
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
