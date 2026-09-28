// PoC-3（任意）: 実物のポータル SDK を localhost で読み込み、アダプタ越しに呼べるか。
// 実行: PW_DIST=dist/e2e-crazygames PW_HOST=localhost npx playwright test e2e/sdk-live.spec.ts -g crazygames
//       PW_DIST=dist/e2e-poki       PW_HOST=localhost npx playwright test e2e/sdk-live.spec.ts -g poki
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { hook, waitReady } from './helpers.ts';

const dist = process.env.PW_DIST ?? '';

for (const name of ['crazygames', 'poki'] as const) {
  test(`${name}: 実物の SDK を localhost で呼ぶ`, async ({ page }) => {
    test.skip(!dist.includes(name), `PW_DIST=${dist}`);
    const hosts = new Set<string>();
    const consoleLines: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.hostname !== 'localhost') hosts.add(u.hostname);
    });
    page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 200)));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await waitReady(page);
    const box = await page.getByTestId('stage').boundingBox();
    if (!box) throw new Error('no stage');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
    const available = await hook<boolean>(page, 'g.platform.rewardedAvailable()');
    const rewarded = await Promise.race([
      hook<string>(page, "g.platform.showRewarded('R2')"),
      page.waitForTimeout(45_000).then(() => 'timeout(45s)'),
    ]);
    await page.screenshot({ path: `perf-results/poc3-${name}-after-rewarded.png` });
    const midgame = await Promise.race([
      hook<string>(page, "g.platform.breakOpportunity('M1')").then(() => 'resolved'),
      page.waitForTimeout(45_000).then(() => 'timeout(45s)'),
    ]);
    const calls = await hook<{ name: string; arg?: string }[]>(page, 'g.platform.calls()');
    const result = { name, available, rewarded, midgame, calls, externalHosts: [...hosts], console: consoleLines.slice(0, 40) };
    mkdirSync('perf-results', { recursive: true });
    writeFileSync(`perf-results/poc3-live-${name}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ name, available, rewarded, midgame, externalHosts: [...hosts] }));
    expect(calls.some((c) => c.name === 'gameplayStart')).toBe(true);
  });
}
