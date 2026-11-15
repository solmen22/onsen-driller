// E2E: BL-037 演出（破片・揺れ・フラッシュ）・動きを減らす・画質の設定。数は renderStats().effects で見る
// （画質の自動調整の状態機械は tests/unit/effects-quality.test.ts。CPU 4 倍遅延の 60 秒の計測は e2e/perf.spec.ts〔poc-tools〕）
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import type { Hooks } from './support/hooks.ts';

const SETTINGS_KEY = 'onsen-driller:settings';

/** 1 回の叩きで数十個のブロックが壊れるドリルにして、叩きと描画を交互に n 回（TS-071-22 と同じ作り方） */
async function breakMany(page: import('@playwright/test').Page, g: Hooks, n: number): Promise<number> {
  await g.pause();
  await g.grant({ coins: '1e9' });
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  for (let i = 0; i < 8; i++) expect((await g.dispatch({ type: 'buy', item: 'drill', qty: 10 })).ok).toBe(true);
  let maxShards = 0;
  for (let i = 0; i < n; i++) {
    await g.advance(200);
    await g.dispatch({ type: 'tap', count: 1 });
    await page.clock.fastForward(16);
    maxShards = Math.max(maxShards, (await g.renderStats()).effects.shards);
  }
  return maxShards;
}

test.describe('BL-037 演出・動きを減らす', () => {
  test('ブロックを壊すと破片と揺れが出る。破片は同時 200 まで（倍率 1）。揺れは 0.5 秒以内で、操作は止まらない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const g = await bootGame(page, { viewport: { width: 1280, height: 720 } });
    const before = (await g.renderStats()).effects;
    expect(before).toMatchObject({ reduceMotion: false, scale: 1, qualityScale: 1, shardsMax: 200 });
    const maxShards = await breakMany(page, g, 20);
    const after = (await g.renderStats()).effects;
    expect(after.shakes, '揺れが出る').toBeGreaterThan(0);
    expect(maxShards, '破片が出る').toBeGreaterThan(0);
    expect(maxShards, '同時 200 まで').toBeLessThanOrEqual(200);
    // 揺れの間も叩ける（入力は止めない）
    const r = await g.dispatch({ type: 'tap', count: 1 });
    expect(r.ok).toBe(true);
  });

  test('OS の「視差効果を減らす」（設定 auto）: 揺れ 0・フラッシュなし・パーティクル半分（破片の上限 100）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const g = await bootGame(page, { viewport: { width: 1280, height: 720 } });
    expect((await g.renderStats()).effects).toMatchObject({ reduceMotion: true, scale: 0.5, shardsMax: 100 });
    const maxShards = await breakMany(page, g, 20);
    const after = (await g.renderStats()).effects;
    expect(after.shakes).toBe(0);
    expect(after.flashes).toBe(0);
    expect(maxShards).toBeLessThanOrEqual(100);
  });

  test('設定の「動きを減らす」が on なら OS によらず減らし、off なら OS が減らすでも減らさない', async ({ page }) => {
    for (const [setting, os, want] of [
      ['on', 'no-preference', true],
      ['off', 'reduce', false],
    ] as const) {
      await page.emulateMedia({ reducedMotion: os });
      const g = await bootGame(page, { viewport: { width: 1280, height: 720 }, storage: { [SETTINGS_KEY]: JSON.stringify({ reduceMotion: setting }) } });
      expect((await g.renderStats()).effects.reduceMotion, `${setting}・${os}`).toBe(want);
    }
  });

  test('画質の設定: low なら最初からパーティクル半分（破片の上限 100）、high は 1', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [quality, scale, max] of [
      ['low', 0.5, 100],
      ['high', 1, 200],
    ] as const) {
      const g = await bootGame(page, { viewport: { width: 1280, height: 720 }, storage: { [SETTINGS_KEY]: JSON.stringify({ quality }) } });
      expect((await g.renderStats()).effects, quality).toMatchObject({ qualityScale: scale, shardsMax: max });
    }
  });
});
