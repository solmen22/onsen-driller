// @vitest-environment jsdom
// 環境は jsdom（localStore() が localStorage になり、成功の起動では legacyStorage が入る。node だと memory になり
// legacyStorage の行を通らない。PR #106 のレビュー S-2）
// BL-116（PR #30 のレビュー S-2）: CrazyGames の initSdk() の中の同期の例外で Platform.init() が reject し、起動が止まっていた。
// どこで投げても init は resolve し、SDK を外して web と同じ動作（保存先は localStorage）になり、以後 SDK を呼ばない
import { describe, expect, it } from 'vitest';
import { createCrazyGamesPlatform, type CrazySdk } from '../../src/platform/crazygames.ts';
import { createCrazyMock, crazyMock, type CrazyMock } from '../mocks/sdk.ts';

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
    it(`${name}: resolve し、SDK を外し（保存先は localStorage・legacyStorage なし）、initFailed を記録し、以後 SDK を呼ばない`, async () => {
      const sdk = crazyMock('crazygames');
      inject(sdk);
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
      p.loadingStart(); // init の前の合図（SDK が使えなければ送らない）
      await expect(p.init()).resolves.toBeUndefined();
      expect(p.storage.kind, name).toBe('local');
      // 残ると main.ts が moveLegacySlots(local, local) を呼び、今のセーブを消しうる（レビュー S-2）
      expect(p.legacyStorage, name).toBeUndefined();
      expect(p.isMuted(), name).toBe(false);
      expect(p.calls(), name).toContainEqual({ name: 'initFailed', arg: 'exception' });
      // init の中でも SDK には init 以外を送らない（loadingStart だけ届いて loadingStop が届かない形にしない。レビュー S-1）
      expect(sdk.log.filter((n) => n !== 'init'), `${name}: init の中で SDK に送らない`).toEqual([]);
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

  it('対照: 投げなければ SDK を使い、init の前の loadingStart を送り、legacyStorage は localStorage（この環境で legacy の行を通る）', async () => {
    const sdk = crazyMock('crazygames');
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    p.loadingStart();
    await p.init();
    expect(p.storage.kind).toBe('sdk');
    expect(p.legacyStorage?.kind).toBe('local');
    expect(sdk.log).toEqual(['init', 'loadingStart']);
  });

  for (const [name, inject] of CASES.slice(1, 4)) {
    it(`${name}: SDK の消音が on でも、外した後は消音にしない`, async () => {
      const sdk = createCrazyMock({ environment: 'crazygames', muteAudio: true });
      inject(sdk);
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
      await p.init();
      expect(p.calls()).toContainEqual({ name: 'initFailed', arg: 'exception' });
      expect(p.isMuted(), name).toBe(false);
    });
  }

  it('getSdk() が投げても resolve する', async () => {
    const p = createCrazyGamesPlatform({ getSdk: boom, adsEnabled: true });
    await expect(p.init()).resolves.toBeUndefined();
    expect(p.storage.kind).toBe('local');
    expect(p.legacyStorage).toBeUndefined();
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
