// BL-090: 性質テストの試行回数・シードの共通のヘルパー（tests/helpers/fc-runs.ts）。
// すべての性質テストがそれを通すことは、ESLint が呼び出しごとに見る（tests/unit/lint-fc-runs.test.ts。PR #14 のレビュー S-1）
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fcRuns, fcRunsFrom, SHRINK_LIMIT_MS, shrinkTimeLimit, type FcEnv } from '../helpers/fc-runs.ts';

/** 回数とシードだけ（縮小の時間の上限のプラグインは下の BL-140 の describe で見る） */
const counts = (env: FcEnv, numRuns: number, seed?: number): { numRuns: number; seed?: number } => {
  const o = fcRunsFrom(env, numRuns, seed);
  return o.seed === undefined ? { numRuns: o.numRuns } : { numRuns: o.numRuns, seed: o.seed };
};

describe('fcRunsFrom — 環境変数がなければ既定のまま（PR の npm run test は今までと同じ）', () => {
  it('既定の回数とシードをそのまま返す。シードを省いたら seed を持たない（fast-check が毎回変える）', () => {
    expect(counts({}, 300, 20260928)).toEqual({ numRuns: 300, seed: 20260928 });
    const noSeed = fcRunsFrom({}, 400);
    expect(counts({}, 400)).toEqual({ numRuns: 400 });
    expect('seed' in noSeed).toBe(false);
  });
  it('空の文字列は「指定なし」', () => {
    expect(counts({ FC_NUM_RUNS: '', FC_RUNS_SCALE: ' ', FC_SEED: '' }, 60, 12)).toEqual({ numRuns: 60, seed: 12 });
  });
});

describe('fcRunsFrom — test:property:full（毎晩）の上書き', () => {
  it('FC_RUNS_SCALE で既定の回数に倍率を掛ける（端数は切り上げ、最低 1 回）', () => {
    expect(counts({ FC_RUNS_SCALE: '10' }, 300, 1)).toEqual({ numRuns: 3000, seed: 1 });
    expect(counts({ FC_RUNS_SCALE: '2.5' }, 3)).toEqual({ numRuns: 8 });
    expect(counts({ FC_RUNS_SCALE: '0.001' }, 20)).toEqual({ numRuns: 1 });
  });
  it('FC_NUM_RUNS はすべての性質の回数を固定し、倍率より優先する', () => {
    expect(counts({ FC_NUM_RUNS: '1000', FC_RUNS_SCALE: '10' }, 20, 5)).toEqual({ numRuns: 1000, seed: 5 });
  });
  it('FC_SEED は既定のシードを置き換え、既定のシードがない性質にも付く（反例の再現）', () => {
    expect(counts({ FC_SEED: '123456789' }, 100, 7)).toEqual({ numRuns: 100, seed: 123456789 });
    expect(counts({ FC_SEED: '-42' }, 400)).toEqual({ numRuns: 400, seed: -42 });
  });
  it('形の正しくない値は例外（設定の誤りを黙って既定の回数で流さない）', () => {
    for (const env of [
      { FC_NUM_RUNS: '0' },
      { FC_NUM_RUNS: '1.5' },
      { FC_NUM_RUNS: 'many' },
      { FC_RUNS_SCALE: '0' },
      { FC_RUNS_SCALE: '-2' },
      { FC_RUNS_SCALE: 'Infinity' },
      { FC_RUNS_SCALE: 'x10' },
      { FC_SEED: '1.5' },
      { FC_SEED: 'abc' },
      { FC_SHRINK_LIMIT_MS: '-1' },
      { FC_SHRINK_LIMIT_MS: '1.5' },
      { FC_SHRINK_LIMIT_MS: '10s' },
    ]) {
      expect(() => fcRunsFrom(env, 100, 1), JSON.stringify(env)).toThrow(/tests\/helpers\/fc-runs\.ts/);
    }
    expect(() => fcRunsFrom({}, 0)).toThrow();
  });
});

describe('BL-140 反例の縮小の時間の上限（PR #62 の再レビューの N-7）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('既定で上限のプラグインを 1 つ持つ。FC_SHRINK_LIMIT_MS=0 なら持たない（最後まで縮める）', () => {
    expect(SHRINK_LIMIT_MS).toBeGreaterThan(0);
    expect(SHRINK_LIMIT_MS).toBeLessThanOrEqual(30_000); // 「数十秒以内に赤」（受け入れ基準 1）
    expect(fcRunsFrom({}, 10, 1).plugins).toHaveLength(1);
    expect(fcRunsFrom({ FC_SHRINK_LIMIT_MS: '' }, 10, 1).plugins).toHaveLength(1);
    expect(fcRunsFrom({ FC_SHRINK_LIMIT_MS: '2000' }, 10, 1).plugins).toHaveLength(1);
    expect('plugins' in fcRunsFrom({ FC_SHRINK_LIMIT_MS: '0' }, 10, 1)).toBe(false);
    expect(() => shrinkTimeLimit(0)).toThrow();
    expect(() => shrinkTimeLimit(Number.NaN)).toThrow();
  });

  it('失敗の前は何もしない: 時計が上限を何倍過ぎても、実行の結果をそのまま返す', () => {
    let t = 0;
    const p = shrinkTimeLimit(100, () => (t += 1_000))(0, new Map());
    const run = p.decorateRun!((v) => (v === 'skip' ? new fc.PreconditionFailure() : null));
    for (let i = 0; i < 5; i++) expect(run(i)).toBeNull();
    expect(fc.PreconditionFailure.isFailure(run('skip'))).toBe(true);
    expect((run('skip') as fc.PreconditionFailure).interruptExecution).toBe(false);
  });

  it('最初の失敗から上限が過ぎたら、以後の実行を中断（interruptExecution）で返し、predicate を呼ばない', () => {
    let t = 0;
    const p = shrinkTimeLimit(100, () => t)(0, new Map());
    const calls: unknown[] = [];
    const run = p.decorateRun!((v) => {
      calls.push(v);
      return v === 'bad' ? { error: new Error('bad') } : null;
    });
    expect(run('ok')).toBeNull();
    t = 50;
    expect(run('bad')).toEqual({ error: new Error('bad') }); // 最初の失敗（t=50）
    t = 149;
    expect(run('bad')).toEqual({ error: new Error('bad') }); // 縮小の途中（99ms）
    t = 150;
    const out = run('bad');
    expect(fc.PreconditionFailure.isFailure(out) && out.interruptExecution).toBe(true);
    expect(calls).toEqual(['ok', 'bad', 'bad']);
  });

  it('非同期の性質でも、失敗の時刻を結果が返ったときに数える', async () => {
    let t = 0;
    const p = shrinkTimeLimit(100, () => t)(0, new Map());
    const run = p.decorateRun!((v) => Promise.resolve(v === 'bad' ? { error: new Error('bad') } : null));
    expect(await run('ok')).toBeNull();
    expect(await run('bad')).toEqual({ error: new Error('bad') });
    t = 100;
    const out = await run('bad');
    expect(fc.PreconditionFailure.isFailure(out) && out.interruptExecution).toBe(true);
  });

  // fc.assert まで通す: 1 以上はどれも失敗し、偏りのない 0〜2^30 の値（シードで固定）が最小の反例 1 まで縮むのに 20 回以上の縮小が要る。
  // 実行の 1 回に costMs かかる
  // test:property:full（FC_SEED・FC_RUNS_SCALE を渡す）でも同じ値で流す（空の文字列は「指定なし」）
  const fixedRuns = (shrinkLimitMs: string): void => {
    for (const k of ['FC_NUM_RUNS', 'FC_RUNS_SCALE', 'FC_SEED']) vi.stubEnv(k, '');
    vi.stubEnv('FC_SHRINK_LIMIT_MS', shrinkLimitMs);
  };
  const failingWithCost = (costMs: number) => (): void => {
    fc.assert(
      fc.property(fc.noBias(fc.integer({ min: 0, max: 2 ** 30 })), (x) => {
        const until = performance.now() + costMs;
        while (performance.now() < until) {
          // 縮小が重い性質の代わり（gameStateArb の大きな状態と同期のテスト）
        }
        return x < 1;
      }),
      fcRuns(10, 20261018),
    );
  };

  it('fc.assert（fcRuns 経由）: 上限で縮小を打ち切り、縮めた途中の反例・シード・打ち切った旨で赤になる', () => {
    fixedRuns('20');
    const started = performance.now();
    let message = '';
    try {
      failingWithCost(5)();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(message).toMatch(/seed: 20261018/);
    // 最初の失敗の後は 20ms（実行 4〜5 回）まで: 1 まで縮む前に止まる
    expect(Number(/Shrunk (\d+) time/.exec(message)?.[1] ?? 0)).toBeLessThanOrEqual(5);
    expect(Number(/Counterexample: \[(\d+)\]/.exec(message)?.[1])).toBeGreaterThan(1); // 縮めた途中
    expect(message).toMatch(/20ms で打ち切った（BL-140/);
    expect(message).toMatch(/FC_SHRINK_LIMIT_MS=0/);
  });

  it('fc.assert（fcRuns 経由）: FC_SHRINK_LIMIT_MS=0 なら今までどおり最後まで縮める（最小の反例 1。打ち切った旨は出ない）', () => {
    fixedRuns('0');
    expect(failingWithCost(0)).toThrow(/Counterexample: \[1\]/);
    expect(failingWithCost(0)).not.toThrow(/打ち切った/);
  });
});
