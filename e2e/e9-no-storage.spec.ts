// E2E E9 保存できない環境（e2e_E9_no-storage.md）
// PR: TS-E9-01〜04（V1）、TS-E9-07（V2 で 01〜03。03 に保存のたびの setItem の再試行を含む）、TS-E9-08（V3 で 01〜03 と設定の保存）、
//     TS-E9-10（V5）、TS-E9-13（共通の検査）、TS-E9-14（V6）、TS-E9-15（V7）（S1）。TS-E9-09（V4。S2 の BL-094 で毎晩から PR へ。
//     QA 判定書 sprint-01 §4・決定 0006-5: 気づけないセーブの消失の唯一の守りが案内で、毎晩のジョブは Chromium を流さないため）。
//     S2: TS-046-18（BL-046 の保存のトースト。V5。BL-103）。S2: TS-E9-12（e2e-crazygames。BL-103）。
// 毎晩: TS-E9-05・06（BL-089）。TS-E9-07・08 の 04 の操作（V2・V3 の 60 秒の自動保存。PR の e2e の時間のため。QA の記録は
//     org/30_quality/qa-lead/2026-10-18_e2e-time-trigger.md §3-1 の 1-1・1-2。V1 の 04 は PR に残す）。保留: TS-E9-11（S3）。
// 保存できない状態は context.addInitScript でページのスクリプトより先に入れる（e2e/support/storage.ts の V1〜V7）。
// 文言は S1 では data-testid（save-warning）で存在だけを見る。文言の一致は S2（BL-052）から。
// 技術リードの回答（traceability.md §5-2）に合わせた期待
// - Q-11 の 5: 保存の状態は ok・failing・unavailable（save-warning の data-state）。ok 以外の間は出したまま（15 秒ごとに出し直さない）。
// - Q-21・Q-25（S1 コードレビュー S-2 の CEO 決定を含む）: 規則は「読めるなら localStorage、読めなければメモリ」。
//   V1・V3 は起動直後から unavailable（再試行しない）。V2・V4 は localStorage のまま起動直後から failing（15 秒ごとに再試行し、成功したら ok）。
//   どちらも起動直後（最初の保存の前）に save-warning を出す（TS-E9-03 の CEO 決定。V2・V3・V4 も同じ: TS-E9-07・08・09）。
// - Q-23（S-1）: 読めない枠（getItem が例外）が 1 つでもあれば、そのセッションは unavailable で、どの枠にも書かず・退避もせず・読み直さない（TS-E9-15）。
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { AUTOSAVE_MS, BOOT_TIMEOUT_MS, bootGame, centerOf, pageNow, reloadGame, setHidden, T0, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later, needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks } from './support/hooks.ts';
import { prepareTwoSlots } from './support/prepare.ts';
import { localStorageKeys } from './support/privacy.ts';
import { bootCrazyGames, CG_BASE_URL, cgMockState } from './support/crazygames.ts';
import {
  BROKEN_SLOT_KEY,
  injectStorageFault,
  readLocalStorage,
  readSlots,
  reopenWithStorage,
  saveKeysOf,
  saveSetItemCalls,
  SLOT_KEYS,
  STARTUP_SAVE_STATUS,
  STORAGE_FAULTS,
} from './support/storage.ts';

const warning = (page: Page) => page.getByTestId('save-warning');

/**
 * ツルハシの代金をため、ツルハシを買って自動掘りをオンにし、ループを動かし直す（E9 の「自動掘りオン」の準備。方法はシナリオの指定なし）。
 * ロジックだけを進めるフック（advance）でためる。画面で約 30 回叩くと、GPU のない CI では描画のフレームだけで数十秒かかるため
 */
async function autoDigOn(g: Hooks): Promise<void> {
  await g.pause();
  await g.advance(20_000, { tapsPerSec: 2 });
  expect(coinsOf(await g.getState())).toBeGreaterThanOrEqual(3);
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  await g.dispatch({ type: 'setAutoDig', on: true });
  expect((await g.getState()).run.autoDig.on).toBe(true);
  await g.resume();
}

/** V1〜V4: ストレージにキーが 1 つも書かれていない（TS-E9-07・13） */
async function expectNoKeys(page: Page): Promise<void> {
  expect(await localStorageKeys(page.context())).toEqual([]);
}

/** 起動直後（最初の 15 秒ごとの保存の前）であること。自動保存のタイマーは起動から 15 秒で初めて動く */
async function expectBeforeFirstAutosave(page: Page, bootedAt: number): Promise<void> {
  expect((await pageNow(page)) - bootedAt, '最初の自動保存の前').toBeLessThan(AUTOSAVE_MS);
}

/** 案内が見えていて、保存の状態（data-state）が期待どおり */
async function expectWarning(page: Page, status: 'failing' | 'unavailable'): Promise<void> {
  await expect(warning(page)).toBeVisible();
  await expect(warning(page)).toHaveAttribute('data-state', status);
}

/** TS-E9-01〜04 と同じ操作を、保存できない型ごとに流す（V1 は 01〜04、V2 は 07、V3 は 08） */
function noStorageSuite(v: 'V1' | 'V2' | 'V3', id: (n: string) => string): void {
  const status = STARTUP_SAVE_STATUS[v] as 'failing' | 'unavailable';
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
        throw new Error(`ゲーム画面が出ませんでした（捕まえていない例外: ${(await harness.uncaughtErrors()).join(' / ') || 'なし'}）`, { cause: e });
      }
      expect(Date.now() - started).toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
      expect(await harness.uncaughtErrors()).toEqual([]);
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

    test(`${id('03')} 起動直後（最初の保存の前）から「保存できません」が見え、最初の保存の後も見えたまま（${status}）`, async ({ page }) => {
      // CEO 決定（2026-09-28）・Q-11 の 5・Q-21・Q-25: V1・V3 は unavailable、V2 は failing。どちらも起動直後に出す
      needs('feature:saveWarning');
      await bootGame(page);
      await expectBeforeFirstAutosave(page, T0);
      if (v === 'V2') expect(await saveSetItemCalls(page), '起動直後はまだ枠に書こうとしていない').toBe(0);
      await expectWarning(page, status);
      await triggerAutosave(page); // 最初の保存
      await expectWarning(page, status);
      if (v === 'V2') {
        expect(await saveSetItemCalls(page), '最初の保存で枠への setItem が 1 回試される').toBe(1);
        // TS-E9-07: failing の間も保存のたびに setItem が 1 回ずつ試される（再試行）。04（毎晩）と同じ見張りを PR に残す
        // （QA 判定書 2026-10-18_e2e-time-trigger.md §3-1 の 1-2）
        await triggerAutosave(page); // 2 回目の保存
        expect(await saveSetItemCalls(page), '2 回目の保存でも setItem がもう 1 回試される').toBe(2);
        await expectWarning(page, status);
      }
      await expectNoKeys(page);
    });

    // V2・V3 の 04 は毎晩（同じ操作の繰り返しで、PR の e2e の時間のため。QA 判定書 2026-10-18_e2e-time-trigger.md §3-1 の 1-1・1-2）
    test(`${id('04')} 自動掘りで 60 秒（自動保存 4 回）動かしても、打撃・コインが増え続け、捕まえていない例外がない${v === 'V1' ? '' : ' @nightly'}`, async ({ page, harness }) => {
      const g = await bootGame(page);
      await autoDigOn(g);
      const s0 = await g.getState();
      const calls0 = v === 'V2' ? await saveSetItemCalls(page) : 0;
      // runFor(60000) は実時間で約 80 秒かかるので、15 秒ごとの保存（失敗する）を 4 回起こし、そのたびにループを 1 秒回して
      // 打撃が増え続けることを確かめる（時計は合計 64 秒進む。PR の 10 分の予算のため。期待は変えない）
      let prev = s0;
      for (let i = 1; i <= 4; i++) {
        await triggerAutosave(page);
        if (v === 'V2') {
          // TS-E9-07: failing の間も 15 秒ごとの保存のたびに onsen-driller:save: への setItem が 1 回ずつ試される（再試行）
          expect(await saveSetItemCalls(page), `${i} 回目の保存で setItem が 1 回試される`).toBe(calls0 + i);
        }
        await page.clock.runFor(1_000);
        const s = await g.getState();
        expect(hitsOf(s), `${i} 回目の保存（失敗）の後もループが回る`).toBeGreaterThan(hitsOf(prev));
        prev = s;
      }
      test.info().annotations.push({ type: '打撃の増分（4 回の保存の間）', description: String(hitsOf(prev) - hitsOf(s0)) });
      expect(coinsOf(prev)).toBeGreaterThan(coinsOf(s0));
      expect(await harness.uncaughtErrors()).toEqual([]);
      await expectNoKeys(page);
    });

    if (v === 'V3') {
      test('TS-E9-08 設定の保存（T5 の言語の切り替え）が失敗しても落ちず、ゲームが続く', async ({ page, harness }) => {
        // シナリオ: 「設定の保存も起こす（S1 に設定の項目があれば）」。S1 の設定の項目は T5 の言語の切り替え（lang-toggle）だけ
        const g = await bootGame(page);
        await page.getByTestId('tab-5').click();
        await page.clock.runFor(200);
        const toggle = page.getByTestId('lang-toggle');
        const before = await toggle.innerText();
        await toggle.click(); // settings の保存（onsen-driller:settings）が起きて失敗する
        await page.clock.runFor(200);
        await expect(toggle).not.toHaveText(before); // そのセッションでは切り替わる
        await g.pause();
        const h0 = hitsOf(await g.getState());
        await g.advance(1_000, { tapsPerSec: 2 });
        expect(hitsOf(await g.getState())).toBeGreaterThan(h0);
        expect(await harness.uncaughtErrors()).toEqual([]);
        await expectNoKeys(page);
      });
    }
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
      await expectWarning(page, 'unavailable');
      expect(n).toBe(1);
    });

    test('TS-E9-06 60 秒遊んだ後の再読み込みは新しいゲーム（チケット 2・コイン 0）で、案内がもう一度出る @nightly', async ({ page }) => {
      needs('feature:saveWarning', 'feature:tickets');
      const g = await bootGame(page);
      await autoDigOn(g);
      for (let i = 0; i < 4; i++) await triggerAutosave(page);
      const g2 = await reloadGame(page);
      const s = await g2.getState();
      expect(coinsOf(s)).toBe(0);
      expect(s.meta.tickets).toBe(2);
      // V1 は起動直後から unavailable なので、再読み込みの直後（保存の前）から出ている
      await expectWarning(page, 'unavailable');
    });
  });

  test('TS-E9-09 V4（書き込みが捨てられる）: 起動直後に案内が出て（failing。Q-25）、ゲームは続く', async ({ page, context, harness }) => {
    // Q-25: V4 は読めるので localStorage のまま、起動時の試し書きの読み戻しが合わないので起動直後から failing。
    // 15 秒ごとに再試行するが V4 では成功しないので出したまま。キーは 1 つも書かれない
    needs('feature:saveWarning');
    await injectStorageFault(context, 'V4');
    const g = await bootGame(page);
    await expectBeforeFirstAutosave(page, T0);
    await expectWarning(page, 'failing');
    await triggerAutosave(page);
    await expectWarning(page, 'failing');
    await tapUnderground(page, 3);
    expect(hitsOf(await g.getState())).toBeGreaterThan(0);
    expect(await harness.uncaughtErrors()).toEqual([]);
    await expectNoKeys(page);
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
    // 2 回目までは保存できている（ok）ので案内は出ていない
    await expect(warning(page)).toHaveCount(0);
    await g.advance(30_000, { tapsPerSec: 2 });
    await triggerAutosave(page); // 3 回目（失敗）
    await expectWarning(page, 'failing');
    // ゲームは続く
    const h0 = hitsOf(await g.getState());
    await g.advance(1_000, { tapsPerSec: 2 });
    expect(hitsOf(await g.getState())).toBeGreaterThan(h0);
    expect(await harness.uncaughtErrors()).toEqual([]);
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

  test('TS-046-18 V5: 3 回目の保存の失敗の直後に保存のトーストが 1 回だけ出て 2 秒で消え、4 回目では出ない。save-warning は出したまま（BL-103）', async ({
    page,
    context,
    harness,
  }) => {
    needs('hook:advance.input', 'feature:twoSlotSave', 'feature:saveWarning');
    await injectStorageFault(context, 'V5');
    const g = await bootGame(page);
    await g.pause();
    // 保存のトースト（data-kind="save"）が DOM に足された回数を数える（出てすぐ消えたものも数える）
    await page.evaluate(() => {
      const w = window as unknown as { __e2eSaveToasts: number };
      w.__e2eSaveToasts = 0;
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes)
            if (n instanceof HTMLElement && n.matches('[data-testid="toast"][data-kind="save"]')) w.__e2eSaveToasts++;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const saveToasts = (): Promise<number> => page.evaluate(() => (window as unknown as { __e2eSaveToasts: number }).__e2eSaveToasts);
    const toast = page.locator('[data-testid="toast"][data-kind="save"]');
    await triggerAutosave(page); // 1 回目（成功）
    await triggerAutosave(page); // 2 回目（成功）
    await expect(warning(page)).toHaveCount(0);
    expect(await saveToasts(), '成功の間はトーストが出ない').toBe(0);
    await triggerAutosave(page); // 3 回目（失敗）
    await expect(toast, '3 回目の失敗の直後に保存のトースト').toHaveCount(1);
    await expectWarning(page, 'failing');
    // 2 秒で消える（TOAST_MS。消える前は残っている）
    await page.clock.runFor(1_700);
    await expect(toast).toHaveCount(1);
    await page.clock.runFor(500);
    await expect(toast, '2 秒で消える').toHaveCount(0);
    await triggerAutosave(page); // 4 回目（失敗が続く）
    await expect(toast, '4 回目では出ない').toHaveCount(0);
    expect(await saveToasts(), 'トーストは 3 回目の 1 回だけ').toBe(1);
    await expectWarning(page, 'failing');
    expect(await harness.uncaughtErrors()).toEqual([]);
  });

  test('TS-E9-13 保存できない型（V1〜V3）の遊びの後、共通の検査（通信・Cookie・キー名）が合格し、キーが 0 個', async ({ harness }) => {
    // 共通の検査（TS-COM-01〜04）はすべての E2E の終わりに harness が自動で行う。ここでは V1〜V3 を 1 つずつ開き、
    // 叩く → 自動保存（失敗）→ 非表示（保存の契機）の後に、目に見える形で確かめる。V4・V5・V6・V7 は各テストの終わりの自動の検査
    for (const v of ['V1', 'V2', 'V3'] as const) {
      const ctx = await harness.newContext();
      await injectStorageFault(ctx, v);
      const p = await ctx.newPage();
      await bootGame(p);
      await tapUnderground(p, 5);
      await triggerAutosave(p);
      await setHidden(p, true);
      await setHidden(p, false);
      const violations = await harness.monitorOf(ctx).violations();
      expect(violations, `${v} の共通の検査`).toEqual([]);
      expect(await localStorageKeys(ctx), `${v} はキーが 0 個`).toEqual([]);
    }
    await harness.assertCommonChecks();
  });

  test('TS-E9-14 V6（容量いっぱい・既存のセーブあり）: 既存のセーブを読んで始まり、起動直後から案内、空いたら次の保存で回復して案内が消える（S-2）', async ({ page, harness }) => {
    const { slots, x, y } = await prepareTwoSlots(page, harness);
    const xEnv = slots[x].env!;
    const yEnv = slots[y].env!;
    const reopened = await reopenWithStorage(harness, page.context(), () => {}, (ctx) => injectStorageFault(ctx, 'V6'));
    const rp = reopened.page;
    // X の savedAt で時計を止めて起動する（起動の間ロジックは進まないので、読み込んだ状態をそのまま比べられる）
    const g = await bootGame(rp, { time: xEnv.savedAt, startPaused: true });
    await g.pause();
    // 既存のセーブ（X）を読んで始まる。新しいゲームにならない
    expect(await g.getState()).toEqual(xEnv.game);
    // 起動直後（最初の保存の前）から failing の案内
    await expectBeforeFirstAutosave(rp, xEnv.savedAt);
    await expectWarning(rp, 'failing');
    // 容量いっぱいの間の 2 回の保存: X・Y が 1 バイトも変わらず、キーも増えない
    const ls0 = await readLocalStorage(reopened.context, harness.origin);
    await triggerAutosave(rp);
    await triggerAutosave(rp);
    const full = await readSlots(reopened.context, harness.origin);
    expect(full[x].raw, '容量いっぱいの間は X が変わらない').toBe(slots[x].raw);
    expect(full[y].raw, '容量いっぱいの間は Y が変わらない').toBe(slots[y].raw);
    expect(saveKeysOf(await readLocalStorage(reopened.context, harness.origin))).toEqual(saveKeysOf(ls0));
    await expectWarning(rp, 'failing');
    // 容量が空いた後の保存は成功する: 正の X の反対（Y の枠）に、有効な最大の seq＋1（n＋2）
    await rp.evaluate(() => {
      (window as unknown as { __quotaFull: boolean }).__quotaFull = false;
    });
    const state = await g.getState();
    await triggerAutosave(rp);
    const ok = await readSlots(reopened.context, harness.origin);
    expect(ok[x].raw, 'X（正）は上書きしない').toBe(slots[x].raw);
    expect(ok[y].env, 'Y の枠に有効な封筒が書かれる').not.toBeNull();
    expect(ok[y].env!.seq).toBe(yEnv.seq + 2);
    expect(ok[y].env!.game).toEqual(state);
    // ok に戻り、案内が消える
    await expect(warning(rp)).toHaveCount(0);
    expect(await harness.uncaughtErrors()).toEqual([]);
  });

  test('TS-E9-15 V7（セーブの枠だけ読めない・既存のセーブあり）: 起動して遊べ、読めない枠を空とみなして上書きしない（S-1・Q-23）', async ({ page, harness }) => {
    const { slots, x } = await prepareTwoSlots(page, harness);
    const xEnv = slots[x].env!;
    const reopened = await reopenWithStorage(harness, page.context(), () => {}, (ctx) => injectStorageFault(ctx, 'V7'));
    const rp = reopened.page;
    const started = Date.now();
    const g = await bootGame(rp);
    expect(Date.now() - started, '10 秒以内にゲーム画面が出る').toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
    // Q-23 (a)(b): 有効な枠が読めないのでメモリの新しいゲームで始まり、起動直後から unavailable の案内
    const s0 = await g.getState();
    expect(coinsOf(s0)).toBe(0);
    expect(s0.run.depth).toBe(0);
    expect(s0.meta.tickets).toBe(2);
    await expectBeforeFirstAutosave(rp, T0);
    await expectWarning(rp, 'unavailable');
    // クリックで打撃が入る
    const c = centerOf((await g.rect('drill'))!);
    const h0 = hitsOf(s0);
    await rp.mouse.click(c.x, c.y);
    expect(hitsOf(await g.getState())).toBeGreaterThan(h0);
    // 15 秒ごとの保存 4 回 → 非表示 → 表示 → 読めるように戻す → 次の保存より前に読む
    for (let i = 0; i < 4; i++) await triggerAutosave(rp);
    await setHidden(rp, true);
    await setHidden(rp, false);
    await rp.evaluate(() => {
      (window as unknown as { __readFail: boolean }).__readFail = false;
    });
    const mid = await readLocalStorage(reopened.context, harness.origin);
    expect(mid.get(SLOT_KEYS.a) ?? null, 'a の生の文字列が起動前と 1 バイトも変わらない').toBe(slots.a.raw);
    expect(mid.get(SLOT_KEYS.b) ?? null, 'b の生の文字列が起動前と 1 バイトも変わらない').toBe(slots.b.raw);
    expect(mid.has(BROKEN_SLOT_KEY), 'onsen-driller:save:broken ができない').toBe(false);
    // Q-23 (d): 読めるようになっても、そのセッションでは読み直さず・書かない（次の保存でも枠は変わらない）
    await triggerAutosave(rp);
    const late = await readLocalStorage(reopened.context, harness.origin);
    expect(late.get(SLOT_KEYS.a) ?? null).toBe(slots.a.raw);
    expect(late.get(SLOT_KEYS.b) ?? null).toBe(slots.b.raw);
    await expectWarning(rp, 'unavailable');
    expect(await harness.uncaughtErrors()).toEqual([]);
    // 次の起動（初期化スクリプトなし＝読める context）で、元の進行（X）が残っている
    const next = await reopenWithStorage(harness, reopened.context, () => {});
    const g2 = await bootGame(next.page, { time: xEnv.savedAt, startPaused: true });
    expect(await g2.getState()).toEqual(xEnv.game);
  });

  test('TS-E9-11 保存できない環境でも書き出しが使え、普通の環境で読み込める', () => {
    later('S3:export');
  });

  test.describe('e2e-crazygames', () => {
    test.use({ baseURL: CG_BASE_URL });

    test('TS-E9-12 e2e-crazygames（data モジュールが読めない例外・localStorage も V1）でメモリに置いて続き、起動直後から案内が出る（BL-103）', async ({
      page,
      context,
      harness,
    }) => {
      await injectStorageFault(context, 'V1');
      const g = await bootCrazyGames(page, harness, { mock: { dataGetThrows: true } });
      const bootedAt = await pageNow(page);
      expect(await g.target()).toBe('crazygames');
      // TS-E9-03: 起動直後（最初の保存の前）から案内（読めない保存先はメモリ。unavailable）
      await expectBeforeFirstAutosave(page, bootedAt);
      await expectWarning(page, 'unavailable');
      // TS-E9-02: 叩けば打撃が入る（ゲームは続く）
      await g.pause();
      const h0 = hitsOf(await g.getState());
      await tapUnderground(page, 3);
      expect(hitsOf(await g.getState()) - h0, '叩いた分の打撃').toBe(3);
      // 15 秒ごとの保存の後も案内は出たまま。data モジュール・localStorage のどちらにもセーブを書かない
      await triggerAutosave(page);
      await expectWarning(page, 'unavailable');
      const mock = await cgMockState(page);
      expect(mock.calls, 'data モジュールを読みに行った（そして例外を受けた）').toContain('data.getItem:onsen-driller:save:a');
      expect(Object.keys(mock.store).filter((k) => k.startsWith('onsen-driller:save:')), 'data モジュールにセーブがない').toEqual([]);
      expect(mock.calls.filter((c) => c.startsWith('data.setItem:onsen-driller:save:')), 'data モジュールにセーブを書きに行かない').toEqual([]);
      await expectNoKeys(page);
      expect(await harness.uncaughtErrors()).toEqual([]);
    });
  });
});
