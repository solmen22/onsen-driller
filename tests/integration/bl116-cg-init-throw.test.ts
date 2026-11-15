// BL-116（PR #30 のレビュー S-2）: CrazyGames の initSdk() の中の同期の例外で Platform.init() が reject し、起動が止まっていた。
// どこで投げても init は resolve し、SDK を外して web と同じ動作（保存先は localStorage）になり、以後 SDK を呼ばない
import { describe, expect, it } from 'vitest';
import { createCrazyGamesPlatform, type CrazySdk } from '../../src/platform/crazygames.ts';
import { crazyMock, type CrazyMock } from '../mocks/sdk.ts';

const boom = (): never => {
  throw new Error('sdk sync throw (mock)');
};

/** 同期の例外を差し込む場所 */
const CASES: [string, (s: CrazyMock) => void][] = [
  ['SDK.environment の読み出し', (s) => Object.defineProperty(s, 'environment', { get: boom })],
  ['SDK.game.settings の読み出し', (s) => Object.defineProperty(s.game, 'settings', { get: boom })],
  ['SDK.game.addSettingsChangeListener', (s) => void (s.game.addSettingsChangeListener = boom)],
  [
    'SDK.ad.hasAdblock.bind',
    (s) => {
      const f = (() => Promise.resolve(false)) as unknown as { bind: () => never };
      f.bind = boom;
      s.ad.hasAdblock = f as unknown as CrazySdk['ad']['hasAdblock'];
    },
  ],
  ['SDK.init の同期の例外', (s) => void (s.init = boom)],
];

describe('BL-116 initSdk() の同期の例外でも init は resolve する', () => {
  for (const [name, inject] of CASES) {
    it(`${name}: resolve し、SDK を外し（保存先は SDK でない・legacyStorage なし）、initFailed を記録し、以後 SDK を呼ばない`, async () => {
      const sdk = crazyMock('crazygames');
      inject(sdk);
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
      p.loadingStart(); // init の前の合図（SDK が使えなければ送らない）
      await expect(p.init()).resolves.toBeUndefined();
      expect(p.storage.kind, name).not.toBe('sdk');
      expect(p.legacyStorage, name).toBeUndefined();
      expect(p.isMuted(), name).toBe(false);
      expect(p.calls(), name).toContainEqual({ name: 'initFailed', arg: 'exception' });
      // 以後は SDK を呼ばない（web と同じ）
      const before = sdk.log.length;
      p.loadingStop();
      p.gameplayStart();
      p.happyTime();
      await expect(p.ads.showRewarded('R1'), name).resolves.toBe('unavailable');
      await p.ads.breakOpportunity('M1');
      expect(sdk.log.slice(before), `${name}: SDK を呼ばない`).toEqual([]);
    });
  }

  it('getSdk() が投げても resolve する', async () => {
    const p = createCrazyGamesPlatform({ getSdk: boom, adsEnabled: true });
    await expect(p.init()).resolves.toBeUndefined();
    expect(p.storage.kind).not.toBe('sdk');
    expect(p.calls()).toContainEqual({ name: 'initFailed', arg: 'exception' });
  });

  it('外した後に SDK の消音の設定が変わっても受けない（リスナーは登録済みでも）', async () => {
    const sdk = crazyMock('crazygames');
    const f = (() => Promise.resolve(false)) as unknown as { bind: () => never };
    f.bind = boom; // addSettingsChangeListener の後で投げる
    sdk.ad.hasAdblock = f as unknown as CrazySdk['ad']['hasAdblock'];
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const seen: boolean[] = [];
    p.onMutedChange((m) => void seen.push(m));
    await p.init();
    sdk.setMute(true);
    expect(seen).toEqual([]);
    expect(p.isMuted()).toBe(false);
  });
});
