// E2E: BL-072 CrazyGames SDK のモックの L3（BL-072_sdk-mock-contract.md の TS-072-03・04、BL-057_crazygames-adapter.md の TS-057-19）。
// e2e-crazygames のビルド（dist/e2e-crazygames）を CG_BASE_URL で開き、SDK の script を page.route でモックに差し替える（e2e/support/crazygames.ts）。
// E2E の流れ（TS-E1-16・TS-E5-14・TS-E9-12）はこの仕組みを使って BL-074・BL-103 で足す。
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame, tapUnderground, triggerAutosave } from './support/boot.ts';
import { bootCrazyGames, CG_BASE_URL, CG_SDK_URL, cgMockState } from './support/crazygames.ts';
import { CG_MOCK_GLOBAL } from './mocks/crazygames.ts';
import { localStorageKeys } from './support/privacy.ts';

test.use({ baseURL: CG_BASE_URL });

test.describe('BL-072 CrazyGames SDK のモック（L3）', () => {
  test('TS-072-03 モックで起動し、呼び出しの記録をページから読め、保存は data モジュールに入る（本物の SDK に通信しない）', async ({ page, harness }) => {
    const g = await bootCrazyGames(page, harness);
    expect(await g.target()).toBe('crazygames');
    await g.pause();
    const boot = await cgMockState(page);
    test.info().annotations.push({ type: '起動の後のモックの記録', description: boot.log.join(' → ') });
    expect(boot.log[0], 'init が最初').toBe('init');
    expect(boot.log).toContain('loadingStop');
    expect(boot.log, '入力の前は gameplayStart がない').not.toContain('gameplayStart');
    // 最初の入力で gameplayStart（main.ts。Poki と同じ規則）
    await tapUnderground(page, 1);
    expect((await cgMockState(page)).log.filter((c) => c === 'gameplayStart')).toHaveLength(1);
    // 15 秒ごとの保存は data モジュールへ（localStorage にセーブのキーを書かない。TS-057-08 の L3 の代表）
    await triggerAutosave(page);
    const after = await cgMockState(page);
    expect(Object.keys(after.store)).toContain('onsen-driller:save:a');
    expect(after.calls).toContain('data.setItem:onsen-driller:save:a');
    expect((await localStorageKeys(page.context())).map((k) => k.name).filter((k) => k.startsWith('onsen-driller:save:'))).toEqual([]);
    // 本物の SDK には通信していない: SDK の要求はモックが答えたものだけ
    expect([...harness.mockedUrls]).toEqual([CG_SDK_URL]);
  });

  test('TS-072-03 モックの設定をテストから切り替えられる（environment=disabled・locale=en-US）', async ({ page, harness }) => {
    const g = await bootCrazyGames(page, harness, { mock: { environment: 'disabled', locale: 'en-US' } });
    await tapUnderground(page, 2);
    await g.pause();
    await triggerAutosave(page);
    const st = await cgMockState(page);
    // disabled（CrazyGames 以外のドメイン）: init 以外に SDK を一度も呼ばず、保存は localStorage（TS-057-03 の L3 の代表）
    expect(st.calls).toEqual(['init']);
    expect((await localStorageKeys(page.context())).map((k) => k.name)).toContain('onsen-driller:save:a');
    // locale は SDK を使わないので、ブラウザ（en-US）の英語
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  });

  test('TS-072-03 locale=ja-JP のモックでは日本語で起動する（TS-057-07 の L3 の代表）', async ({ page, harness }) => {
    await bootCrazyGames(page, harness, { mock: { locale: 'ja-JP' } });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja');
  });

  test('TS-057-19 e2e-crazygames の代表の遊び方の後、外部への要求はモックの SDK だけで、Cookie 0・キーは onsen-driller: だけ', async ({ page, harness }) => {
    await bootCrazyGames(page, harness);
    await tapUnderground(page, 12);
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.clock.runFor(200);
    }
    await triggerAutosave(page);
    await reloadGame(page);
    await page.clock.runFor(1_000);
    const monitor = harness.monitorOf(page.context());
    const external = monitor.requests.map((r) => r.url).filter((u) => new URL(u).origin !== harness.origin && !u.startsWith('data:') && !u.startsWith('blob:'));
    test.info().annotations.push({ type: '同一オリジン以外の要求', description: [...new Set(external)].join(' / ') || 'なし' });
    expect([...new Set(external)], '同一オリジン以外はモックの SDK だけ（再読み込みの分も）').toEqual([CG_SDK_URL]);
    expect(await harness.violations(), '共通の検査（テストの終わりにも同じ検査が走る）').toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe('');
  });
});

test.describe('BL-072 差し替えを忘れたとき（TS-072-04）', () => {
  // テストの終わりの共通の検査が TS-COM-01 を検出したときだけ通る（TS-COM-08 と同じ形。検出されなければ失敗）
  test.use({ expectViolations: ['TS-COM-01'] });

  test('TS-072-04 SDK の差し替えなしで e2e-crazygames を開くと、本物の SDK へは通信せず（中止）、共通の検査が TS-COM-01 で検出する', async ({ page, harness }) => {
    await bootGame(page); // bootCrazyGames を使わない（差し替えを忘れた形）
    expect(await page.evaluate((k) => typeof (window as unknown as Record<string, unknown>)[k], CG_MOCK_GLOBAL), 'モックは入っていない').toBe('undefined');
    const monitor = harness.monitorOf(page.context());
    expect(monitor.blocked, 'SDK の要求は harness が中止した（外に出ていない）').toContain(CG_SDK_URL);
    expect(harness.mockedUrls.size).toBe(0);
    const v = await harness.violations();
    expect(v).toEqual([expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining(CG_SDK_URL) })]);
  });
});
