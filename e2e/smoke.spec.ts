// スモーク: 起動・コンソールのエラーなし・タップで掘れる・外部への通信なし
import { expect, test } from '@playwright/test';
import { hook, waitReady } from './helpers.ts';

test('起動してタップで掘れる', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'blob:' || u.protocol === 'data:') return;
    if (u.hostname !== '127.0.0.1') external.push(r.url());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await waitReady(page);
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.locator('#stage canvas')).toBeVisible();
  const before = await hook<number>(page, 'g.getState().stats.hits');
  const box = await page.getByTestId('stage').boundingBox();
  if (!box) throw new Error('no stage');
  for (let i = 0; i < 5; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
  const after = await hook<number>(page, 'g.getState().stats.hits');
  expect(after - before).toBeGreaterThanOrEqual(5);
  expect(await hook<string>(page, 'g.view.renderer()')).toMatch(/WebGL|Canvas/);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  const cookies = await page.context().cookies();
  expect(cookies).toEqual([]);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  for (const k of keys) expect(k.startsWith('onsen-driller:')).toBe(true);
});
