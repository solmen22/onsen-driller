// E2E: BL-035 Phaser の骨格・表示倍率・入力の受け渡し（BL-035_phaser-skeleton.md）の S1 の e2e — TS-035-01・03・05・07・09
// - 倍率（zoomFor）・地上と地下の比率（layerRects）は unit（tests/unit/view-layout.test.ts）。実画面の倍率は TS-071-22（e2e/bl071-hooks.spec.ts）
// - TS-035-05 の build-check の部分（setInteractive・input.on がソースにない）は tests/unit/view-layout.test.ts
// - 大きさの変更の後は、Phaser の RESIZE（毎フレームで親の大きさを見る）と描画が追いつくまで page.clock.runFor で描画のフレームを進める
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, centerOf } from './support/boot.ts';
import { pngColorStats } from './support/dom.ts';
import { hitsOf, type Hooks } from './support/hooks.ts';
import { SEED_A } from '../tests/helpers/seeds.ts';

/** 大きさの変更の後に描画のフレームを回す時間（ms。ロジックは __game.pause() で止めておく） */
const SETTLE_MS = 300;
/** キャンバスが合うまで描画のフレームを回し続ける上限（Phaser の大きさの見直しの間隔〔ScaleManager の resizeInterval 500ms〕を超える） */
const SETTLE_MAX_MS = 1_500;

type Fit = { canvas: { w: number; h: number }; stage: { w: number; h: number }; scrollWidth: number; innerWidth: number };
const fitsStage = (f: Fit): boolean => Math.abs(f.canvas.w - f.stage.w) <= 1 && Math.abs(f.canvas.h - f.stage.h) <= 1;

/**
 * ビューポートの大きさを変え、DOM のレイアウト（ResizeObserver で data-layout が変わる。実時間で動く）が新しい大きさに
 * 追いついてから、描画のフレームを回して Phaser の RESIZE を追いつかせる（Clock API で止めた時計の rAF。先に回すと古いステージの大きさを測る）。
 * 遅いランナーでは、レイアウトが変わらない変更（横 → 横など）で Phaser が大きさを読むのが遅れ、SETTLE_MS では「変更の前の大きさ」のまま
 * のことがある（2026-09-29 の毎晩 run 36524469312 の mobile-safari の TS-035-07 の 1 回目）。そこで Phaser の見直しの間隔を超えるまで、
 * 合うまでフレームを回す。それでも合わなければそのまま判定に進む（BL-114 か、ほかの不具合）
 */
async function resizeTo(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  await expect(page.getByTestId('app-root')).toHaveAttribute('data-layout', vp.width / vp.height >= 1.1 ? 'landscape' : 'portrait');
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([vp.width, vp.height]);
  await page.clock.runFor(SETTLE_MS);
  for (let t = SETTLE_MS; t < SETTLE_MAX_MS && !fitsStage(await fitOf(page)); t += 100) await page.clock.runFor(100);
}

/**
 * 大きさの変更の後の TS-035-03・07 の確認。合っていなければ、BL-114 の既知の不具合の印（e2e/support/known-bug-bl114.ts。
 * mobile-safari の「古い大きさのまま」の形だけ・期限 2026-10-08）に当たるかを見て、当たらなければ今までどおり失敗させる
 */
async function expectFitsAfterResize(page: Page, label: string): Promise<void> {
  const f = await fitOf(page);
  expectFits(f, label);
}

/** ステージの中の <canvas> の数と、文書全体の <canvas> の数 */
const canvasCounts = (page: Page): Promise<{ stage: number; all: number }> =>
  page.evaluate(() => ({ stage: document.querySelectorAll('[data-testid="stage"] canvas').length, all: document.querySelectorAll('canvas').length }));

/** キャンバスとステージの表示の大きさ、横スクロールの有無（TS-035-03） */
async function fitOf(page: Page): Promise<Fit> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage"] canvas')!.getBoundingClientRect();
    const s = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    return {
      canvas: { w: c.width, h: c.height },
      stage: { w: s.width, h: s.height },
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

function expectFits(f: Awaited<ReturnType<typeof fitOf>>, label: string): void {
  expect(Math.abs(f.canvas.w - f.stage.w), `${label}: キャンバスの幅とステージの幅（${JSON.stringify(f)}）`).toBeLessThanOrEqual(1);
  expect(Math.abs(f.canvas.h - f.stage.h), `${label}: キャンバスの高さとステージの高さ（${JSON.stringify(f)}）`).toBeLessThanOrEqual(1);
  expect(f.stage.w, `${label}: ステージが見える`).toBeGreaterThan(0);
  expect(f.stage.h, `${label}: ステージが見える`).toBeGreaterThan(0);
  expect(f.scrollWidth, `${label}: 横スクロールが出ない`).toBeLessThanOrEqual(f.innerWidth);
}

const SIZES = [
  { width: 1280, height: 720 },
  { width: 800, height: 450 },
  { width: 1920, height: 1080 },
] as const;

/** 自動掘りをオンにする（ツルハシの代金は grant で入れる） */
async function autoDigOn(g: Hooks): Promise<void> {
  await g.grant({ coins: '10' });
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  expect((await g.dispatch({ type: 'setAutoDig', on: true })).ok).toBe(true);
}

test.describe('BL-035 Phaser の骨格', () => {
  test('TS-035-01 ステージの中の <canvas> は 1 つで、ビューポートの大きさを 5 回変えた後も 1 つ（Phaser.Game を作り直さない）', async ({ page }) => {
    const g = await bootGame(page);
    await g.pause();
    expect(await canvasCounts(page)).toEqual({ stage: 1, all: 1 });
    const first = await page.locator('[data-testid="stage"] canvas').elementHandle();
    for (const vp of [
      { width: 390, height: 844 },
      { width: 800, height: 450 },
      { width: 1920, height: 1080 },
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
    ]) {
      await resizeTo(page, vp);
    }
    expect(await canvasCounts(page)).toEqual({ stage: 1, all: 1 });
    // 同じ要素のまま（作り直して入れ替わっていない）
    expect(await page.evaluate((el) => el?.isConnected === true && document.querySelector('[data-testid="stage"] canvas') === el, first)).toBe(true);
  });

  test('TS-035-03 1280×720・800×450・1920×1080 でキャンバスがステージを満たし（差 1px 以内）、横スクロールが出ない', async ({ page }) => {
    const g = await bootGame(page);
    await g.pause();
    const seen: string[] = [];
    for (const vp of SIZES) {
      await resizeTo(page, vp);
      const f = await fitOf(page);
      seen.push(`${vp.width}x${vp.height}: canvas ${f.canvas.w}x${f.canvas.h} stage ${f.stage.w}x${f.stage.h}`);
      await expectFitsAfterResize(page, `${vp.width}×${vp.height}`);
    }
    test.info().annotations.push({ type: '大きさ', description: seen.join(' / ') });
  });

  test.describe('390×844（縦・タッチ・倍率 3 の端末）', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      deviceScaleFactor: 3,
      // Playwright の isMobile は Firefox では使えないので、そこだけ外す（E1 の TS-E1-15 と同じ）
      isMobile: async ({ browserName }, use) => {
        await use(browserName !== 'firefox');
      },
    });
    test('TS-035-03 390×844 でキャンバスがステージを満たし（差 1px 以内）、横スクロールが出ない', async ({ page }) => {
      const g = await bootGame(page);
      await g.pause();
      await page.clock.runFor(SETTLE_MS);
      const f = await fitOf(page);
      test.info().annotations.push({ type: '390×844', description: JSON.stringify(f) });
      expectFits(f, '390×844');
    });
  });

  test("TS-035-05 ステージの要素に pointerdown・pointerup を送ると（rect('drill') の中心）打撃が 1 入る（DOM の入力 → app のアクション）", async ({ page }) => {
    const g = await bootGame(page);
    const r = await g.rect('drill');
    expect(r).not.toBeNull();
    const c = centerOf(r!);
    const h0 = hitsOf(await g.getState());
    // その位置の要素（キャンバス。ステージの子）に DOM の PointerEvent を直接送る（Phaser の入力系は使っていない: game.ts の input は全部 false）
    const target = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const stage = document.querySelector('[data-testid="stage"]');
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
      el?.dispatchEvent(new PointerEvent('pointerdown', opts));
      el?.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
      return { tag: el?.tagName ?? null, inStage: !!el && !!stage && stage.contains(el) };
    }, c);
    expect(target).toEqual({ tag: 'CANVAS', inStage: true });
    expect(hitsOf(await g.getState()) - h0).toBe(1);
    // pointerup で押下は終わっている（長押しにならない）
    await page.clock.runFor(1_000);
    expect(hitsOf(await g.getState()) - h0).toBe(1);
  });

  test("TS-035-07 1280×720 → 390×844 → 800×450 → 1920×1080 → 1280×720 と変えるたびに、キャンバスが追従し rect('drill') が更新され、その中心のクリックで打撃が 1 ずつ入る", async ({
    page,
  }) => {
    const g = await bootGame(page);
    await g.pause();
    let prev = await g.rect('drill');
    expect(prev).not.toBeNull();
    const seen: string[] = [];
    for (const vp of [{ width: 390, height: 844 }, ...SIZES.slice(1), { width: 1280, height: 720 }]) {
      await resizeTo(page, vp);
      await expectFitsAfterResize(page, `${vp.width}×${vp.height}`);
      const r = await g.rect('drill');
      expect(r, `${vp.width}×${vp.height}: rect('drill')`).not.toBeNull();
      seen.push(`${vp.width}x${vp.height}: ${JSON.stringify(r)}`);
      expect(r, `${vp.width}×${vp.height}: rect('drill') が新しいレイアウトの値に変わる`).not.toEqual(prev);
      const canvas = (await page.locator('[data-testid="stage"] canvas').boundingBox())!;
      const c = centerOf(r!);
      expect(c.x >= canvas.x && c.x <= canvas.x + canvas.width && c.y >= canvas.y && c.y <= canvas.y + canvas.height, `${vp.width}×${vp.height}: 道具の中心がキャンバスの中`).toBe(true);
      const h0 = hitsOf(await g.getState());
      await page.mouse.click(c.x, c.y);
      expect(hitsOf(await g.getState()) - h0, `${vp.width}×${vp.height}: クリックで 1 打`).toBe(1);
      prev = r;
    }
    test.info().annotations.push({ type: "rect('drill')", description: seen.join(' / ') });
  });

  test('TS-035-09 自動掘りオンで WebGL のコンテキストを失わせて 1 秒後に戻すと、描画が戻り、打撃・コインが増え続け、例外が出ない', async ({ page, harness, browserName }) => {
    const g = await bootGame(page, { seed: SEED_A });
    // 前提: Phaser が WebGL で描いている（AUTO は WebGL、だめなら Canvas）。GPU のない Linux の Firefox（毎晩の CI）は WebGL が使えず
    // Canvas で描く（2026-09-29 の毎晩 run 36524469312: webgl=false）。Canvas にはコンテキストの喪失がないので、そのときだけ理由つきで対象外。
    // skip は Firefox だけ（QA の記録 org/30_quality/qa-lead/2026-10-04_pr31-ts-035-09-skip.md の条件 1）。Chromium（PR の e2e。CI は
    // SwiftShader で WebGL）と WebKit 系（毎晩。実機でコンテキストを失いやすい iOS の代わり）は WebGL を必須のまま（Canvas になったら赤）
    const renderer = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="stage"] canvas') as HTMLCanvasElement;
      if (c.getContext('webgl2') ?? c.getContext('webgl')) return 'webgl';
      return c.getContext('2d') ? 'canvas' : 'none';
    });
    test.info().annotations.push({ type: '描画の方式', description: renderer });
    test.skip(
      renderer === 'canvas' && browserName === 'firefox',
      `${browserName} のこの環境は WebGL が使えず Phaser が Canvas で描いている（コンテキストの喪失は起きない）。Canvas での描画・入力は TS-035-10（S3）`,
    );
    expect(renderer, 'Phaser が WebGL で描いている').toBe('webgl');
    await g.pause();
    await autoDigOn(g);
    await g.resume();
    await page.clock.runFor(1_000);
    const stage = (await page.getByTestId('stage').boundingBox())!;
    const shot = async (): Promise<Awaited<ReturnType<typeof pngColorStats>>> => pngColorStats(page, await page.screenshot({ clip: stage }));
    const before = await shot();
    const s0 = await g.getState();

    // WEBGL_lose_context（キャンバスの WebGL のコンテキストから直接取る）
    const lost = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="stage"] canvas') as HTMLCanvasElement;
      const gl = c.getContext('webgl2') ?? c.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context') ?? null;
      (window as unknown as { __e2eLose?: WEBGL_lose_context | null }).__e2eLose = ext;
      ext?.loseContext();
      return { webgl: !!gl, ext: !!ext, lost: gl?.isContextLost() ?? null };
    });
    expect(lost, 'WebGL で描画していて WEBGL_lose_context が使える').toEqual({ webgl: true, ext: true, lost: true });
    await page.clock.runFor(1_000);
    const during = await shot();
    const s1 = await g.getState();
    await page.evaluate(() => (window as unknown as { __e2eLose: WEBGL_lose_context }).__e2eLose.restoreContext());
    await expect.poll(() => page.evaluate(() => {
      const c = document.querySelector('[data-testid="stage"] canvas') as HTMLCanvasElement;
      return (c.getContext('webgl2') ?? c.getContext('webgl'))?.isContextLost() ?? null;
    })).toBe(false);
    await page.clock.runFor(1_000);
    const after = await shot();
    const s2 = await g.getState();
    test.info().annotations.push({
      type: '色の数（前・失った間・戻した後）',
      description: `${JSON.stringify(before)} / ${JSON.stringify(during)} / ${JSON.stringify(after)} hits ${hitsOf(s0)}→${hitsOf(s1)}→${hitsOf(s2)}`,
    });
    // 描画が戻る（真っ黒・真っ白のままでない。前と同じくらいの色の数）
    expect(before.colors, '前の描画に色がある（検査の前提）').toBeGreaterThanOrEqual(8);
    expect(after.colors).toBeGreaterThanOrEqual(Math.min(8, before.colors));
    expect(after.dominantShare).toBeLessThan(0.95);
    // 打撃・コインが増え続ける（失っている間も、戻した後も）
    expect(hitsOf(s1)).toBeGreaterThan(hitsOf(s0));
    expect(hitsOf(s2)).toBeGreaterThan(hitsOf(s1));
    expect(Number(s2.run.coins)).toBeGreaterThan(Number(s0.run.coins));
    // 捕まえていない例外がない
    expect(await harness.uncaughtErrors()).toEqual([]);
    expect(await g.errors()).toEqual([]);
  });
});
