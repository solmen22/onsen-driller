// BL-057: CrazyGames のアダプタ（SDK はモック）。PR #16 のレビューの S-2（init の前の loadingStart）と Q-35 (d)（広告の時間切れ）
// L2 の契約テストの本体（TS-057-09・14・15 など）は BL-072（実行・修復エンジニア）。ここはアダプタの直しの再発防止
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import { ADBLOCK_TIMEOUT_MS, createCrazyGamesPlatform, type CgAdCallbacks, type CgAdType } from '../../src/platform/crazygames.ts';
import { createAdFlow } from '../../src/app/ad-flow.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type LateReward, type RewardPlacement, type RewardResult } from '../../src/platform/types.ts';
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

  it('開始の時間切れの後に遅れて始まったら、その再生の間だけ止めて、終わったら戻す（結果は failed のまま。報酬は Q-45 の onLateReward で 1 回）', async () => {
    const { p, ads, playing } = await setup();
    const late: LateReward[] = [];
    p.ads.onLateReward((x) => late.push(x));
    const r = track(p.ads.showRewarded('R3'));
    const cb = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe<RewardResult>('failed');
    expect(late).toEqual([]); // 時間切れの時点では知らせない
    cb.adStarted?.();
    expect(playing).toEqual([true]);
    cb.adFinished?.();
    expect(playing).toEqual([true, false]);
    expect(late).toEqual([{ id: 1, placement: 'R3' }]);
    cb.adFinished?.(); // 二重の終了
    await vi.advanceTimersByTimeAsync(0);
    expect(r.value()).toBe<RewardResult>('failed');
    expect(late).toHaveLength(1);
    expect(p.calls()).toContainEqual({ name: 'lateReward', arg: 'R3' });
    // 遅れた再生にも終わりの時間切れが効く（最後まで見られたと分からないので、報酬は知らせない）
    const r2 = track(p.ads.showRewarded('R3'));
    const cb2 = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r2.value()).toBe<RewardResult>('failed');
    cb2.adStarted?.();
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
    expect(playing).toEqual([true, false, true, false]);
    cb2.adFinished?.(); // 再生の時間切れの後に来た終了は無視
    expect(late).toHaveLength(1);
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

describe('広告ブロッカーの判定（hasAdblock）が返らなくても起動は止まらない（PR #24 のレビューの連絡 1。重大度 S1 になりうる）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** hasAdblock を外から決める（返らない・遅れて返る・拒否） */
  function adblockControl(sdk: CrazyMock): { answer: (v: boolean) => void; fail: () => void; asked: () => number } {
    let asked = 0;
    let answer: (v: boolean) => void = () => {};
    let fail: () => void = () => {};
    sdk.ad.hasAdblock = () =>
      new Promise<boolean>((res, rej) => {
        asked++;
        answer = res;
        fail = () => rej(new Error('adblock check failed (test)'));
      });
    return { answer: (v) => answer(v), fail: () => fail(), asked: () => asked };
  }

  it(`返らない: init は ADBLOCK_TIMEOUT_MS（${ADBLOCK_TIMEOUT_MS}ms）で終わり、判定は不明＝動画のボタンを出す。遅れて true が返ったら以後は出さない`, async () => {
    const sdk = crazyMock('crazygames');
    const ctl = adblockControl(sdk);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const init = track(p.init());
    await vi.advanceTimersByTimeAsync(ADBLOCK_TIMEOUT_MS - 1);
    expect(init.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(init.done()).toBe(true);
    expect(ctl.asked()).toBe(1);
    expect(p.ads.rewardedAvailable()).toBe(true);
    expect(p.calls()).toContainEqual({ name: 'adblockCheck', arg: 'timeout' });
    ctl.answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R2')).toBe('unavailable');
  });

  it('遅れて false が返っても、出したまま。上限より早く返れば、その結果で始まる（true なら最初から出さない）', async () => {
    const late = crazyMock('crazygames');
    const lateCtl = adblockControl(late);
    const p1 = createCrazyGamesPlatform({ getSdk: () => late, adsEnabled: true });
    const i1 = track(p1.init());
    await vi.advanceTimersByTimeAsync(ADBLOCK_TIMEOUT_MS);
    expect(i1.done()).toBe(true);
    lateCtl.answer(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(p1.ads.rewardedAvailable()).toBe(true);

    const fast = crazyMock('crazygames');
    const fastCtl = adblockControl(fast);
    const p2 = createCrazyGamesPlatform({ getSdk: () => fast, adsEnabled: true });
    const i2 = track(p2.init());
    await vi.advanceTimersByTimeAsync(10);
    fastCtl.answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(i2.done()).toBe(true);
    expect(p2.ads.rewardedAvailable()).toBe(false);
    expect(p2.calls().some((c) => c.name === 'adblockCheck')).toBe(false);
  });

  it('拒否・同期の例外: すぐ起動を続け、判定は不明（ボタンを出す）。未処理の拒否を出さない', async () => {
    const rej = crazyMock('crazygames');
    const ctl = adblockControl(rej);
    const p1 = createCrazyGamesPlatform({ getSdk: () => rej, adsEnabled: true });
    const i1 = track(p1.init());
    await vi.advanceTimersByTimeAsync(0);
    ctl.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(i1.done()).toBe(true);
    expect(p1.ads.rewardedAvailable()).toBe(true);
    expect(p1.calls()).toContainEqual({ name: 'adblockCheck', arg: 'error' });

    const thrower = crazyMock('crazygames');
    thrower.ad.hasAdblock = () => {
      throw new Error('sync throw (test)');
    };
    const p2 = createCrazyGamesPlatform({ getSdk: () => thrower, adsEnabled: true });
    const i2 = track(p2.init());
    await vi.advanceTimersByTimeAsync(0);
    expect(i2.done()).toBe(true);
    expect(p2.ads.rewardedAvailable()).toBe(true);
  });

  it('起動の全体（main.ts と同じ順番）: hasAdblock が返らなくても、init の後に loadingStop と最初の入力の gameplayStart が SDK に届く', async () => {
    const sdk = crazyMock('crazygames');
    adblockControl(sdk);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const life = createLifecycle(p);
    life.loadingStart();
    const init = track(p.init());
    await vi.advanceTimersByTimeAsync(ADBLOCK_TIMEOUT_MS);
    expect(init.done()).toBe(true);
    life.loadingStop();
    life.firstInput();
    expect(sdk.log).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart']);
  });

  it('Basic Launch（adsEnabled=false）では hasAdblock を呼ばない（今までどおり）', async () => {
    const sdk = crazyMock('crazygames');
    const ctl = adblockControl(sdk);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: false });
    await p.init();
    expect(ctl.asked()).toBe(0);
  });

  it('上限の値: 1 秒（本物は local で即時。init の 5 秒と合わせても #1 の 10 秒に収まる）', () => {
    expect(ADBLOCK_TIMEOUT_MS).toBe(1_000);
  });
});

describe('Q-45: 開始の時間切れの後に遅れて始まり最後まで見られた広告の報酬（決定 0010 の 5）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const sdk = crazyMock('crazygames');
    const ads = manualAds(sdk);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    const playing: boolean[] = [];
    const late: LateReward[] = [];
    p.ads.onPlaying((v) => playing.push(v));
    p.ads.onLateReward((x) => late.push(x));
    return { p, ads, playing, late };
  }

  it('SDK のモック（adStartDelayMs 31 秒・動画 15 秒）: failed で返り、遅れて見終えたら onLateReward が 1 回（L3 の e2e で使う形）', async () => {
    const sdk = crazyMock('crazygames');
    sdk.configure({ adStartDelayMs: AD_START_TIMEOUT_MS + 1_000, adDurationMs: 15_000 });
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    const late: LateReward[] = [];
    const playing: boolean[] = [];
    p.ads.onLateReward((x) => late.push(x));
    p.ads.onPlaying((v) => playing.push(v));
    const r = track(p.ads.showRewarded('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe<RewardResult>('failed');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(playing).toEqual([true]);
    expect(late).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(playing).toEqual([true, false]);
    expect(late).toEqual([{ id: 1, placement: 'R2' }]);
  });

  it('時間内に終われば rewarded で返し、遅れた報酬は出さない（ふつうの報酬と二重にならない）', async () => {
    const { p, ads, late } = await setup();
    const r = track(p.ads.showRewarded('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    ads.last().adStarted?.();
    ads.last().adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.value()).toBe<RewardResult>('rewarded');
    expect(late).toEqual([]);
  });

  it('遅れた報酬を出さない場合: ミッドゲーム・遅れて始まった後の失敗・開始なしの終了・開始の前の失敗', async () => {
    const { p, ads, playing, late } = await setup();
    // ミッドゲーム（報酬のない広告）
    const m = track(p.ads.breakOpportunity('M2'));
    const cm = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(m.done()).toBe(true);
    cm.adStarted?.();
    cm.adFinished?.();
    // 遅れて始まった後の失敗
    void p.ads.showRewarded('R2');
    const c1 = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    c1.adStarted?.();
    c1.adError?.({ code: 'other' });
    // 開始（adStarted）が来ないままの終了（見られたか分からない）
    void p.ads.showRewarded('R2');
    const c2 = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    c2.adFinished?.();
    // 時間切れの後の、開始の前の失敗
    void p.ads.showRewarded('R3');
    const c3 = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    c3.adError?.({ code: 'unfilled' });
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toEqual([]);
    expect(playing).toEqual([true, false, true, false]);
  });

  it('別の要求と混ざらない: 時間切れの要求 A（R2）の広告が次の要求 B（R3）の最中に遅れて流れても、A の報酬は A の placement に 1 回、B の結果は B のまま。重なりの間 onPlaying は true のまま', async () => {
    const { p, ads, playing, late } = await setup();
    const a = track(p.ads.showRewarded('R2'));
    const ca = ads.last();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(a.value()).toBe<RewardResult>('failed');
    const b = track(p.ads.showRewarded('R3'));
    const cb = ads.last();
    expect(ads.count()).toBe(2); // A の時間切れの後は新しい要求（連打の 1 回の制限が残らない）
    ca.adStarted?.();
    cb.adStarted?.();
    expect(playing).toEqual([true]);
    ca.adFinished?.(); // A が先に終わる: B が流れている間はゲームを戻さない
    expect(playing).toEqual([true]);
    expect(late).toEqual([{ id: 1, placement: 'R2' }]);
    expect(b.done()).toBe(false);
    cb.adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(playing).toEqual([true, false]);
    expect(b.value()).toBe<RewardResult>('rewarded');
    expect(late).toHaveLength(1); // B は時間内なので遅れた報酬ではない
  });

  it('アダプタ → 広告の流れ → ライフサイクルをつなぐと: 時間切れの failed の後に遅れて見終えた報酬が 1 回付き、合図は 1 往復、止めたものは戻る', async () => {
    const { p, ads } = await setup();
    const life = createLifecycle(p);
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    const st = { loop: true, input: false, muted: false };
    const grants: RewardPlacement[] = [];
    const told: RewardPlacement[] = [];
    const flow = createAdFlow({
      ads: p.ads,
      isMuted: () => false,
      life,
      input: { setBlocked: (_r, on) => void (st.input = on) },
      loop: { pause: () => void (st.loop = false), resume: () => void (st.loop = true) },
      isHidden: () => false,
      setMuted: (m) => void (st.muted = m),
      resumeAudio: () => {},
      saveBeforeAd: () => {},
      grant: (x) => {
        grants.push(x);
        return { ok: true };
      },
    });
    flow.onLateReward((x) => told.push(x));
    const r = track(flow.requestReward('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe<RewardResult>('failed');
    expect(grants).toEqual([]);
    ads.last().adStarted?.();
    expect([st.loop, st.input, st.muted, life.playing]).toEqual([false, true, true, false]);
    ads.last().adFinished?.();
    ads.last().adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(grants).toEqual(['R2']);
    expect(told).toEqual(['R2']);
    expect([st.loop, st.input, st.muted, life.playing]).toEqual([true, false, false, true]);
    expect(p.calls().filter((c) => c.name.startsWith('gameplay')).map((c) => c.name)).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);
  });
});
