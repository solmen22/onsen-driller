// BL-090: 性質テストの試行回数・シードの共通のヘルパー（tests/helpers/fc-runs.ts）と、すべての性質テストがそれを通すことの検査
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fcRunsFrom } from './fc-runs.ts';

describe('fcRunsFrom — 環境変数がなければ既定のまま（PR の npm run test は今までと同じ）', () => {
  it('既定の回数とシードをそのまま返す。シードを省いたら seed を持たない（fast-check が毎回変える）', () => {
    expect(fcRunsFrom({}, 300, 20260928)).toEqual({ numRuns: 300, seed: 20260928 });
    const noSeed = fcRunsFrom({}, 400);
    expect(noSeed).toEqual({ numRuns: 400 });
    expect('seed' in noSeed).toBe(false);
  });
  it('空の文字列は「指定なし」', () => {
    expect(fcRunsFrom({ FC_NUM_RUNS: '', FC_RUNS_SCALE: ' ', FC_SEED: '' }, 60, 12)).toEqual({ numRuns: 60, seed: 12 });
  });
});

describe('fcRunsFrom — test:property:full（毎晩）の上書き', () => {
  it('FC_RUNS_SCALE で既定の回数に倍率を掛ける（端数は切り上げ、最低 1 回）', () => {
    expect(fcRunsFrom({ FC_RUNS_SCALE: '10' }, 300, 1)).toEqual({ numRuns: 3000, seed: 1 });
    expect(fcRunsFrom({ FC_RUNS_SCALE: '2.5' }, 3)).toEqual({ numRuns: 8 });
    expect(fcRunsFrom({ FC_RUNS_SCALE: '0.001' }, 20)).toEqual({ numRuns: 1 });
  });
  it('FC_NUM_RUNS はすべての性質の回数を固定し、倍率より優先する', () => {
    expect(fcRunsFrom({ FC_NUM_RUNS: '1000', FC_RUNS_SCALE: '10' }, 20, 5)).toEqual({ numRuns: 1000, seed: 5 });
  });
  it('FC_SEED は既定のシードを置き換え、既定のシードがない性質にも付く（反例の再現）', () => {
    expect(fcRunsFrom({ FC_SEED: '123456789' }, 100, 7)).toEqual({ numRuns: 100, seed: 123456789 });
    expect(fcRunsFrom({ FC_SEED: '-42' }, 400)).toEqual({ numRuns: 400, seed: -42 });
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
    ]) {
      expect(() => fcRunsFrom(env, 100, 1), JSON.stringify(env)).toThrow(/tests\/helpers\/fc-runs\.ts/);
    }
    expect(() => fcRunsFrom({}, 0)).toThrow();
  });
});

describe('すべての性質テストが fcRuns を通す（直書きの numRuns を残さない。BL-090）', () => {
  const root = new URL('../', import.meta.url);
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts') && !f.startsWith('helpers/fc-runs'));
  const read = (f: string): string => readFileSync(new URL(f, root), 'utf8');

  it('tests/ の中に numRuns の直書きがない', () => {
    expect(files.filter((f) => /\bnumRuns\b/.test(read(f)))).toEqual([]);
  });
  it('fc.assert を使うファイルはすべて fcRuns を使う（test:property:full が回数を増やせる）', () => {
    const users = files.filter((f) => read(f).includes('fc.assert('));
    expect(users.length, '前提: 性質テストがある').toBeGreaterThanOrEqual(9);
    expect(users.filter((f) => !read(f).includes('fcRuns('))).toEqual([]);
  });
});
