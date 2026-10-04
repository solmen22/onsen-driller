// 共通の検査が付かなかったテストを、実行の終わりに見つけて実行を失敗にするレポーター（BL-108。PR #12 のレビューの S-1 の案 B。CEO 決定）。
//
// fixtures.ts の harness（auto）は、後片付けで共通の検査（TS-COM-01〜04）を行うたびに、テストに注記 COMMON_CHECKS_MARK を付ける。
// このレポーターは「結果が期待どおり（合格、または test.fail の期待どおりの失敗）なのに、その結果に印がないテスト」を名前つきで出し、
// onEnd で実行を failed にする（終了コード 1）。lint（eslint.config.js）が止められない形もまとめて見つかる:
//   - support の中で @playwright/test の素の test から base.extend で作った fixture を spec が使う
//   - @playwright/test の _baseTest・動的 import・.cjs の require で素の test を使う
//   - 後片付けの共通の検査を、ファイル・project・タグで絞る（絞られたテストに印が付かない）
// 対象外:
//   - skipped の結果（later()・needs()・test.fixme・test.skip。本体が動いていないか、途中で止めたもの）
//   - 期待どおりでない結果（失敗・タイムアウト・中断）。実行はすでに赤で、再実行の 1 回目の失敗で印がなくても flaky を赤にしない
//   - PoC の道具の project（poc-tools。PW_POC=1 のときだけ定義され、共通の検査の対象外）
// 注意: CLI で --reporter を渡すと playwright.config.ts の reporter が置き換わり、この見張りも外れる（CI・package.json のスクリプトは渡さない）。
// 手元で一覧の形を変えたいときは --reporter=line,./e2e/support/common-checks-reporter.ts のように並べる
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** 後片付けの共通の検査を行ったテストに付ける注記の type（fixtures.ts が付ける） */
export const COMMON_CHECKS_MARK = 'common-checks';

/** 共通の検査の対象外の project */
const EXEMPT_PROJECTS: ReadonlySet<string> = new Set(['poc-tools']);

export default class CommonChecksReporter implements Reporter {
  private readonly missing: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'skipped' || result.status !== test.expectedStatus) return;
    const project = test.parent.project()?.name ?? '';
    if (EXEMPT_PROJECTS.has(project)) return;
    if (result.annotations.some((a) => a.type === COMMON_CHECKS_MARK)) return;
    const where = `${test.location.file.replace(/\\/g, '/').replace(/^.*\/e2e\//, 'e2e/')}:${test.location.line}`;
    this.missing.push(`[${project}] ${test.titlePath().filter(Boolean).slice(2).join(' › ')}（${where}${result.retry > 0 ? `・再実行 ${result.retry}` : ''}）`);
  }

  onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    if (this.missing.length === 0) return Promise.resolve(undefined);
    console.error(
      [
        '',
        `共通の検査（TS-COM-01〜04）の印 '${COMMON_CHECKS_MARK}' がないテストが ${this.missing.length} 件あります（BL-108）。`,
        "e2e/support/fixtures.ts の test を使っているか（素の @playwright/test の test・_baseTest・それで作った fixture を使っていないか）、",
        '後片付けの共通の検査を一部のテストに絞っていないかを確かめてください:',
        ...this.missing.map((m) => `  - ${m}`),
        '',
      ].join('\n'),
    );
    return Promise.resolve({ status: 'failed' });
  }

  printsToStdio(): boolean {
    return false;
  }
}
