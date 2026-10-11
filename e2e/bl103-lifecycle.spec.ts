// BL-103: TS-056-11（BL-056_platform-lifecycle.md）。main.ts の結線（visibilitychange・幕間・広告の onPlaying → lifecycle の setPaused）の見張り。
// 状態機械そのものは tests/unit/lifecycle.test.ts（TS-056-07・08）。ここでは 3 か所の結線が 1 行でも落ちたら赤になることを見る
// （PR #16 のレビュー S-4 の案 (b)。手元の一時 e2e R1〜R3 の形）。e2e-web（dev の Platform。偽の広告は 800ms）。
import { test, expect } from './support/fixtures.ts';
import { bootGame, centerOf, setHidden } from './support/boot.ts';
import { needs } from './support/gaps.ts';
import type { Hooks } from './support/hooks.ts';

/** gameplayStart・gameplayStop だけを順番どおりに */
const gameplayCalls = async (g: Hooks): Promise<string[]> =>
  (await g.calls()).map((c) => c.name).filter((n) => n === 'gameplayStart' || n === 'gameplayStop');

test.describe('BL-103 ライフサイクルの結線（BL-056）', () => {
  test('TS-056-11 非表示・幕間・広告のそれぞれで gameplayStop、終わると gameplayStart（main.ts の 3 か所の結線）', async ({ page }) => {
    needs('hook:rect');
    const g = await bootGame(page);
    const c = centerOf((await g.rect('drill'))!);
    await page.mouse.click(c.x, c.y);
    expect(await gameplayCalls(g), '最初の入力で gameplayStart').toEqual(['gameplayStart']);

    // 1. 非表示 → 表示（visibilitychange）。表示に戻った時点で、次の入力を待たずに start（Q-35 (a)）
    await setHidden(page, true);
    expect(await gameplayCalls(g), '非表示で stop').toEqual(['gameplayStart', 'gameplayStop']);
    await setHidden(page, false);
    expect(await gameplayCalls(g), '表示に戻って start（入力なし）').toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);

    // 2. 幕間（29m → 30m。interludeMs > 0 の間 stop、終わって start。通知の粒度で最大 0.2 秒遅れてよい）
    await g.grant({ depth: 29 });
    let s = await g.getState();
    for (let i = 0; i < 200 && Number(s.run.interludeMs ?? 0) <= 0; i++) {
      await g.advance(250, { tapsPerSec: 8 });
      s = await g.getState();
    }
    expect(Number(s.run.interludeMs), '30m で幕間に入った').toBeGreaterThan(0);
    await page.clock.runFor(250);
    expect((await gameplayCalls(g)).slice(3), '幕間の始まりで stop').toEqual(['gameplayStop']);
    await g.advance(1600);
    await page.clock.runFor(250);
    expect(Number((await g.getState()).run.interludeMs)).toBe(0);
    expect((await gameplayCalls(g)).slice(3), '幕間の終わりで start').toEqual(['gameplayStop', 'gameplayStart']);

    // 3. 広告（dev の偽の広告。onPlaying(true) の間 stop、終わって start）
    await page.evaluate(() => {
      const w = window as unknown as { __game: { platform: { showRewarded: (p: string) => Promise<unknown> } } };
      void w.__game.platform.showRewarded('R2');
    });
    await expect(page.getByTestId('fake-ad')).toBeVisible();
    expect((await gameplayCalls(g)).slice(5), '広告の間 stop').toEqual(['gameplayStop']);
    await page.clock.runFor(900);
    await expect(page.getByTestId('fake-ad')).toHaveCount(0);
    expect((await gameplayCalls(g)).slice(5), '広告の後に start').toEqual(['gameplayStop', 'gameplayStart']);
  });
});
