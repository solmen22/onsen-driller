// E2E: BL-049 チュートリアル（gdd §12）— 段 1 の指の印、段 2 の吹き出しと光る枠、OK で済んだ段は読み直しても出ない、
// 吹き出しが下端のボタン（自動掘り・ブースト）に重ならず、横スクロールが出ない（320×568・390×844・800×450 × ja・en）
// - 段の契機・済み・設定で消すは integration（tests/integration/ui-tutorial.test.ts）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame } from './support/boot.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(450); // runFor は requestAnimationFrame も進める（Preact の useEffect）

/** 2 つの要素の矩形が重なるか */
async function overlaps(page: Page, a: string, b: string): Promise<boolean> {
  return page.evaluate(
    ([x, y]) => {
      const ra = document.querySelector(`[data-testid="${x}"]`)!.getBoundingClientRect();
      const rb = document.querySelector(`[data-testid="${y}"]`)!.getBoundingClientRect();
      return ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom;
    },
    [a, b],
  );
}

test('BL-049: 起動直後に指の印、1 打で消える。コイン 3 で段 2（ツルハシが光る）、OK で済み、読み直しても出ない', async ({ harness }) => {
  const page = await harness.newPage({ locale: 'en-US' });
  const g = await bootGame(page);
  await expect(page.getByTestId('tutorial-finger')).toBeVisible();
  await g.pause();
  await g.advance(1_000, { tapsPerSec: 2 });
  await uiTick(page);
  await expect(page.getByTestId('tutorial-finger')).toHaveCount(0);
  await g.grant({ coins: '3' });
  await uiTick(page);
  await expect(page.getByTestId('tutorial-bubble')).toHaveAttribute('data-step', '2');
  await expect(page.getByTestId('buy-tool')).toHaveAttribute('data-tutorial-glow', 'true');
  await page.getByTestId('tutorial-ok').click();
  await uiTick(page);
  await expect(page.getByTestId('tutorial-bubble')).toHaveCount(0);
  const g2 = await reloadGame(page); // 再読み込みの pagehide で保存される
  await uiTick(page);
  await expect(page.getByTestId('tutorial-bubble')).toHaveCount(0);
  await expect(page.getByTestId('tutorial-finger')).toHaveCount(0);
  expect((await g2.getState()).tutorial).toMatchObject({ step: 2 });
  expect(await g2.errors()).toEqual([]);
});

for (const vp of [
  { name: '320×568（縦）', width: 320, height: 568, touch: true },
  { name: '390×844（縦）', width: 390, height: 844, touch: true },
  { name: '800×450（横）', width: 800, height: 450, touch: false },
]) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`BL-049 ${vp.name}・${locale}: いちばん長い吹き出し（段 8）が下端のボタンに重ならず、横スクロールがなく、OK が 44px 以上`, async ({ harness }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
      const g = await bootGame(page);
      await g.pause();
      const s = await g.getState();
      (s.stats as unknown as { bestDepth: number; hits: number }).bestDepth = 160;
      (s.stats as unknown as { hits: number }).hits = 10;
      await g.setState(s);
      await uiTick(page);
      await expect(page.getByTestId('tutorial-bubble')).toHaveAttribute('data-step', '8');
      await expect(page.getByTestId('tab-4')).toHaveAttribute('data-alert', 'true');
      for (const other of ['toggle-auto-dig', 'btn-boost', 'hud']) expect(await overlaps(page, 'tutorial-bubble', other), `吹き出しと ${other}`).toBe(false);
      const m = await page.evaluate(() => {
        const ok = document.querySelector('[data-testid="tutorial-ok"]')!.getBoundingClientRect();
        const text = document.querySelector<HTMLElement>('.tutorial-text')!;
        return {
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          ok: [ok.width, ok.height],
          textOverflow: text.scrollWidth > text.clientWidth,
        };
      });
      expect(m.docOverflow).toBe(false);
      expect(m.textOverflow).toBe(false);
      expect(Math.min(...m.ok)).toBeGreaterThanOrEqual(44);
      expect(await g.errors()).toEqual([]);
    });
  }
}
