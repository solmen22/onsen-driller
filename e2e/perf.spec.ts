// PoC-1: Phaser 4 のキャンバス＋Preact の DOM の重ね合わせの性能と堅さ（arch §23）
// 結果は perf-results/poc1-<label>.json に書く。PERF_SECONDS で計測の秒数を変えられる（既定 60）
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { hook, waitReady, type PerfStats } from './helpers.ts';

const SECONDS = Number(process.env.PERF_SECONDS ?? 60);
const LABEL = process.env.PERF_LABEL ?? 'headless';
const CPU = Number(process.env.PERF_CPU ?? 4);
const OUT = 'perf-results';
const results: Record<string, unknown> = { label: LABEL, seconds: SECONDS, at: new Date().toISOString() };

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/poc1-${LABEL}.json`, JSON.stringify(results, null, 2));
});

async function throttle(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}

async function measure(page: Page, seconds: number): Promise<PerfStats & { particles: number; depth: number }> {
  await page.waitForTimeout(3000); // ウォームアップ
  await hook(page, 'g.perf.reset()');
  let maxParticles = 0;
  for (let t = 0; t < seconds; t += 5) {
    await page.waitForTimeout(5000);
    maxParticles = Math.max(maxParticles, await hook<number>(page, 'g.view.particles()'));
  }
  const s = await hook<PerfStats>(page, 'g.perf.stats()');
  const depth = await hook<number>(page, 'g.getState().run.depth');
  return { ...s, particles: maxParticles, depth };
}

test('環境', async ({ page, browserName }) => {
  await page.goto('/');
  await waitReady(page);
  results.env = {
    browserName,
    ua: await page.evaluate(() => navigator.userAgent),
    renderer: await hook<string>(page, 'g.view.renderer()'),
    dpr: await page.evaluate(() => devicePixelRatio),
    cores: await page.evaluate(() => navigator.hardwareConcurrency),
  };
  console.log('env', JSON.stringify(results.env));
});

test('デスクトップ（遅延なし）横 1280x720・パーティクル 200・自動掘り', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?particles=200&auto=1');
  await waitReady(page);
  const s = await measure(page, Math.min(SECONDS, 20));
  results.desktop = s;
  console.log('desktop', JSON.stringify(s));
  expect(s.fps).toBeGreaterThan(30);
});

for (const vp of [
  { name: 'cpu4x-landscape', width: 1280, height: 720 },
  { name: 'cpu4x-portrait', width: 390, height: 844 },
]) {
  test(`CPU 4 倍遅延 ${vp.name} ${vp.width}x${vp.height}・パーティクル 200・ロジック 10Hz・UI 5Hz`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?particles=200&auto=1');
    await waitReady(page);
    const cdp = await throttle(page, CPU);
    const s = await measure(page, SECONDS);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results[vp.name] = { cpuRate: CPU, ...s };
    console.log(vp.name, JSON.stringify(s));
    expect(s.p95).toBeLessThanOrEqual(33.4);
  });
}

test('CPU 4 倍遅延でのタップの反応（入力 → 描画の完了）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?particles=200');
  await waitReady(page);
  const cdp = await throttle(page, 4);
  await page.waitForTimeout(2000);
  await hook(page, 'g.perf.reset()');
  const box = await page.getByTestId('stage').boundingBox();
  if (!box) throw new Error('no stage');
  for (let i = 0; i < 30; i++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.waitForTimeout(350);
  }
  const s = await hook<PerfStats>(page, 'g.perf.stats()');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  results.tapLatency = s.latency;
  console.log('tap latency', JSON.stringify(s.latency));
  expect(s.latency.n).toBeGreaterThanOrEqual(25);
  expect(s.latency.p95).toBeLessThan(100);
});

test('回転と大きさの変更で崩れない', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const sizes = [
    { w: 390, h: 844, layout: 'portrait' },
    { w: 844, h: 390, layout: 'landscape' },
    { w: 800, h: 450, layout: 'landscape' },
    { w: 1920, h: 1080, layout: 'landscape' },
    { w: 360, h: 640, layout: 'portrait' },
    { w: 390, h: 844, layout: 'portrait' },
  ];
  const checks: unknown[] = [];
  for (const sz of sizes) {
    await page.setViewportSize({ width: sz.w, height: sz.h });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const canvas = document.querySelector('#stage canvas');
      const app = document.getElementById('app');
      const tabs = [...document.querySelectorAll('[data-testid^="tab-"]')].map((e) => e.getBoundingClientRect());
      const panel = document.querySelector('[data-testid="panel"]')?.getBoundingClientRect();
      return {
        layout: app?.dataset.layout,
        stage: stage ? [stage.clientWidth, stage.clientHeight] : null,
        canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
        overflowX: document.documentElement.scrollWidth > innerWidth,
        overflowY: document.documentElement.scrollHeight > innerHeight,
        tabsInside: tabs.every((b) => b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5),
        minTab: Math.min(...tabs.map((b) => Math.min(b.width, b.height))),
        panel: panel ? [Math.round(panel.width), Math.round(panel.height)] : null,
      };
    });
    checks.push({ ...sz, ...r });
    expect(r.layout).toBe(sz.layout);
    // ステージの大きさは小数になりうる（44% など）ので、キャンバスとの差は 1px まで許す
    expect(Math.abs((r.canvas?.[0] ?? 0) - (r.stage?.[0] ?? -9))).toBeLessThanOrEqual(1);
    expect(Math.abs((r.canvas?.[1] ?? 0) - (r.stage?.[1] ?? -9))).toBeLessThanOrEqual(1);
    expect(r.overflowX).toBe(false);
    expect(r.overflowY).toBe(false);
    expect(r.tabsInside).toBe(true);
    expect(r.minTab).toBeGreaterThanOrEqual(44);
  }
  results.resize = checks;
});

test('WebGL のコンテキストの喪失から戻る', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?auto=1');
  await waitReady(page);
  await page.waitForTimeout(1000);
  const before = await hook<number>(page, 'g.view.snapshotColors()');
  const lost = await hook<boolean>(page, 'g.view.loseContext()');
  await page.waitForTimeout(1000);
  const frameLost = await hook<number>(page, 'g.view.frame()');
  await hook(page, 'g.view.restoreContext()');
  await page.waitForTimeout(2000);
  const frameAfter = await hook<number>(page, 'g.view.frame()');
  const events = await hook<string[]>(page, 'g.view.contextEvents()');
  const after = await hook<number>(page, 'g.view.snapshotColors()');
  await page.screenshot({ path: `${OUT}/poc1-after-context-restore.png` });
  results.contextLoss = { lost, events, colorsBefore: before, colorsAfter: after, framesAdvancedAfterRestore: frameAfter - frameLost };
  console.log('context', JSON.stringify(results.contextLoss));
  expect(lost).toBe(true);
  expect(events).toEqual(['lost', 'restored']);
  expect(frameAfter).toBeGreaterThan(frameLost);
  expect(after).toBeGreaterThan(5);
});
