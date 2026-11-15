// BL-023: 伝説の源泉とエンディングのカード（簡易版）。シナリオ org/30_quality/test-designer/scenarios/BL-023_legendary-ending.md の TS-023-19。
// 準備: bootGame → pause → setState（深さ 499m・強いドリル・endingSeen false）。ロジックは advance で進め、UI の更新は page.clock.runFor(250)。
// 配置（TS-023-20: 3 つの大きさ・ja・en）は別の spec（LAYOUT_SPECS）で
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame } from './support/boot.ts';
import type { SerializedState } from './support/hooks.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

type Rec = Record<string, unknown>;
const metaOf = (s: SerializedState): Rec & { endingSeen: boolean } => s.meta as Rec & { endingSeen: boolean };

test.describe('BL-023 エンディング', () => {
  test('TS-023-19 499m から 1 打で 500m: カード（modal-ending）→ 飛ばす → 掘り続けられる。endingSeen が残り、読み直してもカードは出ない', async ({ page }) => {
    const g = await bootGame(page);
    await g.pause();
    const s = await g.getState();
    const run = s.run;
    run.depth = 499;
    run.maxDepth = 499;
    run.drill = { level: 300, tool: 7 };
    run.stratumSeen = [0, 1, 2, 3, 4, 5];
    (s.meta as Rec).yunohana = { lifetime: '1e14', spent: '0e0' }; // 深いブロックも数打で壊せるように（全生産 +2%/個）
    metaOf(s).endingSeen = false;
    (s.stats as Rec).bestDepth = 499;
    await g.setState(s);
    await uiTick(page);
    await expect(page.getByTestId('modal-ending')).toHaveCount(0);

    // 1 打で 500m に届く（強いドリルなので数ブロック進む）
    const ev = await g.advance(500, { tapsPerSec: 2 });
    expect(ev.filter((e) => e.type === 'EndingReached')).toHaveLength(1);
    await uiTick(page);
    const card = page.getByTestId('modal-ending');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('ending-skip')).toBeFocused();
    expect(metaOf(await g.getState()).endingSeen).toBe(true);

    await page.getByTestId('ending-skip').click();
    await uiTick(page);
    await expect(card).toHaveCount(0);
    const before = (await g.getState()).run.depth;
    await g.advance(500, { tapsPerSec: 2 });
    expect((await g.getState()).run.depth).toBeGreaterThan(before);

    // 読み直しても出ない（EndingReached の直後に保存済み。Q-55 (a)）
    const g2 = await reloadGame(page);
    await uiTick(page);
    expect(metaOf(await g2.getState()).endingSeen).toBe(true);
    await expect(page.getByTestId('modal-ending')).toHaveCount(0);
  });
});
