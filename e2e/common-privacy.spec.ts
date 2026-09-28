// 共通の検査（e2e_common_privacy-checks.md）。
// TS-COM-01〜04 はすべての E2E の終わりに harness（e2e/support/fixtures.ts）が自動で行う。
// このファイルでは、代表の遊び方の後に同じ検査を目に見える形で行い、検査そのものが効くこと（偽の緑でないこと。TS-COM-08）を確かめる。
// PR: TS-COM-01〜04・08（S1）。毎晩: TS-COM-05（BL-089）。保留: TS-COM-07・09（S4）。
// 欠番: TS-COM-06（BL-007 の TS-007-10 の静的検査に統合）、TS-073-08（TS-COM-08 に統合）。
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later } from './support/gaps.ts';
import { CommonCheckError } from './support/privacy.ts';

/** 代表の遊び方: 叩く → タブを一巡 → 自動保存 → 再読み込み（画面の操作だけ。フックの不足に左右されない） */
async function playTypicalSession(page: import('@playwright/test').Page): Promise<void> {
  await bootGame(page);
  await tapUnderground(page, 12);
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    await page.clock.runFor(200);
  }
  await triggerAutosave(page);
  await reloadGame(page);
  await page.clock.runFor(1_000);
}

test.describe('共通の検査（通信・Cookie・キー名）', () => {
  test('TS-COM-01〜04 代表の遊び方の後、許可リスト外の通信・WebSocket・Cookie・接頭辞のないキーがない', async ({ page, harness }) => {
    await playTypicalSession(page);
    const v = await harness.violations();
    // 検査ごとに分けて見せる（失敗したときにどれか分かるように）
    expect(v.filter((x) => x.check === 'TS-COM-01'), 'TS-COM-01 許可リスト外への通信').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-02'), 'TS-COM-02 WebSocket・ビーコン').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-03'), 'TS-COM-03 Cookie').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-04'), 'TS-COM-04 キー名').toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // 同一オリジンへの要求は記録されている（何も記録していないことによる偽の緑でない）
    expect(harness.monitorOf(page.context()).requests.some((r) => r.url.startsWith(harness.origin))).toBe(true);
  });

  test('TS-COM-05 sessionStorage・IndexedDB・Cache Storage に保存先を増やしていない【提案】 @nightly', async ({ page }) => {
    await playTypicalSession(page);
    const r = await page.evaluate(async () => ({
      session: Object.keys(sessionStorage),
      idb: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name ?? '') : [],
      caches: typeof caches === 'undefined' ? [] : await caches.keys(),
    }));
    expect(r.session.filter((k) => !k.startsWith('onsen-driller:'))).toEqual([]);
    expect(r.idb).toEqual([]);
    expect(r.caches).toEqual([]);
  });

  test('TS-COM-07 外部へのリンクはプライバシーポリシーだけ', () => {
    later('S4:externalLinks');
  });

  test('TS-COM-09 本番スモークで通信・Cookie を検査する', () => {
    later('S4:smoke');
  });
});

test.describe('TS-COM-08 偽の緑を防ぐ自己テスト（「失敗するのが正しい」テスト）', () => {
  test('TS-COM-08 (a) 外部への fetch を入れると、テストの終わりの検査（TS-COM-01）で失敗する', async ({ page }) => {
    test.fail(true, 'TS-COM-08 (a): 許可リスト外への通信を入れたので、テストの終わりの共通の検査（TS-COM-01）で失敗するのが正しい');
    await bootGame(page);
    await page.evaluate(() => fetch('https://example.com/x').catch(() => {}));
    // 本体の中ではほかに失敗の原因を作らない（失敗の理由がテストの終わりの検査だけになるように）
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });

  test('TS-COM-08 (b) 外部への WebSocket を開くと、テストの終わりの検査（TS-COM-02）で失敗する', async ({ page }) => {
    test.fail(true, 'TS-COM-08 (b): WebSocket を開いたので、テストの終わりの共通の検査（TS-COM-02）で失敗するのが正しい');
    await bootGame(page);
    await page.evaluate(() => {
      new WebSocket('wss://example.com/ws');
    });
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });

  test('TS-COM-08 補助: 失敗の中身が正しい（どの検査が、どの要求・値で違反としたか）', async ({ harness }) => {
    // (a)・(b) は「失敗した」ことしか分からないので、同じ検査の関数で違反の中身まで確かめる。
    // わざと違反を起こす context は、確かめた後にテストの終わりの検査から外す
    const ctx = await harness.newContext();
    const page = await ctx.newPage();
    await bootGame(page);
    await page.evaluate(async () => {
      await fetch('https://example.com/x').catch(() => {});
      new WebSocket('wss://example.com/ws');
      navigator.sendBeacon('https://example.com/beacon', 'x');
      document.cookie = 'e2e=1';
      localStorage.setItem('no-prefix-key', '1');
    });
    const monitor = harness.monitorOf(ctx);
    await expect.poll(async () => (await monitor.violations()).length).toBeGreaterThanOrEqual(5);
    expect(await monitor.violations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/x') }),
        expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('wss://example.com/ws') }),
        expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('https://example.com/beacon') }),
        expect.objectContaining({ check: 'TS-COM-03', detail: expect.stringContaining('e2e') }),
        expect.objectContaining({ check: 'TS-COM-04', detail: expect.stringContaining('no-prefix-key') }),
      ]),
    );
    // テストの終わりに使う関数と同じもので失敗になる
    await expect(harness.assertCommonChecks()).rejects.toThrow(CommonCheckError);
    await harness.release(ctx);
    await expect(harness.assertCommonChecks()).resolves.toBeUndefined();
  });
});
