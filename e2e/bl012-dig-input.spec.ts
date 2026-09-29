// E2E: BL-012 掘削の入力（BL-012_dig-input.md）の S1 の e2e — TS-012-15・18
// - TS-012-15 の「最初のクリックで 1 打」は、E1 の TS-E1-04 の前半をここに統合したもの（QA レビュー §3-1。TS-E1-15 は毎晩の画面サイズ違い）
// - TS-012-18 はポータルの枠を模した縦に長い親ページの iframe で行う（e2e/support/frame.ts）。
//   「ゲームにフォーカスして」を 2 通りで確かめる: (a) ゲームの中の HUD を押す、(b) 遊ぶ場所（ステージ）を押す。
//   (b) は 2026-09-29 の BL-097 の実行で本体の不具合が見つかった（ステージの pointerdown の preventDefault で mousedown が出ず、
//   iframe にフォーカスが移らない → キーが親ページに届いてスクロールする。実行記録 org/30_quality/test-engineer/runs/2026-09-29_bl-097-ticket-e2e.md）。
//   BL-100（BUG-1 の修正。ステージの pointerdown で window.focus() と、フォーカスのある要素の blur を行う）で直したので、
//   既知の不具合の印（KNOWN_BUG_1）を外し、(a) と同じ期待で判定する（期待は変えていない）
import type { Frame, Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, centerOf } from './support/boot.ts';
import { openGameInFrame } from './support/frame.ts';
import { hitsOf } from './support/hooks.ts';
import { recordedKeydowns } from './support/privacy.ts';

/** 親ページのスクロールが止まるまで待ち（キーのスクロールは滑らかに動く）、その位置を返す */
async function settledScrollY(page: Page): Promise<number> {
  let last = await page.evaluate(() => window.scrollY);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
  }
  throw new Error('親ページのスクロールが止まりません');
}

/** 親ページのスクロールの開始位置（上下どちらにも動ける位置） */
const START_Y = 400;

/** 枠（iframe の文書）にフォーカスが入るのを最大 timeoutMs 待つ */
async function waitFocus(frame: Frame, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await frame.evaluate(() => document.hasFocus())) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * TS-012-18 の本体: 縦に長い親ページ（3000px）の上から 600px に 800×450 の枠。親を START_Y まで動かし、
 * 親ページにフォーカスを移してから（ポータルのページを触った後を模す）、focusGame でゲームにフォーカスし、Space・矢印キーを押す
 */
async function keysInPortal(page: Page, focusGame: (frame: Frame) => Promise<void>): Promise<void> {
  const { frame, g } = await openGameInFrame(page, { width: 800, height: 450, top: 600, parentHeight: 3000 });
  await page.evaluate((y) => window.scrollTo(0, y), START_Y);
  expect(await settledScrollY(page)).toBe(START_Y);

  // 対照: 親ページにフォーカスがあるときの ↓ は親をスクロールさせる（このページが矢印キーでスクロールできることの確認。偽の緑を防ぐ）
  // （locator.click は要素を画面に入れるためにスクロールするので、座標で枠の外の本文を押す。枠は文書の y=600 からで、
  //   親を 400 までスクロールしているので、ビューポートの y=50 は枠の上の本文。モバイルの狭い画面でも枠の外）
  await page.mouse.click(10, 50);
  expect(await frame.evaluate(() => document.hasFocus()), '親ページを押すとゲームの枠からフォーカスが外れる').toBe(false);
  await page.keyboard.press('ArrowDown');
  const moved = await settledScrollY(page);
  test.info().annotations.push({ type: '対照: 親ページの ↓ で動いた scrollY', description: `${START_Y} → ${moved}` });
  expect(moved, '親ページは ↓ でスクロールする（対照）').toBeGreaterThan(START_Y);
  await page.evaluate((y) => window.scrollTo(0, y), START_Y);
  expect(await settledScrollY(page)).toBe(START_Y);

  // ゲームにフォーカスする
  await focusGame(frame);
  expect(await waitFocus(frame, 2_000), 'ゲームの枠にフォーカスがある').toBe(true);
  const h0 = hitsOf(await g.getState());

  const keys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ArrowDown', 'ArrowDown', 'Space'];
  for (const k of keys) {
    await page.keyboard.press(k);
    expect(await settledScrollY(page), `${k} の後の親の scrollY`).toBe(START_Y);
  }
  // 長押し（自動リピートの keydown）も同じ
  await page.keyboard.down('Space');
  for (let i = 0; i < 5; i++) await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  expect(await settledScrollY(page)).toBe(START_Y);

  // 枠の中で記録した keydown（harness の初期化スクリプトは iframe にも入る）: すべて届いて preventDefault 済み
  const rec = await recordedKeydowns(frame);
  expect(rec.filter((k) => k.code === 'Space')).toHaveLength(3 + 6);
  expect(rec.filter((k) => k.code.startsWith('Arrow'))).toHaveLength(6);
  expect(rec.filter((k) => !k.prevented)).toEqual([]);
  // Space はゲームの打撃になった（キーがゲームに届いている）
  expect(hitsOf(await g.getState())).toBeGreaterThan(h0);
}

/** 枠の中の要素を押す（boundingBox は枠の中の要素でも親のビューポートの座標を返す） */
async function clickInFrame(page: Page, frame: Frame, testId: string, yRatio = 0.5): Promise<void> {
  const box = await frame.getByTestId(testId).boundingBox();
  expect(box, `${testId} が見える`).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height * yRatio);
}

test.describe('BL-012 掘削の入力', () => {
  test("TS-012-15 rect('drill') の中心の最初のクリックで打撃が 1 増える（「クリックで開始」などの前置きがない）", async ({ page }) => {
    const g = await bootGame(page);
    const s0 = await g.getState();
    // 起動直後は何も叩いていない（このクリックが最初の入力）
    expect(hitsOf(s0)).toBe(0);
    expect(s0.stats.taps ?? 0).toBe(0);
    const r = await g.rect('drill');
    expect(r, "rect('drill')").not.toBeNull();
    const c = centerOf(r!);
    await page.mouse.click(c.x, c.y);
    const s1 = await g.getState();
    expect(hitsOf(s1) - hitsOf(s0)).toBe(1);
    expect(s1.stats.taps ?? 0).toBe(1);
  });

  test('TS-012-18 (a) 縦に長い親ページの iframe: ゲームの HUD を押してフォーカスした後の Space・矢印キーが preventDefault され、親の scrollY が変わらない', async ({
    page,
  }) => {
    await keysInPortal(page, (frame) => clickInFrame(page, frame, 'hud-coins'));
  });

  test('TS-012-18 (b) 縦に長い親ページの iframe: 遊ぶ場所（ステージ）を押してフォーカスした後の Space・矢印キーが preventDefault され、親の scrollY が変わらない', async ({
    page,
  }) => {
    await keysInPortal(page, (frame) => clickInFrame(page, frame, 'stage', 0.75));
  });
});
