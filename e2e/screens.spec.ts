// PoC-5: ゲーム内のスクリーンショット（CEO の見た目の確認用）。SHOTS_DIR に保存する
import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { waitReady } from './helpers.ts';

const DIR = process.env.SHOTS_DIR ?? 'perf-results/screens';
mkdirSync(DIR, { recursive: true });

async function tapStage(page: Page, n: number): Promise<void> {
  const box = await page.getByTestId('stage').boundingBox();
  if (!box) throw new Error('no stage');
  for (let i = 0; i < n; i++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.waitForTimeout(120);
  }
}

/** ロジックだけ進めて深い地層へ（フックを使う） */
async function digTo(page: Page, depth: number): Promise<void> {
  await page.evaluate((target) => {
    const g = (window as unknown as { __game: { getState(): { run: { depth: number; drill: { level: number; tool: number } } }; dispatch(a: unknown): unknown; advance(ms: number): unknown } }).__game;
    const s = g.getState();
    s.run.drill.level = 45;
    s.run.drill.tool = 3;
    g.dispatch({ type: 'setAutoDig', on: true });
    for (let i = 0; i < 2000 && s.run.depth < target; i++) g.advance(1000);
    g.dispatch({ type: 'setAutoDig', on: false });
  }, depth);
  await page.waitForTimeout(1500);
}

const cases = [
  { name: 'landscape-1280x720', w: 1280, h: 720, dpr: 1 },
  { name: 'portrait-390x844-dpr3', w: 390, h: 844, dpr: 3 },
] as const;

for (const lang of ['ja-JP', 'en-US'] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang });
    for (const c of cases) {
      test(`${c.name}`, async ({ browser }) => {
        const ctx = await browser.newContext({ locale: lang, viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr });
        const page = await ctx.newPage();
        await page.goto('/?seed=3');
        await waitReady(page);
        await page.waitForTimeout(800);
        await tapStage(page, 12);
        await page.waitForTimeout(60);
        await page.screenshot({ path: `${DIR}/poc5-${c.name}-surface-${lang.slice(0, 2)}.png` });
        await digTo(page, 78);
        await tapStage(page, 6);
        await page.waitForTimeout(60);
        await page.screenshot({ path: `${DIR}/poc5-${c.name}-strata-${lang.slice(0, 2)}.png` });
        await ctx.close();
      });
    }
  });
}
