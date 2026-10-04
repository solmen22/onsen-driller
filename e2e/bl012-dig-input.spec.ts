// E2E: BL-012 掘削の入力（BL-012_dig-input.md）の S1 の e2e — TS-012-15・18。S2 の BL-101 — TS-012-26（別オリジンの枠）・
// TS-012-27（ステージを押したときの blur の経路。PR #7 のレビュー N-3）、BL-089 — TS-012-22（地上を押しても掘れる）
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
import { crossOriginParent, openGameInFrame, type FrameOptions } from './support/frame.ts';
import { coinsOf, hitsOf } from './support/hooks.ts';
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

/** TS-012-18・26・27 の枠: 縦に長い親ページ（3000px）の上から 600px に 800×450 */
const PORTAL: FrameOptions = { width: 800, height: 450, top: 600, parentHeight: 3000 };

/**
 * 枠の中に harness の見張り（初期化スクリプトの pageProbe）が入っていることを確かめる（PR #6 のレビュー N-4）。
 * 入っていないと、枠の中の keydown の記録（recordedKeydowns）が取れず、別オリジンの枠で見張りが外れても気づけない
 */
async function expectFrameMonitored(frame: Frame): Promise<void> {
  const probe = await frame.evaluate(() => {
    const w = window as unknown as { __fsCalls?: unknown; __keys?: unknown; __e2eNetJournal?: unknown };
    return { fsCalls: typeof w.__fsCalls, keys: Array.isArray(w.__keys), journal: typeof w.__e2eNetJournal };
  });
  expect(probe, '枠の中に harness の見張り（pageProbe）が入っている').toEqual({ fsCalls: 'number', keys: true, journal: 'function' });
}

/**
 * 親ページと枠が本当に別オリジンで、Chromium では枠が別のプロセス（OOPIF）であることを確かめる（BL-101。
 * 同じプロセスの枠のままでは、実際のポータルと同じ条件を試していないため）。OOPIF の確認は CDP を使うので Chromium だけ
 */
async function expectCrossOrigin(page: Page, frame: Frame, browserName: string): Promise<void> {
  const parentOrigin = new URL(page.url()).origin;
  const gameOrigin = new URL(frame.url()).origin;
  test.info().annotations.push({ type: '親ページと枠のオリジン', description: `${parentOrigin} → ${gameOrigin}` });
  expect(gameOrigin).not.toBe(parentOrigin);
  if (browserName !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { type: string; url: string }[] };
    const oopif = targetInfos.filter((t) => t.type === 'iframe' && t.url.startsWith(gameOrigin));
    expect(oopif, 'ゲームの枠が別のプロセスの iframe（OOPIF）になっている').toHaveLength(1);
  } finally {
    await cdp.detach();
  }
}

/**
 * TS-012-18・26 の本体: 親を START_Y まで動かし、親ページにフォーカスを移してから（ポータルのページを触った後を模す）、
 * focusGame でゲームにフォーカスし、Space・矢印キーを押す。extra で親ページ・枠の URL を変え（別オリジンの版）、
 * onOpen で開いた直後の確かめ（別オリジン・見張り）を行う
 */
async function keysInPortal(
  page: Page,
  focusGame: (frame: Frame) => Promise<void>,
  extra: Partial<FrameOptions> = {},
  onOpen: (frame: Frame) => Promise<void> = async () => {},
): Promise<void> {
  const { frame, g } = await openGameInFrame(page, { ...PORTAL, ...extra });
  await onOpen(frame);
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

  test('TS-012-22 地上（キャンバスの上 25%）を押しても掘れる（Q-04(f): ステージのどこを押しても掘れる）', async ({ page }) => {
    const g = await bootGame(page);
    const canvas = (await page.locator('[data-testid="stage"] canvas').boundingBox())!;
    const drill = (await g.rect('drill'))!;
    // 地上の帯（上 25%）の中の 2 点: 左から 10%・上から 10%、右から 10%・上から 22%（ドリルは横の中央にあり、縦長の画面では
    // 地上の帯の中まで的が伸びるので、中央は避ける）。ドリルの的の外であることも確かめる（的を押した合格にしない）
    for (const [rx, ry] of [
      [0.1, 0.1],
      [0.9, 0.22],
    ] as const) {
      const where = `左から ${rx * 100}%・上から ${ry * 100}%`;
      const p = { x: canvas.x + canvas.width * rx, y: canvas.y + canvas.height * ry };
      const onDrill = p.x >= drill.x && p.x <= drill.x + drill.w && p.y >= drill.y && p.y <= drill.y + drill.h;
      expect(onDrill, `${where} はドリルの的の外`).toBe(false);
      const h0 = hitsOf(await g.getState());
      await page.mouse.click(p.x, p.y);
      await page.clock.fastForward(150); // 連打の上限の窓（8 回/秒）に掛からないように
      expect(hitsOf(await g.getState()) - h0, `${where} を押すと 1 打`).toBe(1);
    }
  });
});

// BL-101: 別オリジンの枠（実際のポータルと同じ。親 localhost → ゲーム 127.0.0.1）。
// 許可リストに足すのは親ページのオリジンだけ（ゲームのオリジンは既定で入っている）。親ページは page.route で返すので外には
// 出ないが、harness は要求を記録するので、足さないと共通の検査（TS-COM-01）で落ちる。ゲームの側の要求の検査はそのまま効く
test.describe('BL-012 掘削の入力（別オリジンの枠。BL-101）', () => {
  test.use({
    allowedOrigins: async ({ baseURL }, use) => {
      if (!baseURL) throw new Error('baseURL がありません（playwright.config.ts）');
      await use([new URL(baseURL).origin, crossOriginParent(baseURL).parentOrigin]);
    },
  });

  test('TS-012-26 (a) 別オリジンの枠: ゲームの HUD を押してフォーカスした後の Space・矢印キーが preventDefault され、親の scrollY が変わらない', async ({
    page,
    baseURL,
    browserName,
  }) => {
    await keysInPortal(page, (frame) => clickInFrame(page, frame, 'hud-coins'), { crossOrigin: crossOriginParent(baseURL!) }, async (frame) => {
      await expectCrossOrigin(page, frame, browserName);
      await expectFrameMonitored(frame);
    });
  });

  test('TS-012-26 (b) 別オリジンの枠: 遊ぶ場所（ステージ）を押してフォーカスした後の Space・矢印キーが preventDefault され、親の scrollY が変わらない', async ({
    page,
    baseURL,
    browserName,
  }) => {
    await keysInPortal(page, (frame) => clickInFrame(page, frame, 'stage', 0.75), { crossOrigin: crossOriginParent(baseURL!) }, async (frame) => {
      await expectCrossOrigin(page, frame, browserName);
      await expectFrameMonitored(frame);
    });
  });

  test('TS-012-27 別オリジンの枠: HUD のボタンにフォーカスがある状態でステージを押すと blur され、Enter でボタンが押し直されず、Space で掘れる（PR #7 N-3）', async ({
    page,
    baseURL,
    browserName,
  }) => {
    const { frame, g } = await openGameInFrame(page, { ...PORTAL, crossOrigin: crossOriginParent(baseURL!) });
    await expectCrossOrigin(page, frame, browserName);
    await expectFrameMonitored(frame);
    await page.evaluate((y) => window.scrollTo(0, y), START_Y);
    expect(await settledScrollY(page)).toBe(START_Y);
    const activeTestId = (): Promise<string | null> =>
      frame.evaluate(() => {
        const a = document.activeElement;
        return a === document.body ? 'BODY' : (a?.getAttribute('data-testid') ?? a?.tagName ?? null);
      });
    const drillLevel = async (): Promise<number> => (await g.getState()).run.drill.level;

    // ドリルを何度も買えるコインを入れる
    await g.grant({ coins: '1e6' });
    const buy = frame.getByTestId('buy-drill');
    await expect(buy).toHaveAttribute('data-state', 'affordable');
    const lv0 = await drillLevel();
    // 購入ボタンは枠の右側のパネルにあり、モバイルの狭い画面（390px）では見えないので、locator で画面に入れてから押す。
    // そのとき親がスクロールしうるので、押した後に START_Y へ戻す（フォーカスは動かない）
    await buy.click();
    await expect.poll(drillLevel).toBe(lv0 + 1);
    await page.evaluate((y) => window.scrollTo(0, y), START_Y);
    expect(await settledScrollY(page)).toBe(START_Y);
    // 前提: そのボタンにフォーカスがある（ボタンを押してもフォーカスが移らないブラウザでは、キーボードで移ったのと同じ状態にする）
    if ((await activeTestId()) !== 'buy-drill') {
      test.info().annotations.push({ type: '前提', description: 'ボタンを押してもフォーカスが移らないブラウザなので focus() で移した' });
      await buy.focus();
    }
    expect(await activeTestId(), '前提: 購入ボタンにフォーカスがある').toBe('buy-drill');
    // 対照: フォーカスのあるボタンは Enter で押される（Enter で買えることの確認。偽の緑を防ぐ）
    await page.keyboard.press('Enter');
    await expect.poll(drillLevel, '対照: Enter でフォーカスのある購入ボタンが押される').toBe(lv0 + 2);
    expect(await activeTestId()).toBe('buy-drill');

    // ステージを押す → ボタンから blur される（枠の activeElement が body）・枠にフォーカスがある
    const h0 = hitsOf(await g.getState());
    await clickInFrame(page, frame, 'stage', 0.75);
    expect(await activeTestId(), 'ステージを押すとボタンから blur される').toBe('BODY');
    expect(await frame.evaluate(() => document.hasFocus())).toBe(true);
    expect(hitsOf(await g.getState()), 'ステージを押した 1 打').toBe(h0 + 1);

    // Enter でボタンが押し直されない（レベルが変わらない・コインが購入で減らない）
    const before = await g.getState();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300); // 押し直されるなら、この間に onClick → dispatch が動く（対照では同じ待ちの中で買えた）
    const after = await g.getState();
    expect(after.run.drill.level, 'Enter で購入ボタンが押し直されない').toBe(before.run.drill.level);
    expect(coinsOf(after), 'コインが購入で減らない').toBeGreaterThanOrEqual(coinsOf(before));
    expect(await settledScrollY(page)).toBe(START_Y);

    // Space で掘れる・親はスクロールしない
    await page.keyboard.press('Space');
    await expect.poll(async () => hitsOf(await g.getState()), 'Space で打撃が増える').toBeGreaterThan(hitsOf(after));
    expect(await settledScrollY(page), 'Space の後の親の scrollY').toBe(START_Y);
    const rec = await recordedKeydowns(frame);
    expect(rec.filter((k) => k.code === 'Space' && !k.prevented), 'Space の keydown は preventDefault 済み').toEqual([]);
  });
});
