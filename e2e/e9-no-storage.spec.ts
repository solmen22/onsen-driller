// E2E E9 保存できない環境（e2e_E9_no-storage.md）
// PR: TS-E9-01〜04（V1）、TS-E9-07（V2 で 01〜04）、TS-E9-08（V3 で 01〜04）、TS-E9-10（V5）、TS-E9-13（キーが 0 個）。
// 毎晩: TS-E9-05・06・09（BL-089）。保留: TS-E9-11（S3）、TS-E9-12（S2）。
// 保存できない状態は context.addInitScript でページのスクリプトより先に入れる（e2e/support/storage.ts の V1〜V5）。
// 文言は S1 では data-testid（save-warning）で存在だけを見る。文言の一致は S2（BL-052）から。
// 技術リードの回答 Q-11 の 5（traceability.md §5-2）: 状態は ok・failing・unavailable。unavailable は起動直後、failing は最初の失敗で出し、
// ok 以外の間は出したまま（15 秒ごとに出し直さない。TS-E9-05）。読み戻しの不一致も「保存できない」に含める（TS-E9-09）。
// TS-E9-03 の判定は回答どおり「遅くとも最初の保存（15 秒）の後には出ている」。
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { BOOT_TIMEOUT_MS, bootGame, centerOf, pageNow, reloadGame, T0, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later, needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks } from './support/hooks.ts';
import { localStorageKeys } from './support/privacy.ts';
import { injectStorageFault, readSlots, reopenWithStorage, STORAGE_FAULTS, type StorageFault } from './support/storage.ts';

const warning = (page: Page) => page.getByTestId('save-warning');

/** 画面の操作でツルハシの代金をため、ツルハシを買って自動掘りをオンにする（E9 の「自動掘りオン」の準備） */
async function autoDigOn(page: Page, g: Hooks): Promise<void> {
  for (let i = 0; i < 80 && coinsOf(await g.getState()) < 3; i++) await tapUnderground(page, 1);
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  await g.dispatch({ type: 'setAutoDig', on: true });
  expect((await g.getState()).run.autoDig.on).toBe(true);
}

/** V1〜V3: ストレージにキーが 1 つも書かれていない（TS-E9-07・13） */
async function expectNoKeys(page: Page): Promise<void> {
  expect(await localStorageKeys(page.context())).toEqual([]);
}

/** TS-E9-01〜04 と同じ操作を、保存できない型ごとに流す（V1 は 01〜04、V2 は 07、V3 は 08） */
function noStorageSuite(v: StorageFault, id: (n: string) => string): void {
  test.describe(`${v}: ${STORAGE_FAULTS[v]}`, () => {
    test.beforeEach(async ({ context }) => {
      await injectStorageFault(context, v);
    });

    test(`${id('01')} 何もしないで待つと 10 秒以内にゲーム画面が出る（保存できなくても起動を止めない）`, async ({ page, harness }) => {
      await page.clock.install({ time: T0 });
      const started = Date.now();
      await page.goto('/');
      try {
        await expect(page.locator('[data-testid="stage"] canvas')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
        await expect(page.getByTestId('hud-coins')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
      } catch (e) {
        throw new Error(`ゲーム画面が出ませんでした（ページの例外: ${harness.pageErrors.join(' / ') || 'なし'}）`, { cause: e });
      }
      expect(Date.now() - started).toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
      expect(harness.pageErrors).toEqual([]);
      await expectNoKeys(page);
    });

    test(`${id('02')} 道具を叩く・長押し 2 秒で打撃が入り、コインが増える`, async ({ page }) => {
      needs('hook:rect');
      const g = await bootGame(page);
      await g.resume();
      const c = centerOf((await g.rect('drill'))!);
      const s0 = await g.getState();
      await page.mouse.click(c.x, c.y);
      await page.clock.runFor(200);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.clock.runFor(2_000);
      await page.mouse.up();
      const s1 = await g.getState();
      expect(hitsOf(s1)).toBeGreaterThan(hitsOf(s0));
      expect(coinsOf(s1)).toBeGreaterThan(coinsOf(s0));
      await expectNoKeys(page);
    });

    test(`${id('03')} 遅くとも最初の保存（15 秒）の後には「保存できません」が見える`, async ({ page }) => {
      needs('feature:saveWarning');
      await bootGame(page);
      await triggerAutosave(page);
      await expect(warning(page)).toBeVisible();
      await expectNoKeys(page);
    });

    test(`${id('04')} 自動掘りで 60 秒（自動保存 4 回）動かしても、打撃・コインが増え続け、捕まえていない例外がない`, async ({ page, harness }) => {
      const g = await bootGame(page);
      await autoDigOn(page, g);
      const s0 = await g.getState();
      // runFor(60000) は実時間で約 80 秒かかるので、15 秒ごとの保存（失敗する）を 4 回起こし、そのたびにループを 1 秒回して
      // 打撃が増え続けることを確かめる（時計は合計 64 秒進む。PR の 10 分の予算のため。期待は変えない）
      let prev = s0;
      for (let i = 1; i <= 4; i++) {
        await triggerAutosave(page);
        await page.clock.runFor(1_000);
        const s = await g.getState();
        expect(hitsOf(s), `${i} 回目の保存（失敗）の後もループが回る`).toBeGreaterThan(hitsOf(prev));
        prev = s;
      }
      test.info().annotations.push({ type: '打撃の増分（4 回の保存の間）', description: String(hitsOf(prev) - hitsOf(s0)) });
      expect(coinsOf(prev)).toBeGreaterThan(coinsOf(s0));
      expect(harness.pageErrors).toEqual([]);
      await expectNoKeys(page);
    });
  });
}

test.describe('E9 保存できない環境', () => {
  noStorageSuite('V1', (n) => `TS-E9-${n}`);
  noStorageSuite('V2', (n) => `TS-E9-07（TS-E9-${n} の操作）`);
  noStorageSuite('V3', (n) => `TS-E9-08（TS-E9-${n} の操作）`);

  test.describe('V1 の続き @nightly', () => {
    test.beforeEach(async ({ context }) => {
      await injectStorageFault(context, 'V1');
    });

    test('TS-E9-05 60 秒（自動保存 4 回）の間、案内は出したままで出し直さない（出た回数 1。Q-11） @nightly', async ({ page }) => {
      // Q-11 の 5: S1 の仮の表示（save-warning）は、状態が ok 以外の間ずっと出したままにし、15 秒ごとに出し直さない。
      // unavailable（起動時からメモリだけ）はそのセッションでは再試行しない。S2 のトースト（BL-046）の回数は BL-046 で見直す
      needs('feature:saveWarning');
      await bootGame(page);
      await page.evaluate(() => {
        const w = window as unknown as { __warnShown: number };
        const shown = (): boolean => {
          const el = document.querySelector('[data-testid="save-warning"]');
          return !!el && (el as HTMLElement).offsetParent !== null;
        };
        // 見張りを付けた時点で出ていれば 1 回と数える（起動直後に出す実装でも、最初の保存で出す実装でも同じに数える）
        let visible = shown();
        w.__warnShown = visible ? 1 : 0;
        new MutationObserver(() => {
          const now = shown();
          if (now && !visible) w.__warnShown++;
          visible = now;
        }).observe(document.body, { subtree: true, childList: true, attributes: true });
      });
      for (let i = 0; i < 4; i++) {
        await triggerAutosave(page);
        await page.clock.runFor(1_000);
      }
      const n = await page.evaluate(() => (window as unknown as { __warnShown: number }).__warnShown);
      test.info().annotations.push({ type: '60 秒で案内が出た回数', description: String(n) });
      await expect(warning(page)).toBeVisible();
      expect(n).toBe(1);
    });

    test('TS-E9-06 60 秒遊んだ後の再読み込みは新しいゲーム（チケット 2・コイン 0）で、案内がもう一度出る @nightly', async ({ page }) => {
      needs('feature:saveWarning', 'feature:tickets');
      const g = await bootGame(page);
      await autoDigOn(page, g);
      for (let i = 0; i < 4; i++) await triggerAutosave(page);
      const g2 = await reloadGame(page);
      const s = await g2.getState();
      expect(coinsOf(s)).toBe(0);
      expect(s.meta.tickets).toBe(2);
      await triggerAutosave(page);
      await expect(warning(page)).toBeVisible();
    });
  });

  test('TS-E9-09 V4（書き込みが捨てられる）でも案内が出て、ゲームは続く（Q-11） @nightly', async ({ page, context, harness }) => {
    needs('feature:saveWarning');
    await injectStorageFault(context, 'V4');
    const g = await bootGame(page);
    await triggerAutosave(page);
    await expect(warning(page)).toBeVisible();
    await tapUnderground(page, 3);
    expect(hitsOf(await g.getState())).toBeGreaterThan(0);
    expect(harness.pageErrors).toEqual([]);
  });

  test('TS-E9-10 V5（途中で容量がいっぱい）: 3 回目の保存の失敗で案内が出て、a・b は 2 回目までの中身のまま', async ({ page, context, harness }) => {
    needs('hook:advance.input', 'feature:twoSlotSave', 'feature:saveWarning');
    await injectStorageFault(context, 'V5');
    const g = await bootGame(page);
    await g.pause();
    await g.advance(5_000, { tapsPerSec: 2 });
    await triggerAutosave(page); // 1 回目（成功）
    await g.advance(5_000, { tapsPerSec: 2 });
    await triggerAutosave(page); // 2 回目（成功）
    const second = await g.getState();
    const slots2 = await readSlots(context, harness.origin);
    expect(slots2.a.raw).not.toBeNull();
    expect(slots2.b.raw).not.toBeNull();
    await g.advance(30_000, { tapsPerSec: 2 });
    await triggerAutosave(page); // 3 回目（失敗）
    await expect(warning(page)).toBeVisible();
    // ゲームは続く
    const h0 = hitsOf(await g.getState());
    await g.advance(1_000, { tapsPerSec: 2 });
    expect(hitsOf(await g.getState())).toBeGreaterThan(h0);
    expect(harness.pageErrors).toEqual([]);
    // a・b は 2 回目までの中身のまま
    const slots3 = await readSlots(context, harness.origin);
    expect(slots3.a.raw).toBe(slots2.a.raw);
    expect(slots3.b.raw).toBe(slots2.b.raw);
    // 保存できる新しい context で開くと、2 回目の保存の game が復元される（3 回目以降の進行は失われるのが想定どおり）
    const newer = [slots2.a, slots2.b].sort((x, y) => (y.env?.seq ?? 0) - (x.env?.seq ?? 0))[0]!;
    const reopened = await reopenWithStorage(harness, context, () => {});
    const g2 = await bootGame(reopened.page, { time: newer.env!.savedAt, startPaused: true });
    expect(await g2.getState()).toEqual(second);
    expect(await pageNow(reopened.page)).toBe(newer.env!.savedAt);
  });

  test('TS-E9-11 保存できない環境でも書き出しが使え、普通の環境で読み込める', () => {
    later('S3:export');
  });

  test('TS-E9-12 e2e-crazygames（data モジュールも localStorage も使えない）でメモリに置いて続く', () => {
    later('S2:crazygames');
  });
});

