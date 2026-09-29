// BL-057: CrazyGames のアダプタ（SDK はモック）。PR #16 のレビューの S-2（init の前の loadingStart）と Q-35 (d)（広告の時間切れ）
// L2 の契約テストの本体（TS-057-09・14・15 など）は BL-072（実行・修復エンジニア）。ここはアダプタの直しの再発防止
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import { createCrazyGamesPlatform, type CgAdCallbacks, type CgAdType } from '../../src/platform/crazygames.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type RewardResult } from '../../src/platform/types.ts';
import { crazyMock, type CrazyMock } from '../mocks/sdk.ts';

/** requestAd の呼び出しを外から操れるモック（開始だけ・何も返さない・遅れて始まる、を作るため） */
function manualAds(sdk: CrazyMock): { last: () => CgAdCallbacks; count: () => number } {
  const cbs: CgAdCallbacks[] = [];
  sdk.ad.requestAd = (type: CgAdType, cb: CgAdCallbacks) => {
    sdk.log.push(`requestAd:${type}`);
    cbs.push(cb);
  };
  return { last: () => cbs[cbs.length - 1]!, count: () => cbs.length };
}

/** Promise が決まったかを同期に見る */
function track<T>(p: Promise<T>): { done: () => boolean; value: () => T | undefined } {
  let done = false;
  let value: T | undefined;
  void p.then((v) => {
    done = true;
    value = v;
  });
  return { done: () => done, value: () => value };
}

describe('S-2: init の前に来た loadingStart も SDK に届く（main.ts は init の前に life.loadingStart() を呼ぶ）', () => {
  it('main.ts と同じ順番（loadingStart → init → loadingStop → 最初の入力）で、SDK に loadingStart → loadingStop → gameplayStart が 1 回ずつ', async () => {
    const sdk = crazyMock('crazygames');
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const life = createLifecycle(p);
    life.loadingStart();
    expect(sdk.log).toEqual([]); // init の前は SDK を呼ばない（v3 は init の前の呼び出しを受けない）
    await p.init();
    life.loadingStop();
    life.firstInput();
    life.firstInput();
    expect(sdk.log).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart']);
    // platform.calls() の記録は呼ばれた時点の順（TS-E1-03・TS-071-17 が見る形は変わらない）
    expect(p.calls().map((c) => c.name)).toEqual(['loadingStart', 'init', 'environment', 'loadingStop', 'gameplayStart']);
  });

  it('init の前に loadingStart・loadingStop の両方が来ても、init の後に起きた順で 1 回ずつ送る', async () => {
    const sdk = crazyMock('local');
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: false });
    p.loadingStart();
    p.loadingStop();
    await p.init();
    p.loadingStop(); // 二重の呼び出しはライフサイクルが止めるが、アダプタは届いた分だけ送る（今までどおり）
    expect(sdk.log).toEqual(['init', 'loadingStart', 'loadingStop', 'loadingStop']);
  });

  it('init が失敗・タイムアウト・disabled なら、覚えていた合図は送らない（SDK を呼ばない＝web と同じ）', async () => {
    // environment は作るときに決める（BL-072〔PR #24〕のモックでは読み取り専用のため、後から代入しない）
    for (const make of [
      (): CrazyMock => {
        const m = crazyMock('local');
        m.initBehavior = 'reject';
        return m;
      },
      (): CrazyMock => crazyMock('disabled'),
    ]) {
      const sdk = make();
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
      p.loadingStart();
      await p.init();
      p.loadingStop();
      expect(sdk.log).toEqual(['init']);
    }
    const hang = crazyMock('local');
    hang.initBehavior = 'hang';
    const p = createCrazyGamesPlatform({ getSdk: () => hang, adsEnabled: true, initTimeoutMs: 10 });
    p.loadingStart();
    await p.init();
    p.loadingStop();
    expect(hang.log).toEqual(['init']);
    // SDK の script がない（getSdk が undefined）
    const none = createCrazyGamesPlatform({ getSdk: () => undefined, adsEnabled: true });
    none.loadingStart();
    await none.init();
    none.loadingStop();
    expect(none.calls().map((c) => c.name)).toEqual(['loadingStart', 'init', 'loadingStop']);
  });
});

describe('Q-35 (d): 広告の SDK が答えないときの時間切れ（ゲームが止まったまま・消音のままにならない）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(): Promise<{
    sdk: CrazyMock;
    p: ReturnType<typeof createCrazyGamesPlatform>;
    ads: ReturnType<typeof manualAds>;
    playing: boolean[];
  }> {
    const sdk = crazyMock('crazygames');
    const ads = manualAds(sdk);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    const playing: boolean[] = [];
    p.ads.onPlaying((v) => playing.push(v));
    return { sdk, p, ads, playing };
  }

  it('開始（adStarted）の後に終了も失敗も来ない: AD_END_TIMEOUT_MS で failed、onPlaying(false) が出る。後から来た終了は無視（報酬は 1 回も付かない）', async () => {
    const { p, ads, playing } = await setup();
    const r = track(p.ads.showRewarded('R2'));
    ads.last().adStarted?.();
    expect(playing).toEqual([true]);
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS - 1);
    expect(r.done()).toBe(false);
    expect(playing).toEqual([true]); // 動画の長さの内は待つ
    await vi.advanceTimersByTimeAsync(1);
    expect(r.value()).toBe<RewardResult>('failed');
    expect(playing).toEqual([true, false]);
    expect(p.calls()).toContainEqual({ name: 'adTimeout', arg: 'end' });
    ads.last().adFinished?.(); // 遅れて来た終了
    await vi.advanceTimersByTimeAsync(0);
    expect(playing).toEqual([true, false]);
    // 次の要求はできる（連打の 1 回の制限が残らない）
    const r2 = track(p.ads.showRewarded('R2'));
    expect(ads.count()).toBe(2);
    ads.last().adStarted?.();
    ads.last().adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(r2.value()).toBe<RewardResult>('rewarded');
    expect(playing).toEqual([true, false, true, false]);
  });

  it('ライフサイクルとつなぐと、時間切れで gameplay が戻る（ad の理由が外れる。main.ts の onPlaying の結線と同じ）', async () => {
    const { sdk, p, ads } = await setup();
    const life = createLifecycle(p);
    p.ads.onPlaying((v) => life.setPaused('ad', v));
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    const done = track(p.ads.breakOpportunity('M1'));
    ads.last().adStarted?.();
    expect(life.playing).toBe(false);
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
    expect(done.done()).toBe(true);
    expect(life.playing).toBe(true);
    expect(sdk.log.filter((x) => x.startsWith('gameplay'))).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);
  });

  it('何も返さない（開始も終了も失敗も来ない）: AD_START_TIMEOUT_MS で failed を返し、onPlaying は出さない（ゲームは止めていない）', async () => {
    const { p, ads, playing } = await setup();
    const r = track(p.ads.showRewarded('R1'));
    const m = track(p.ads.breakOpportunity('M2'));
    expect(ads.count()).toBe(2);
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe<RewardResult>('failed');
    expect(m.done()).toBe(true);
    expect(playing).toEqual([]);
    expect(p.calls().filter((c) => c.name === 'adTimeout')).toEqual([
      { name: 'adTimeout', arg: 'start' },
      { name: 'adTimeout', arg: 'start' },
    ]);
  });

  it('開始の時間切れの後に遅れて始まったら、その再生の間だけ止めて、終わったら戻す（結果は failed のまま。報酬なし）', async () => {
    const { p, ads, playing } = await setup();
    const r = track(p.ads.showRewarded('R3'));
    const cb = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe<RewardResult>('failed');
    cb.adStarted?.();
    expect(playing).toEqual([true]);
    cb.adFinished?.();
    expect(playing).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.value()).toBe<RewardResult>('failed');
    // 遅れた再生にも終わりの時間切れが効く
    const r2 = track(p.ads.showRewarded('R3'));
    const cb2 = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r2.value()).toBe<RewardResult>('failed');
    cb2.adStarted?.();
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
    expect(playing).toEqual([true, false, true, false]);
  });

  it('ふつうに終われば時間切れは起きない（タイマーが残らない）。adStarted が 2 回来ても onPlaying(true) は 1 回', async () => {
    const { p, ads, playing } = await setup();
    const r = track(p.ads.showRewarded('R2'));
    ads.last().adStarted?.();
    ads.last().adStarted?.();
    await vi.advanceTimersByTimeAsync(10_000);
    ads.last().adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.value()).toBe<RewardResult>('rewarded');
    expect(playing).toEqual([true, false]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS + AD_START_TIMEOUT_MS);
    expect(p.calls().some((c) => c.name === 'adTimeout')).toBe(false);
  });

  it('開始の前の失敗（adError）でも時間切れのタイマーは残らない', async () => {
    const { p, ads, playing } = await setup();
    const r = track(p.ads.showRewarded('R2'));
    ads.last().adError?.({ code: 'unfilled' });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.value()).toBe<RewardResult>('unavailable');
    expect(playing).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('時間の値: 開始 30 秒・終了 3 分（動画広告の長さより十分長い。arch §12-3）', () => {
    expect(AD_START_TIMEOUT_MS).toBe(30_000);
    expect(AD_END_TIMEOUT_MS).toBe(180_000);
  });
});

describe('Q-35 (c): 広告の失敗の種類と、動画のボタンを出し続けるか', () => {
  const cases: { code: string; result: RewardResult; hideAfter: boolean }[] = [
    { code: 'unfilled', result: 'unavailable', hideAfter: false }, // 在庫は後で戻りうる
    { code: 'adCooldown', result: 'failed', hideAfter: false }, // 間隔が空けば出せる
    { code: 'other', result: 'failed', hideAfter: false },
    { code: 'adblock', result: 'unavailable', hideAfter: true }, // セッションの間は変わらない
    { code: 'adsDisabledBasicLaunch', result: 'unavailable', hideAfter: true }, // 同上（Basic Launch の間は広告が出ない）
  ];
  for (const c of cases)
    it(`${c.code} → ${c.result}、以後の rewardedAvailable() は ${!c.hideAfter}`, async () => {
      const sdk = crazyMock('crazygames');
      sdk.adBehavior = c.code as CrazyMock['adBehavior'];
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
      await p.init();
      expect(p.ads.rewardedAvailable()).toBe(true);
      expect(await p.ads.showRewarded('R2')).toBe(c.result);
      expect(p.ads.rewardedAvailable()).toBe(!c.hideAfter);
      if (c.hideAfter) {
        expect(await p.ads.showRewarded('R2')).toBe('unavailable');
        expect(sdk.log.filter((x) => x === 'requestAd:rewarded')).toHaveLength(1); // 2 回目は SDK に求めない
      }
    });
});
