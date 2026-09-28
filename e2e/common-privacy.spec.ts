// 共通の検査（e2e_common_privacy-checks.md）。
// TS-COM-01〜04 はすべての E2E の終わりに harness（e2e/support/fixtures.ts）が自動で行う。
// このファイルでは、代表の遊び方の後に同じ検査を目に見える形で行い、検査そのものが効くこと（偽の緑でないこと。TS-COM-08）を確かめる。
// PR: TS-COM-01〜04・08（S1）。毎晩: TS-COM-05（BL-089）。保留: TS-COM-07・09（S4）。
// 欠番: TS-COM-06（BL-007 の TS-007-10 の静的検査に統合）、TS-073-08（TS-COM-08 に統合）。
import { test, expect, ExpectedViolationMissingError } from './support/fixtures.ts';
import { bootGame, reloadGame, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later } from './support/gaps.ts';
import { CommonCheckError, localStorageKeys, NET_JOURNAL_KEY } from './support/privacy.ts';

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

// (a)(b)(c) は、テストの終わりの共通の検査（harness の後片付け。すべての E2E と同じ経路）が、指定した ID の違反を検出したときだけ通る
// （test.use の expectViolations。検出されなければ「期待した違反が検出されなかった」で失敗し、ほかの ID の違反や、
// 本体の別の例外でも失敗する。以前の test.fail は理由を問わず「期待どおりの失敗」にしていた。PR #4 のレビュー S-1）
test.describe('TS-COM-08 偽の緑を防ぐ自己テスト（共通の検査が違反を検出することの確認）', () => {
  test.describe('(a)', () => {
    test.use({ expectViolations: ['TS-COM-01'] });
    test('TS-COM-08 (a) 外部への fetch を入れると、テストの終わりの検査が TS-COM-01 の違反を検出する', async ({ page }) => {
      await bootGame(page);
      await page.evaluate(() => fetch('https://example.com/x').catch(() => {}));
    });
  });

  test.describe('(b)', () => {
    test.use({ expectViolations: ['TS-COM-02'] });
    test('TS-COM-08 (b) 外部への WebSocket を開くと、テストの終わりの検査が TS-COM-02 の違反を検出する', async ({ page }) => {
      await bootGame(page);
      await page.evaluate(() => {
        new WebSocket('wss://example.com/ws');
      });
    });
  });

  test.describe('(c)', () => {
    test.use({ expectViolations: ['TS-COM-01', 'TS-COM-02'] });
    test('TS-COM-08 (c) ページを離れるとき（pagehide）のビーコン・keepalive の fetch・画像を外部へ送って再読み込みすると、テストの終わりの検査が検出する（M-1）', async ({ page, harness }) => {
      // pagehide の送信は context.on('request')・context.route に来ない（レビュー M-1 の P3a）。ページの記録（sessionStorage）で拾う
      await bootGame(page);
      await page.evaluate(() => {
        addEventListener('pagehide', () => {
          navigator.sendBeacon('https://example.com/unload-beacon', 'x');
          void fetch('https://example.com/unload-keepalive', { method: 'POST', body: 'x', keepalive: true }).catch(() => {});
          new Image().src = 'https://example.com/unload-image.png';
        });
      });
      await reloadGame(page);
      const v = await harness.violations();
      // 3 つとも、送り先と種類まで正しく数えている（テストの終わりの検査はこれと同じ関数）
      expect(v).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('https://example.com/unload-beacon') }),
          expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/unload-keepalive') }),
          expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/unload-image.png') }),
        ]),
      );
      // 記録のキーは sessionStorage の onsen-driller: の接頭辞（localStorage には書かないので TS-COM-04 と矛盾しない）
      expect(await page.evaluate(() => Object.keys(sessionStorage))).toContain(NET_JOURNAL_KEY);
      expect((await localStorageKeys(page.context())).map((k) => k.name).filter((k) => k === NET_JOURNAL_KEY)).toEqual([]);
    });
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
    // expectViolations（S-1）: 期待した ID のほかに違反があれば失敗する（TS-COM-02〜04 が残っている）
    await expect(harness.assertCommonChecks(['TS-COM-01'])).rejects.toThrow(CommonCheckError);
    await harness.release(ctx);
    await expect(harness.assertCommonChecks()).resolves.toBeUndefined();
    // expectViolations（S-1）: 期待した違反が検出されなければ失敗する（違反 0 件の context で TS-COM-01 を期待する）
    await expect(harness.assertCommonChecks(['TS-COM-01'])).rejects.toThrow(ExpectedViolationMissingError);
  });
});
