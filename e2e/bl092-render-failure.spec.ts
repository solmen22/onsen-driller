// E2E: BL-092 描画の起動に失敗しても入力・保存が続く（S1 のレビュー A-N2・S-3）
// - page.route で描画のチャンク（assets/game-*.js）を 404 にして起動する。main.ts は createView の失敗を errors() に残し、
//   HUD・入力・保存を続ける。テスト用フックは仮の view で置かれる（rect は null、renderStats は 0 の値）
// - bootGame はキャンバスを待つので使わない（キャンバスが出ないのが前提）
// - 入力・自動保存の結線が描画の起動より後ろに戻ると、ここが失敗する（受け入れ基準 3。描画の起動を待つ間にタップと保存が起きない）
import { test, expect } from './support/fixtures.ts';
import { readLocalStorage } from './support/storage.ts';

const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

test('BL-092: 描画のチャンクが 404 でも、タップが打撃に数えられ、15 秒で枠が書かれ、errors() に描画の失敗が残る（HUD は出る・pageerror なし）', async ({ harness }) => {
  const page = await harness.newPage({ locale: 'en-US' });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.route('**/assets/game-*.js', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.clock.install({ time: T0 });
  await page.goto('/');
  await page.getByTestId('hud-coins').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof (window as unknown as { __game?: unknown }).__game === 'object', null, { polling: 50 });
  await expect(page.locator('[data-testid="stage"] canvas')).toHaveCount(0);

  type G = {
    getState(): { stats: { hits: number } };
    errors(): string[];
    rect(id: string): unknown;
    renderStats(): { zoom: number; tileSprites: number };
  };
  const hits = (): Promise<number> => page.evaluate(() => (window as unknown as { __game: G }).__game.getState().stats.hits);

  // 仮の view
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.rect('drill'))).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __game: G }).__game.renderStats())).toMatchObject({ zoom: 0, tileSprites: 0 });
  // 描画の起動の失敗が 1 件以上
  expect((await page.evaluate(() => (window as unknown as { __game: G }).__game.errors())).length).toBeGreaterThanOrEqual(1);

  // ステージをタップ → 打撃に数えられる
  const before = await hits();
  await page.getByTestId('stage').click({ position: { x: 20, y: 20 } });
  await page.clock.runFor(300);
  expect(await hits()).toBeGreaterThan(before);

  // 15 秒進める → 自動保存で枠が書かれる
  await page.clock.fastForward(15_500);
  await page.clock.runFor(300);
  const ls = await readLocalStorage(page.context(), harness.origin);
  expect(ls.get('onsen-driller:save:a') ?? ls.get('onsen-driller:save:b'), '枠が書かれる').toBeDefined();
  expect(pageErrors).toEqual([]);
});
