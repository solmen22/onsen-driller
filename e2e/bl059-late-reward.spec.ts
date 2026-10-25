// E2E: BL-059 の Q-45（決定 0010 の 5）— 開始の時間切れ（30 秒）の後に遅れて始まり、最後まで見られた広告の報酬は 1 回だけ付く
// - e2e-crazygames のビルドを SDK のモック（adStartDelayMs 31 秒・動画 3 秒）で起動し、R2 のシートの「動画」を押す
// - 待つ間は「Loading the ad…」（決定 0010 の 7）。30 秒でスピナーと案内が消えて「今は広告を表示できません」→ 31 秒で広告が始まる（ゲームが止まる）→ 見終えたら
//   ブーストが始まり、トースト「動画の報酬」が出て、シートが閉じる。チケットは減らない。遅れた報酬の記録は 1 回
// - 決定 0010 の 11: 時間切れの後にチケットでブーストを使ってから遅れた広告を見終えたら、払った 1 枚が戻る（返却。QA §1-6 の ①）
// - 仮想の時計で 35 秒進めるので重い（約 18 秒）。PR の e2e の時間を守るため毎晩に回す（@nightly）。ロジックは L2 の
//   tests/integration/ad-flow.test.ts・crazygames-adapter.test.ts・ui-overlay.test.ts で PR ごとに確かめている
import { test, expect } from './support/fixtures.ts';
import { bootCrazyGames, CG_BASE_URL } from './support/crazygames.ts';

test.use({ baseURL: CG_BASE_URL });

/**
 * 手元の Windows の Playwright の WebKit（webkit・mobile-safari）では対象外にする。仮想の時計を進める間の描画がとても重く、
 * 1 秒の仮想の時間に約 3 秒かかり（webkit）、mobile-safari は 180 秒でも終わらなかった（2026-10-26 に確認。待ちの期待どおりに
 * 30 秒で ad-unavailable は出ている）。CI の毎晩（Linux）の webkit・mobile-safari では 54〜59.6 秒で通るので、そちらで見る
 */
const skipIfWebKitOnWindows = (browserName: string): void =>
  test.skip(process.platform === 'win32' && browserName === 'webkit', '手元の Windows の WebKit は描画が重く、仮想の時計 35 秒が上限に収まらない（CI の毎晩で見る）');

test('Q-45 @nightly 時間切れの後に遅れて始まり最後まで見た広告の報酬が 1 回付き、トーストで知らせ、シートが閉じる', async ({ page, harness, browserName }) => {
  skipIfWebKitOnWindows(browserName);
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
  // 待ちの案内（決定 0010 の 7）: 広告が始まるまで「広告を読み込んでいます…」を出し、時間切れで消える
  await expect(page.getByTestId('ad-loading')).toHaveText('Loading the ad…');
  await expect(page.getByTestId('ad-loading')).toHaveAttribute('role', 'status');
  await page.clock.runFor(28_500); // 開始の時間切れ（30 秒）
  await expect(page.getByTestId('ad-unavailable')).toBeVisible();
  await expect(page.getByTestId('ad-loading')).toHaveCount(0);
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

test('決定 0010 の 11 @nightly 時間切れの後にチケットでブーストを使い、遅れた広告を見終えたら、払ったチケットが 1 枚戻る（ブーストは 1 回のまま）', async ({ page, harness, browserName }) => {
  skipIfWebKitOnWindows(browserName);
  test.setTimeout(90_000);
  const g = await bootCrazyGames(page, harness, {
    viewport: { width: 390, height: 844 },
    mock: { environment: 'crazygames', locale: 'ja-JP', adBehavior: 'finish', adStartDelayMs: 31_000, adDurationMs: 3_000 },
  });
  await page.clock.runFor(500);
  const tickets = (await g.getState()).meta.tickets ?? 0;
  expect(tickets).toBeGreaterThan(0);
  await page.getByTestId('btn-boost').click();
  await page.getByTestId('sheet-video').click();
  await page.clock.runFor(30_500); // 開始の時間切れ（30 秒）
  await expect(page.getByTestId('ad-unavailable')).toBeVisible();
  await page.getByTestId('sheet-ticket').click(); // 待てずにチケットで使う
  await expect(page.getByTestId('btn-boost')).toHaveAttribute('data-state', 'active');
  expect((await g.getState()).meta.tickets).toBe(tickets - 1);
  const readyAt = (await g.getState()).run.boost?.readyAtWallMs;
  expect(readyAt).toBeGreaterThan(0);
  await page.clock.runFor(4_000); // 31 秒で遅れて始まり、34 秒で見終える
  await expect(page.getByTestId('toast')).toHaveText('動画の報酬：使った温泉チケットを 1 枚返しました');
  expect((await g.getState()).meta.tickets, '払った 1 枚が戻る（差し引き 0）').toBe(tickets);
  expect((await g.getState()).run.boost?.readyAtWallMs, 'ブーストを二重に掛けない・休みを延ばさない').toBe(readyAt);
});
