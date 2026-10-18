// @vitest-environment jsdom
// BL-056: dev のデバッグパネル（app/dev-panel.ts。arch §12-2）を jsdom で確かめる。
// 状態の表示・時間を進める・付与・偽の広告の結果の切り替えと、URL の ?debug（app/dev-params.ts）
import { afterEach, describe, expect, it } from 'vitest';
import { mountDevPanel, type DevPanel } from '../../src/app/dev-panel.ts';
import { NO_DEV_PARAMS, readDevParams } from '../../src/app/dev-params.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState, num } from '../../src/core/index.ts';
import { createDevPlatform } from '../../src/platform/dev.ts';
import type { RewardResult } from '../../src/platform/types.ts';
import { uiPlatform } from '../support/ui.ts';

let panel: DevPanel | null = null;
afterEach(() => {
  panel?.dispose();
  panel = null;
});

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no ${id}`);
  return el;
};
const click = (id: string): void => byId<HTMLButtonElement>(id).click();

describe('?debug（dev・e2e のビルドだけで読む URL パラメータ）', () => {
  it('?debug で debug が true。付けなければ false（本番の既定も false）', () => {
    expect(readDevParams('?debug').debug).toBe(true);
    expect(readDevParams('?fps&seed=3').debug).toBe(false);
    expect(NO_DEV_PARAMS.debug).toBe(false);
  });
});

describe('デバッグパネル', () => {
  it('状態を表示し、ストアの通知で更新する。dispose で消える', () => {
    const store = new GameStore(createInitialState(1));
    panel = mountDevPanel({ store, platform: uiPlatform('web') });
    const text = (): string => byId('dev-state').textContent ?? '';
    expect(text()).toMatch(/depth 0m/);
    expect(text()).toMatch(/tickets 2/);
    store.state.run.depth = 12;
    store.notify();
    expect(text()).toMatch(/depth 12m/);
    panel.dispose();
    panel = null;
    expect(document.querySelector('[data-testid="dev-panel"]')).toBeNull();
  });

  it('時間を進める（ロジックだけ）: 自動掘りをオンにして +10s・+1m で打撃が増え、プレイ時間が進む', () => {
    const s = createInitialState(1);
    s.run.drill.tool = 1;
    s.run.autoDig.on = true;
    const store = new GameStore(s);
    panel = mountDevPanel({ store, platform: uiPlatform('web') });
    click('dev-advance-10s');
    expect(store.state.clock.playedMs).toBe(10_000);
    const hits10s = store.state.stats.hits;
    expect(hits10s).toBeGreaterThan(0);
    click('dev-advance-1m');
    expect(store.state.clock.playedMs).toBe(70_000);
    expect(store.state.stats.hits).toBeGreaterThan(hits10s);
  });

  it('付与: コイン +1000・×10、チケット +1（上限 10）、深さ +10m', () => {
    const store = new GameStore(createInitialState(1));
    panel = mountDevPanel({ store, platform: uiPlatform('web') });
    click('dev-grant-coins');
    expect(store.state.run.coins.eq(num(1000))).toBe(true);
    click('dev-grant-coins-x10');
    expect(store.state.run.coins.eq(num(10_000))).toBe(true);
    click('dev-grant-ticket');
    expect(store.state.meta.tickets).toBe(3);
    for (let i = 0; i < 20; i++) click('dev-grant-ticket');
    expect(store.state.meta.tickets).toBe(10);
    click('dev-grant-depth');
    click('dev-grant-depth');
    expect(store.state.run.depth).toBe(20);
    expect(byId('dev-state').textContent).toMatch(/depth 20m/);
  });

  it('TS-056-03 偽の広告の結果を切り替えられる（dev アダプタのときだけ出す）', async () => {
    const store = new GameStore(createInitialState(1));
    const platform = createDevPlatform({ adMs: 0, target: 'web' });
    panel = mountDevPanel({ store, platform });
    const select = byId<HTMLSelectElement>('dev-ad-result');
    const choose = (r: RewardResult): void => {
      select.value = r;
      select.dispatchEvent(new Event('change'));
    };
    choose('unavailable');
    expect(platform.ads.rewardedAvailable()).toBe(false);
    await expect(platform.ads.showRewarded('R1')).resolves.toBe('unavailable');
    choose('failed');
    expect(platform.ads.rewardedAvailable()).toBe(true);
    await expect(platform.ads.showRewarded('R1')).resolves.toBe('failed');
    choose('rewarded');
    await expect(platform.ads.showRewarded('R2')).resolves.toBe('rewarded');
    panel.dispose();
    // setAdResult を持たないアダプタ（web・itch）では出さない
    panel = mountDevPanel({ store, platform: uiPlatform('web') });
    expect(document.querySelector('[data-testid="dev-ad-result"]')).toBeNull();
  });
});
