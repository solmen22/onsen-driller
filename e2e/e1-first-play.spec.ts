// E2E E1 初回起動 → 最初の強化（e2e_E1_first-play.md）
// PR: TS-E1-01・02・05・06・08〜13・17（S1）。毎晩: TS-E1-07・15（BL-089）。
// シナリオの「実装のまとめ方」は 1 つの流れを勧めているが、ここでは ID ごとにテストを分けた（起動は 1 回 約 0.5 秒で、
// 分けても PR は 1 分未満。いまのビルドに無いフック・機能による保留を ID ごとに付けられ、失敗の場所も分かる）。
// 保留: TS-E1-03・04・TS-071-17（S2。CEO 決定 Q-01）、TS-E1-14（S3）、TS-E1-16（S2）。
// いまのビルドに無いフック・機能を使うテストは needs() で保留になる（e2e/support/gaps.ts）。
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { BOOT_TIMEOUT_MS, bootGame, centerOf, T0, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later, needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks } from './support/hooks.ts';
import { recordedKeydowns } from './support/privacy.ts';
import { SEED_A, SEED_B } from '../tests/helpers/seeds.ts';

const PICKAXE_COST = 3; // gdd §5-3・content/tools.ts（ツルハシ 3 コイン）

/** advance(500, {tapsPerSec: 2}) を繰り返し、コインが 3 以上になった時刻 t（ms）を返す（最大 40 回＝20 秒） */
async function timeToPickaxe(g: Hooks): Promise<number | null> {
  for (let i = 1; i <= 40; i++) {
    await g.advance(500, { tapsPerSec: 2 });
    if (coinsOf(await g.getState()) >= PICKAXE_COST) return i * 500;
  }
  return null;
}

/** SEED_A で標準の打撃でツルハシを買える所まで進め、ツルハシを買う（TS-E1-08 の直後の状態） */
async function buyPickaxeByTaps(g: Hooks): Promise<void> {
  expect(await timeToPickaxe(g)).not.toBeNull();
  const r = await g.dispatch({ type: 'buy', item: 'tool', qty: 1 });
  expect(r.ok).toBe(true);
}

/** 画面の要素のうち、全画面を思わせるボタン（テキスト・aria-label・data-testid・title） */
async function fullscreenButtons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('button, [role="button"], a, input[type="button"]')]
      .map((el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('title')].join(' '))
      .filter((s) => /full\s*-?\s*screen|全画面/i.test(s)),
  );
}

test.describe('E1 初回起動 → 最初の強化', () => {
  test('TS-E1-01 何も操作せずに 10 秒以内にキャンバスと HUD が見える（#1）', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('[data-testid="stage"] canvas')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    await expect(page.getByTestId('hud-coins')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'ゲーム画面までの実時間(ms)', description: String(ms) });
    expect(ms).toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
  });

  test('TS-E1-01 道具の位置にタイトル画面・「タップで開始」の覆いがない', async ({ page }) => {
    needs('hook:rect');
    const g = await bootGame(page);
    const r = await g.rect('drill');
    expect(r, "rect('drill')").not.toBeNull();
    const c = centerOf(r!);
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const canvas = document.querySelector('[data-testid="stage"] canvas');
      return { onCanvas: !!el && !!canvas && (el === canvas || canvas.contains(el)), tag: el?.tagName ?? null, testid: el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null };
    }, c);
    expect(hit.onCanvas, `elementFromPoint: ${JSON.stringify(hit)}`).toBe(true);
  });

  test('TS-E1-02 起動直後の状態と HUD（コイン 0・深さ 0・スコップ・自動掘りオフ）', async ({ page }) => {
    const g = await bootGame(page);
    const s = await g.getState();
    expect(coinsOf(s)).toBe(0);
    expect(s.run.depth).toBe(0);
    expect(s.run.drill.tool).toBe(0);
    expect(s.run.autoDig.on).toBe(false);
    await expect(page.getByTestId('hud-coins')).toHaveText(/^\D*0\D*$/);
  });

  test('TS-E1-02 起動直後の温泉チケットが 2（状態と HUD）', async ({ page }) => {
    needs('feature:tickets');
    const g = await bootGame(page);
    expect((await g.getState()).meta.tickets).toBe(2);
    await expect(page.getByTestId('hud-tickets')).toHaveText(/^\D*2\D*$/);
  });

  test.describe('ライフサイクル（S2）', () => {
    test('TS-E1-03 入力がない間は loadingStart → loadingStop だけ', async ({ page }) => {
      later('S2:lifecycle');
      const g = await bootGame(page);
      const names = (await g.calls()).map((c) => c.name);
      expect(names.indexOf('loadingStart')).toBeGreaterThanOrEqual(0);
      expect(names.indexOf('loadingStop')).toBeGreaterThan(names.indexOf('loadingStart'));
      expect(names).not.toContain('gameplayStart');
    });

    test('TS-E1-04 最初のクリックで gameplayStart が loadingStop の後にちょうど 1 回（冪等）', async ({ page }) => {
      // 最初のクリックで 1 打が入ることは TS-012-15（S1）で確かめる（QA レビュー §3-1 で前半を削った）
      later('S2:lifecycle');
      needs('hook:rect');
      const g = await bootGame(page);
      const c = centerOf((await g.rect('drill'))!);
      await page.mouse.click(c.x, c.y);
      let names = (await g.calls()).map((x) => x.name);
      expect(names.filter((n) => n === 'gameplayStart')).toHaveLength(1);
      expect(names.indexOf('gameplayStart')).toBeGreaterThan(names.indexOf('loadingStop'));
      await page.clock.runFor(200);
      await page.mouse.click(c.x, c.y);
      names = (await g.calls()).map((x) => x.name);
      expect(names.filter((n) => n === 'gameplayStart')).toHaveLength(1);
    });

    test('TS-071-17 platform.calls() が呼び出しを順番どおりに記録する', async ({ page }) => {
      later('S2:lifecycle');
      needs('hook:rect');
      const g = await bootGame(page);
      const before = await g.calls();
      expect(before.every((c) => typeof c.name === 'string')).toBe(true);
      const c = centerOf((await g.rect('drill'))!);
      await page.mouse.click(c.x, c.y);
      const names = (await g.calls()).map((x) => x.name);
      const order = ['loadingStart', 'loadingStop', 'gameplayStart'].map((n) => names.indexOf(n));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  });

  test('TS-E1-05 ツルハシを買う前は自動掘りが表示されていて押せない（押しても 10 秒で打撃が増えない）', async ({ page }) => {
    needs('feature:autoDigLock');
    const g = await bootGame(page);
    await g.pause();
    const t = page.getByTestId('toggle-auto-dig');
    // PM の Q-17 回答: 表示して押せない（data-state="locked"・disabled）。「最初の強化」の定義は Q-03
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute('data-state', 'locked');
    await expect(t).toBeDisabled();
    await t.click({ force: true }); // 押しても何も起きない
    const h0 = hitsOf(await g.getState());
    await g.advance(10_000);
    expect(hitsOf(await g.getState()) - h0).toBe(0);
    expect((await g.getState()).run.autoDig.on).toBe(false);
  });

  test('TS-E1-06 標準の打撃（毎秒 2 打）で 5〜15 秒後にツルハシを買える（SEED_A。#2 の裏付け）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    const t = await timeToPickaxe(g);
    test.info().annotations.push({ type: 'TS-E1-06 t(ms)', description: String(t) });
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(5_000);
    expect(t!).toBeLessThanOrEqual(15_000);
  });

  test('TS-E1-07 SEED_B（序盤に鉱石）で最初の強化までの時刻を記録する（Q-02 の回答まで記録のみ） @nightly', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input');
    const g = await bootGame(page, { seed: SEED_B });
    await g.pause();
    const t = await timeToPickaxe(g);
    test.info().annotations.push({ type: 'TS-E1-07 t(ms)（記録のみ）', description: String(t) });
    expect(t).not.toBeNull();
  });

  test('TS-E1-08 画面でツルハシを買う（コインがちょうど 3 減り、ToolEvolved が 1 回、自動掘りが使えるようになる）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input', 'hook:events', 'feature:buyState', 'feature:autoDigLock');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    expect(await timeToPickaxe(g)).not.toBeNull();
    await page.clock.runFor(250); // UI の更新（5Hz）
    const buy = page.getByTestId('buy-tool');
    await expect(buy).toHaveAttribute('data-state', 'affordable');
    const hudBefore = await page.getByTestId('hud-coins').innerText();
    const before = await g.getState();
    await buy.click();
    const after = await g.getState();
    expect(after.run.drill.tool).toBe(1);
    expect(coinsOf(before) - coinsOf(after)).toBeCloseTo(PICKAXE_COST, 9);
    const evolved = (await g.events()).filter((e) => e.type === 'ToolEvolved' && e.tool === 1);
    expect(evolved).toHaveLength(1);
    await page.clock.runFor(250);
    await expect(page.getByTestId('hud-coins')).not.toHaveText(hudBefore);
    const toggle = page.getByTestId('toggle-auto-dig');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('data-state', 'off');
  });

  test('TS-E1-09 自動掘りをオンにすると 10 秒で打撃が 20 増える（自動掘削機 Lv0 の分は 0）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input', 'feature:autoDigLock');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    await buyPickaxeByTaps(g);
    await page.clock.runFor(250);
    const toggle = page.getByTestId('toggle-auto-dig');
    await toggle.click();
    await page.clock.runFor(250);
    await expect(toggle).toHaveAttribute('data-state', 'on');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect((await g.getState()).run.autoDig.on).toBe(true);
    const h0 = hitsOf(await g.getState());
    await g.advance(10_000);
    expect(hitsOf(await g.getState()) - h0).toBe(20);
  });

  test('TS-E1-10 道具の上で長押し 2 秒で約 8 打（毎秒 4 打）、離した後は増えない', async ({ page }) => {
    needs('hook:seed', 'hook:rect');
    const g = await bootGame(page, { seed: SEED_A });
    await g.resume();
    const c = centerOf((await g.rect('drill'))!);
    const h0 = hitsOf(await g.getState());
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.clock.runFor(2_000);
    await page.mouse.up();
    const h1 = hitsOf(await g.getState());
    test.info().annotations.push({ type: '長押し 2 秒の打撃', description: String(h1 - h0) });
    expect(h1 - h0).toBeGreaterThanOrEqual(7);
    expect(h1 - h0).toBeLessThanOrEqual(9);
    await page.clock.runFor(1_000);
    expect(hitsOf(await g.getState())).toBe(h1);
  });

  test('TS-E1-11 Space の押しっぱなし 2 秒で約 8 打（自動リピートは数えない）、Space・矢印キーはすべて preventDefault', async ({ page }) => {
    needs('hook:seed');
    const g = await bootGame(page, { seed: SEED_A });
    await g.resume();
    // 長押し: 押している間の自動リピート（repeat: true）の keydown を 10 回送る
    const h0 = hitsOf(await g.getState());
    await page.keyboard.down('Space');
    for (let i = 0; i < 10; i++) {
      await page.clock.runFor(200);
      await page.keyboard.down('Space');
    }
    await page.keyboard.up('Space');
    const h1 = hitsOf(await g.getState());
    test.info().annotations.push({ type: 'Space 2 秒の打撃', description: String(h1 - h0) });
    // 自動リピートをタップとして数えると 10 打多くなる
    expect(h1 - h0).toBeGreaterThanOrEqual(7);
    expect(h1 - h0).toBeLessThanOrEqual(9);
    // 短い押し 1 回（1 打かは Q-04(d)。回答まで記録のみ）
    await page.clock.runFor(1_000);
    const h2 = hitsOf(await g.getState());
    await page.keyboard.press('Space');
    await page.clock.runFor(500);
    test.info().annotations.push({ type: 'Space の短い押しの打撃（Q-04(d)。記録のみ）', description: String(hitsOf(await g.getState()) - h2) });
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
    // ページ側で記録した keydown（準備の 2）。ゲームの処理の後の defaultPrevented を見る
    const keys = await recordedKeydowns(page);
    expect(keys.filter((k) => k.code === 'Space')).toHaveLength(12); // 長押し 1＋自動リピート 10＋短い押し 1
    expect(keys.filter((k) => k.code.startsWith('Arrow'))).toHaveLength(4);
    expect(keys.filter((k) => !k.prevented)).toEqual([]);
  });

  test('TS-E1-12 全画面を要求しない・独自の全画面ボタンがない（CrazyGames の規約）', async ({ page }) => {
    await bootGame(page);
    await tapUnderground(page, 5);
    const offenders: string[] = [];
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.clock.runFor(200);
      offenders.push(...(await fullscreenButtons(page)));
    }
    expect(await page.evaluate(() => (window as unknown as { __fsCalls: number }).__fsCalls)).toBe(0);
    expect(offenders).toEqual([]);
  });

  test('TS-E1-13 E1 の一連の操作で、ページの例外と console.error が 0 件', async ({ page, harness }) => {
    const g = await bootGame(page);
    await tapUnderground(page, 30); // 画面の操作だけでツルハシの代金をためる
    await page.clock.runFor(250);
    if (coinsOf(await g.getState()) >= PICKAXE_COST) await page.getByTestId('buy-tool').click();
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.clock.runFor(200);
    }
    await page.clock.runFor(2_000);
    expect(harness.pageErrors).toEqual([]);
    expect(harness.consoleErrors).toEqual([]);
  });

  test('TS-E1-13 E1 の一連の操作で、__game.errors() が 0 件', async ({ page }) => {
    needs('hook:errors');
    const g = await bootGame(page);
    await tapUnderground(page, 30);
    await page.clock.runFor(2_000);
    expect(await g.errors()).toEqual([]);
  });

  test('TS-E1-14 起動直後にチュートリアルの指アイコンが出る', async ({ page }) => {
    later('S3:tutorial');
    await bootGame(page);
    await expect(page.getByTestId('tutorial-finger')).toBeVisible();
  });

  test.describe('TS-E1-15 画面サイズ（800×450・1920×1080・390×844） @nightly', () => {
    for (const vp of [
      { name: '800x450', width: 800, height: 450, touch: false },
      { name: '1920x1080', width: 1920, height: 1080, touch: false },
      { name: '390x844', width: 390, height: 844, touch: true },
    ]) {
      test.describe(vp.name, () => {
        test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
        test(`TS-E1-15 ${vp.name}: 0 クリックでゲーム画面、最初のタップで 1 打、ツルハシを画面で買える`, async ({ page }) => {
          needs('hook:seed', 'hook:rect', 'hook:advance.input', 'feature:buyState');
          const g = await bootGame(page, { seed: SEED_A });
          const c = centerOf((await g.rect('drill'))!);
          const h0 = hitsOf(await g.getState());
          if (vp.touch) await page.touchscreen.tap(c.x, c.y);
          else await page.mouse.click(c.x, c.y);
          expect(hitsOf(await g.getState()) - h0).toBe(1);
          await g.pause();
          expect(await timeToPickaxe(g)).not.toBeNull();
          await page.clock.runFor(250);
          const buy = page.getByTestId('buy-tool');
          await expect(buy).toHaveAttribute('data-state', 'affordable');
          if (vp.touch) await buy.tap();
          else await buy.click();
          expect((await g.getState()).run.drill.tool).toBe(1);
        });
      });
    }
  });

  test('TS-E1-16 e2e-crazygames でライフサイクルがモックに記録される', () => {
    later('S2:crazygames');
  });

  test('TS-E1-17 E1 の一連の操作の後、共通の検査（通信・Cookie・キー名）がすべて合格', async ({ page, harness }) => {
    const g = await bootGame(page);
    await tapUnderground(page, 30);
    await page.clock.runFor(250);
    if (coinsOf(await g.getState()) >= PICKAXE_COST) await page.getByTestId('buy-tool').click();
    await triggerAutosave(page);
    await harness.assertCommonChecks();
  });
});
