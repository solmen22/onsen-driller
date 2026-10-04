// E2E: BL-114（S2）の再発防止 — 回転（縦 ↔ 横）の後にキャンバスが古い大きさのまま残らない
// - 決まって再現する手順（BACKLOG の BL-114 の受け入れ基準 1）: ビューポートの縦横を入れ替え、レイアウトの切り替え
//   （ui/layout.ts の ResizeObserver で data-layout が変わる）を待ってから screen.orientation に change を送り、900ms 待つ
// - Phaser 4.2.1 の ScaleManager は orientation の change で親の大きさを測り直さずに描き直すので、この順番だと修正
//   （src/view/parent-size.ts のステージの見張り）がなければ毎回ずれる（手元: 修正なし 10/10 がずれ、修正あり 0/10）
// - ときどき起きる形の確認は TS-035-03・07（e2e/bl035-phaser.spec.ts）。こちらは順番を固定して、修正を外すと必ず赤にする
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';

/** 受け入れ基準の待ち時間（ms。描画のフレームは page.clock で進める） */
const WAIT_MS = 900;

/** 縦横を入れ替える組（スマホの縦 390×844 ↔ 横 844×390）を 3 往復 */
const PORTRAIT = { width: 390, height: 844 } as const;
const LANDSCAPE = { width: 844, height: 390 } as const;
const ROUND_TRIPS = 3;

type Fit = { canvas: { w: number; h: number }; stage: { w: number; h: number }; scrollWidth: number; innerWidth: number };

const fitOf = (page: Page): Promise<Fit> =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="stage"] canvas')!.getBoundingClientRect();
    const s = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
    return {
      canvas: { w: c.width, h: c.height },
      stage: { w: s.width, h: s.height },
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });

const fitsStage = (f: Fit): boolean => Math.abs(f.canvas.w - f.stage.w) <= 1 && Math.abs(f.canvas.h - f.stage.h) <= 1;

/** ブラウザが回転のときに送るイベント（screen.orientation の change。無いブラウザは window の orientationchange。Phaser と同じ選び方） */
const dispatchOrientationChange = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const o = screen.orientation as ScreenOrientation | undefined;
    if (o && typeof o.addEventListener === 'function') o.dispatchEvent(new Event('change'));
    else window.dispatchEvent(new Event('orientationchange'));
  });

test.describe('BL-114 回転の後のキャンバスの大きさ', () => {
  test('BL-114 縦横を変え、data-layout が変わった後に orientation の change が届いても、900ms 後にキャンバスがステージに合う（3 往復）', async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    const g = await bootGame(page);
    await g.pause();
    const seen: string[] = [];
    for (let i = 0; i < ROUND_TRIPS * 2; i++) {
      const vp = i % 2 === 0 ? LANDSCAPE : PORTRAIT;
      const label = `${i + 1} 回目 ${vp.width}×${vp.height}`;
      await page.setViewportSize(vp);
      // レイアウトの切り替え（data-layout）が先に済んでから、orientation の change を送る（不具合が出る順番）
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-layout', vp.width > vp.height ? 'landscape' : 'portrait');
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([vp.width, vp.height]);
      await dispatchOrientationChange(page);
      await page.clock.runFor(WAIT_MS);
      // ResizeObserver の通知は描画の更新の時点で届く（page.clock では進まない）ので、実時間で少しだけ待つ。
      // 修正がなければ次の resize まで古い大きさのままなので、ここで待っても合わない
      let f = await fitOf(page);
      for (let t = 0; t < 10 && !fitsStage(f); t++) {
        await page.waitForTimeout(50);
        f = await fitOf(page);
      }
      seen.push(`${label}: canvas ${f.canvas.w}x${f.canvas.h} stage ${f.stage.w}x${f.stage.h}`);
      expect(Math.abs(f.canvas.w - f.stage.w), `${label}: キャンバスの幅とステージの幅（${JSON.stringify(f)}）`).toBeLessThanOrEqual(1);
      expect(Math.abs(f.canvas.h - f.stage.h), `${label}: キャンバスの高さとステージの高さ（${JSON.stringify(f)}）`).toBeLessThanOrEqual(1);
      expect(f.stage.w * f.stage.h, `${label}: ステージが見える`).toBeGreaterThan(0);
      expect(f.scrollWidth, `${label}: 横スクロールが出ない`).toBeLessThanOrEqual(f.innerWidth);
    }
    test.info().annotations.push({ type: '大きさ', description: seen.join(' / ') });
  });
});
