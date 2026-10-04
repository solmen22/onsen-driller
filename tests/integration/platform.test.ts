// L2: Platform アダプタの契約テスト（SDK はモック）。QA test-strategy §4-2 のシナリオ
import { describe, expect, it } from 'vitest';
import { createCrazyGamesPlatform } from '../../src/platform/crazygames.ts';
import { createPokiPlatform } from '../../src/platform/poki.ts';
import { createWebPlatform } from '../../src/platform/web.ts';
import { crazyMock } from '../../e2e/mocks/crazygames.ts';
import { pokiMock } from '../../e2e/mocks/poki.ts';

describe('web・itch', () => {
  it('SDK を呼ばず、動画は出さない', async () => {
    const p = createWebPlatform('itch');
    await p.init();
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R2')).toBe('unavailable');
    p.gameplayStart();
    p.gameplayStart();
    expect(p.calls().filter((c) => c.name === 'gameplayStart')).toHaveLength(1);
  });
});

describe('crazygames', () => {
  it('local 環境: init・loading・gameplay（冪等）・happytime・locale・data モジュール', async () => {
    const sdk = crazyMock('local');
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    p.loadingStart();
    p.loadingStop();
    p.gameplayStart();
    p.gameplayStart();
    p.gameplayStop();
    p.happyTime();
    expect(sdk.log).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'happytime']);
    expect(p.locale()).toBe('ja-JP');
    expect(p.storage.set('onsen-driller:save:a', 'x')).toBe(true);
    expect(sdk.store.get('onsen-driller:save:a')).toBe('x');
    expect(p.storage.set('onsen-driller:save:a', 'y'.repeat(1_000_001))).toBe(false); // dataLimitExcedeed でも落ちない
  });

  it('リワード: 最後まで見たら rewarded、onPlaying が true → false', async () => {
    const sdk = crazyMock();
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const playing: boolean[] = [];
    p.ads.onPlaying((x) => playing.push(x));
    await p.init();
    expect(p.ads.rewardedAvailable()).toBe(true);
    expect(await p.ads.showRewarded('R2')).toBe('rewarded');
    expect(playing).toEqual([true, false]);
  });

  it.each([
    ['unfilled', 'unavailable'],
    ['adsDisabledBasicLaunch', 'unavailable'],
    ['adCooldown', 'failed'],
    ['other', 'failed'],
  ] as const)('adError %s → %s（報酬なし）', async (code, expected) => {
    const sdk = crazyMock();
    sdk.adBehavior = code;
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    expect(await p.ads.showRewarded('R1')).toBe(expected);
  });

  it('adblock を検出したら以後は動画のボタンを出さない', async () => {
    const sdk = crazyMock();
    sdk.adBehavior = 'adblock';
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    expect(await p.ads.showRewarded('R3')).toBe('unavailable');
    expect(p.ads.rewardedAvailable()).toBe(false);
  });

  it('連打しても要求は 1 回', async () => {
    const sdk = crazyMock();
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    const rs = await Promise.all([p.ads.showRewarded('R2'), p.ads.showRewarded('R2'), p.ads.showRewarded('R2')]);
    expect(rs).toEqual(['rewarded', 'rewarded', 'rewarded']);
    expect(sdk.log.filter((x) => x === 'requestAd:rewarded')).toHaveLength(1);
  });

  it('VITE_CG_ADS=false（Basic Launch）: requestAd を一度も呼ばない', async () => {
    const sdk = crazyMock();
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: false });
    await p.init();
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R2')).toBe('unavailable');
    await p.ads.breakOpportunity('M1');
    expect(sdk.log.some((x) => x.startsWith('requestAd'))).toBe(false);
  });

  it('environment=disabled（他のドメイン）: SDK を呼ばず web と同じ動作', async () => {
    const sdk = crazyMock('disabled');
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    p.gameplayStart();
    p.loadingStop();
    expect(sdk.log).toEqual(['init']);
    expect(p.ads.rewardedAvailable()).toBe(false);
  });

  it('init の失敗・タイムアウトでもゲームは続く', async () => {
    const a = crazyMock();
    a.initBehavior = 'reject';
    const pa = createCrazyGamesPlatform({ getSdk: () => a, adsEnabled: true });
    await pa.init();
    expect(pa.ads.rewardedAvailable()).toBe(false);
    const b = crazyMock();
    b.initBehavior = 'hang';
    const pb = createCrazyGamesPlatform({ getSdk: () => b, adsEnabled: true, initTimeoutMs: 50 });
    await pb.init();
    expect(pb.calls().some((c) => c.name === 'initFailed' && c.arg === 'timeout')).toBe(true);
    const pc = createCrazyGamesPlatform({ getSdk: () => undefined, adsEnabled: true });
    await pc.init();
    expect(pc.ads.rewardedAvailable()).toBe(false);
  });

  it('muteAudio の変更を通知する', async () => {
    const sdk = crazyMock();
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const seen: boolean[] = [];
    p.onMutedChange((m) => seen.push(m));
    await p.init();
    sdk.setMute(true);
    expect(p.isMuted()).toBe(true);
    expect(seen).toEqual([true]);
  });
});

describe('poki', () => {
  it('init・gameLoadingFinished・gameplay（冪等）・rewardedBreak・commercialBreak', async () => {
    const sdk = pokiMock();
    const p = createPokiPlatform({ getSdk: () => sdk });
    const playing: boolean[] = [];
    p.ads.onPlaying((x) => playing.push(x));
    await p.init();
    p.loadingStop();
    p.gameplayStart();
    p.gameplayStart();
    expect(await p.ads.showRewarded('R2')).toBe('rewarded');
    sdk.rewarded = false;
    expect(await p.ads.showRewarded('R2')).toBe('failed');
    await p.ads.breakOpportunity('M2');
    expect(sdk.log).toEqual(['init', 'gameLoadingFinished', 'gameplayStart', 'rewardedBreak', 'rewardedBreak', 'commercialBreak']);
    expect(playing).toEqual([true, false, true, false, true, false]);
  });

  it('init が reject でも続行する', async () => {
    const sdk = pokiMock();
    sdk.initReject = true;
    const p = createPokiPlatform({ getSdk: () => sdk });
    await p.init();
    expect(p.ads.rewardedAvailable()).toBe(true);
  });
});
