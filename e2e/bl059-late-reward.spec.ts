// E2E: BL-059 の Q-45（決定 0010 の 5）— 開始の時間切れ（30 秒）の後に遅れて始まり、最後まで見られた広告の報酬は 1 回だけ付く
// - e2e-crazygames のビルドを SDK のモック（adStartDelayMs 31 秒・動画 3 秒）で起動し、R2 のシートの「動画」を押す
// - 30 秒でスピナーが消えて「今は広告を表示できません」→ 31 秒で広告が始まる（ゲームが止まる）→ 見終えたら
//   ブーストが始まり、トースト「動画の報酬」が出て、シートが閉じる。チケットは減らない。遅れた報酬の記録は 1 回
// - 仮想の時計で 35 秒進めるので重い（約 18 秒）。PR の e2e の時間を守るため毎晩に回す（@nightly）。ロジックは L2 の
//   tests/integration/ad-flow.test.ts・crazygames-adapter.test.ts・ui-overlay.test.ts で PR ごとに確かめている
import { test, expect } from './support/fixtures.ts';
import { bootCrazyGames, CG_BASE_URL } from './support/crazygames.ts';

test.use({ baseURL: CG_BASE_URL });

test('Q-45 @nightly 時間切れの後に遅れて始まり最後まで見た広告の報酬が 1 回付き、トーストで知らせ、シートが閉じる', async ({ page, harness }) => {
  test.setTimeout(90_000);
  const g = await bootCrazyGames(page, harness, {
    viewport: { width: 390, height: 844 },
    mock: { environment: 'crazygames', locale: 'en-US', adBehavior: 'finish', adStartDelayMs: 31_000, adDurationMs: 3_000 },
  });
  await page.clock.runFor(500);
  const tickets = (await g.getState()).meta.tickets;
  await page.getByTestId('btn-boost').click();
  await page.getByTestId('sheet-video').click();
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('sheet-video')).toHaveAttribute('data-state', 'loading');
  await page.clock.runFor(28_500); // 開始の時間切れ（30 秒）
  await expect(page.getByTestId('ad-unavailable')).toBeVisible();
  await expect(page.getByTestId('sheet-video')).not.toHaveAttribute('data-state', 'loading');
  await expect(page.getByTestId('btn-boost')).toHaveAttribute('data-state', 'ready'); // 時間切れの時点では報酬なし
  await page.clock.runFor(1_500); // 31 秒で遅れて始まる
  const playedMs = (await g.getState()).clock.playedMs;
  await page.clock.runFor(1_000);
  expect((await g.getState()).clock.playedMs, '広告の最中はループが止まる').toBe(playedMs);
  await page.clock.runFor(2_500); // 最後まで見る
  await expect(page.getByTestId('toast')).toHaveAttribute('data-kind', 'ad');
  await expect(page.getByTestId('sheet-reward')).toHaveCount(0);
  await expect(page.getByTestId('btn-boost')).toHaveAttribute('data-state', 'active');
  expect((await g.getState()).meta.tickets, 'チケットは減らない').toBe(tickets);
  expect((await g.calls()).filter((c) => c.name === 'lateReward')).toEqual([{ name: 'lateReward', arg: 'R2' }]);
});
