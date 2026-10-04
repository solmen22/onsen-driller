// BL-108: 共通の検査の印のないテストを見つけるレポーター（e2e/support/common-checks-reporter.ts）の対象・対象外の自己テスト。
// 実際の E2E での「落ちることの確認」（support 経由の素の test・_baseTest・動的 import・後片付けの絞り込み）は実行記録に残した。
// ここでは実行では作りにくい形（skipped・PoC の project・test.fail の期待どおりの失敗・再実行の 1 回目の失敗）を確かめる
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import CommonChecksReporter, { COMMON_CHECKS_MARK } from '../../e2e/support/common-checks-reporter.ts';

type Status = TestResult['status'];

function testCase(title: string, project = 'chromium', expectedStatus: Status = 'passed'): TestCase {
  return {
    expectedStatus,
    parent: { project: () => ({ name: project }) },
    location: { file: 'C:\\x\\onsen-driller\\e2e\\foo.spec.ts', line: 7, column: 1 },
    titlePath: () => ['', project, 'foo.spec.ts', 'グループ', title],
  } as unknown as TestCase;
}

function result(status: Status, marked: boolean, retry = 0): TestResult {
  return { status, retry, annotations: marked ? [{ type: COMMON_CHECKS_MARK, description: 'passed' }] : [] } as unknown as TestResult;
}

async function run(cases: [TestCase, TestResult][]): Promise<{ status?: string } | undefined> {
  const r = new CommonChecksReporter();
  for (const [t, res] of cases) r.onTestEnd(t, res);
  return r.onEnd();
}

describe('BL-108 共通の検査の印のないテストを見つけるレポーター', () => {
  afterEach(() => vi.restoreAllMocks());

  it('印のある合格だけなら実行の結果を変えない', async () => {
    expect(await run([[testCase('a'), result('passed', true)]])).toBeUndefined();
  });

  it('印のない合格があれば、名前と場所を出して実行を failed にする', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run([[testCase('a'), result('passed', true)], [testCase('印なし'), result('passed', false)]])).toEqual({ status: 'failed' });
    const out = err.mock.calls.flat().join('\n');
    expect(out).toContain('1 件');
    expect(out).toContain('[chromium] グループ › 印なし（e2e/foo.spec.ts:7）');
  });

  it('test.fail の期待どおりの失敗（expectedStatus failed）も印を求める', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run([[testCase('e', 'chromium', 'failed'), result('failed', false)]])).toEqual({ status: 'failed' });
    expect(await run([[testCase('e', 'chromium', 'failed'), result('failed', true)]])).toBeUndefined();
  });

  it('skipped（later・needs・fixme・skip）は印がなくても失敗にしない', async () => {
    expect(await run([[testCase('s'), result('skipped', false)]])).toBeUndefined();
  });

  it('期待どおりでない結果（失敗・タイムアウト・中断）は数えない（実行はすでに赤。再実行の 1 回目の失敗で flaky を赤にしない）', async () => {
    for (const st of ['failed', 'timedOut', 'interrupted'] as const) expect(await run([[testCase('f'), result(st, false)]])).toBeUndefined();
    // flaky: 1 回目は印なしで失敗、再実行で印つきの合格
    expect(await run([[testCase('f'), result('failed', false)], [testCase('f'), result('passed', true, 1)]])).toBeUndefined();
  });

  it('再実行で合格した結果に印がなければ失敗にし、再実行の回数を添える', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run([[testCase('r'), result('passed', false, 1)]])).toEqual({ status: 'failed' });
    expect(err.mock.calls.flat().join('\n')).toContain('・再実行 1）');
  });

  it('PoC の道具の project（poc-tools）は対象外。ほかの project はすべて対象', async () => {
    expect(await run([[testCase('p', 'poc-tools'), result('passed', false)]])).toBeUndefined();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const p of ['chromium', 'chromium-full', 'webkit', 'firefox', 'mobile-safari', 'mobile-chrome', 'prod-builds'])
      expect(await run([[testCase('p', p), result('passed', false)]]), p).toEqual({ status: 'failed' });
  });
});
