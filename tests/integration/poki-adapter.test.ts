// BL-060: Poki のアダプタ（SDK v2 はモック。外への通信はしない）。QA テスト戦略 §4-2 の Poki の表の L2 の契約テストと、
// CrazyGames と同じ形の広告の時間切れ（Q-35 (d)）・遅れた報酬（Q-45）・リワードの前の gameplayStop（PR #68 のレビュー S-2）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdFlow, pausesForReward } from '../../src/app/ad-flow.ts';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import { createPokiPlatform } from '../../src/platform/poki.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type LateReward, type RewardPlacement, type RewardResult } from '../../src/platform/types.ts';
import { pokiMock, type PokiMock } from '../mocks/sdk.ts';

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

/** マイクロタスクを流す（偽の時計の下でも動く） */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

async function ready(sdk: PokiMock = pokiMock()) {
  const p = createPokiPlatform({ getSdk: () => sdk });
  const playing: boolean[] = [];
  const late: LateReward[] = [];
  p.ads.onPlaying((x) => playing.push(x));
  p.ads.onLateReward((r) => late.push(r));
  await p.init();
  sdk.log.length = 0;
  return { p, sdk, playing, late };
}

describe('QA §4-2 の Poki の表（L2 の契約テスト）', () => {
  it('init（resolve）→ gameLoadingFinished → gameplayStart（冪等）・gameplayStop の順と回数', async () => {
    const sdk = pokiMock();
    const p = createPokiPlatform({ getSdk: () => sdk });
    await p.init();
    p.loadingStart(); // Poki に loadingStart の API はない（記録だけ）
    p.loadingStop();
    p.gameplayStart();
    p.gameplayStart();
    p.gameplayStop();
    p.gameplayStop();
    p.gameplayStart();
    expect(sdk.log).toEqual(['init', 'gameLoadingFinished', 'gameplayStart', 'gameplayStop', 'gameplayStart']);
  });

  it('init が reject でも続行し、SDK を使う（動画のボタンを出す）。SDK がない（読み込めない）なら動画を出さず、広告は unavailable', async () => {
    const sdk = pokiMock();
    sdk.initReject = true;
    const p = createPokiPlatform({ getSdk: () => sdk });
    await p.init();
    expect(p.ads.rewardedAvailable()).toBe(true);
    const none = createPokiPlatform({ getSdk: () => undefined });
    await none.init();
    expect(none.ads.rewardedAvailable()).toBe(false);
    await expect(none.ads.showRewarded('R2')).resolves.toBe('unavailable');
    await expect(none.ads.breakOpportunity('M1')).resolves.toBeUndefined();
  });

  it('init が返らない: INIT のタイムアウトで続行する（起動を止めない）', async () => {
    vi.useFakeTimers();
    try {
      const sdk = pokiMock();
      sdk.init = () => new Promise<void>(() => {});
      const p = createPokiPlatform({ getSdk: () => sdk, initTimeoutMs: 1_000 });
      const done = track(p.init());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done.done()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commercialBreak: 消音のコールバック（onStart → onPlaying(true)）が resolve より先。終われば onPlaying(false)', async () => {
    const { p, sdk, playing } = await ready();
    sdk.manual = true;
    const done = track(p.ads.breakOpportunity('M2'));
    await flush();
    expect(sdk.log).toEqual(['commercialBreak']);
    sdk.start();
    expect(playing).toEqual([true]);
    expect(done.done()).toBe(false);
    sdk.finish();
    await flush();
    expect(playing).toEqual([true, false]);
    expect(done.done()).toBe(true);
  });

  it('rewardedBreak が true なら rewarded、false なら failed（報酬なし）。reject・同期の例外も failed', async () => {
    const { p, sdk } = await ready();
    await expect(p.ads.showRewarded('R1')).resolves.toBe('rewarded');
    sdk.rewarded = false;
    await expect(p.ads.showRewarded('R1')).resolves.toBe('failed');
    sdk.rewardedBreak = () => Promise.reject(new Error('x'));
    await expect(p.ads.showRewarded('R2')).resolves.toBe('failed');
    sdk.rewardedBreak = () => {
      throw new Error('sync');
    };
    await expect(p.ads.showRewarded('R3')).resolves.toBe('failed');
  });

  it('openExternalLink: SDK に渡した URL を記録する（SDK にないときは window.open。ここでは SDK の側だけ）', async () => {
    const { p, sdk } = await ready();
    p.openExternalLink('https://example.com/privacy');
    expect(sdk.links).toEqual(['https://example.com/privacy']);
  });

  it('要求中にもう一度呼んでも、SDK の rewardedBreak は 1 回（同じ Promise）', async () => {
    const { p, sdk } = await ready();
    sdk.manual = true;
    const a = p.ads.showRewarded('R2');
    const b = p.ads.showRewarded('R2');
    expect(a).toBe(b);
    sdk.start();
    sdk.finish();
    await expect(a).resolves.toBe('rewarded');
    expect(sdk.log.filter((x) => x === 'rewardedBreak')).toHaveLength(1);
  });
});

describe('Q-35 (d): 広告の SDK が答えないときの時間切れ（CrazyGames と同じ形）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('何も来ない: AD_START_TIMEOUT_MS で failed、onPlaying は出さない。SDK が終えるまで次の広告は呼ばない（リワードは failed・ミッドゲームは渡さない）', async () => {
    const { p, sdk, playing } = await ready();
    sdk.manual = true;
    const r = track(p.ads.showRewarded('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    expect(r.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.value()).toBe('failed');
    expect(playing).toEqual([]);
    await expect(p.ads.showRewarded('R2')).resolves.toBe('failed');
    await p.ads.breakOpportunity('M1');
    expect(sdk.log).toEqual(['rewardedBreak']); // 2 回目は呼ばない
    sdk.finish(); // SDK が終えた（広告なし）
    await flush();
    expect(playing).toEqual([]);
    expect(p.calls().filter((c) => c.name === 'adBusy').map((c) => c.arg)).toEqual(['R2', 'M1']);
    const again = p.ads.showRewarded('R2'); // 終えた後は呼べる
    await flush();
    expect(sdk.log).toEqual(['rewardedBreak', 'rewardedBreak']);
    sdk.start();
    sdk.finish();
    await expect(again).resolves.toBe('rewarded');
  });

  it('開始の後に終わらない: AD_END_TIMEOUT_MS で failed、onPlaying(false)。後から来た true は無視（報酬は付かない）', async () => {
    const { p, sdk, playing, late } = await ready();
    sdk.manual = true;
    const r = track(p.ads.showRewarded('R2'));
    await flush();
    sdk.start();
    expect(playing).toEqual([true]);
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
    expect(r.value()).toBe('failed');
    expect(playing).toEqual([true, false]);
    sdk.finish();
    await flush();
    expect(playing).toEqual([true, false]);
    expect(late).toEqual([]);
  });

  it('ミッドゲームでも同じ: 開始の後に終わらなければ AD_END_TIMEOUT_MS で終わり、ゲームを戻す', async () => {
    const { p, sdk, playing } = await ready();
    sdk.manual = true;
    const r = track(p.ads.breakOpportunity('M2'));
    await flush();
    sdk.start();
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
    expect(r.done()).toBe(true);
    expect(playing).toEqual([true, false]);
  });

  it('ふつうに終われば時間切れは起きない（タイマーが残らない）。onStart が 2 回来ても onPlaying(true) は 1 回', async () => {
    const { p, sdk, playing } = await ready();
    sdk.manual = true;
    const r = p.ads.showRewarded('R1');
    await flush();
    sdk.start();
    sdk.start();
    sdk.finish();
    await expect(r).resolves.toBe('rewarded');
    expect(vi.getTimerCount()).toBe(0);
    expect(playing).toEqual([true, false]);
  });
});

describe('Q-45: 開始の時間切れの後に遅れて始まり、最後まで見られたリワード（決定 0010 の 5）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('failed で返った後に遅れて始まり true で終われば、onLateReward を 1 回（その要求の placement）。再生の間だけ onPlaying', async () => {
    const { p, sdk, playing, late } = await ready();
    sdk.manual = true;
    const r = track(p.ads.showRewarded('R3'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe('failed');
    sdk.start();
    expect(playing).toEqual([true]);
    sdk.finish();
    await flush();
    expect(playing).toEqual([true, false]);
    expect(late).toEqual([{ id: 1, placement: 'R3' }]);
  });

  it('出さない場合: 遅れて始まって false・reject、開始なしで終わる、ミッドゲーム', async () => {
    const cases: { name: string; run: (sdk: PokiMock) => void; mid?: boolean }[] = [
      { name: 'false', run: (s) => ((s.rewarded = false), s.start(), s.finish()) },
      { name: 'reject', run: (s) => (s.start(), s.finish(true)) },
      { name: '開始なし', run: (s) => s.finish() },
      { name: 'ミッドゲーム', run: (s) => (s.start(), s.finish()), mid: true },
    ];
    for (const c of cases) {
      const { p, sdk, playing, late } = await ready();
      sdk.manual = true;
      if (c.mid) void p.ads.breakOpportunity('M1');
      else void p.ads.showRewarded('R2');
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      c.run(sdk);
      await flush();
      expect(late, c.name).toEqual([]);
      expect(playing.length % 2, c.name).toBe(0); // true の後は必ず false
    }
  });

  it('アダプタ → 広告の流れ → ライフサイクル: 時間切れの failed の後に遅れて見終えたら報酬が 1 回。止めたものは戻り、SDK への合図は stop → rewardedBreak → start と、遅れた再生の間の 1 往復', async () => {
    const sdk = pokiMock();
    const p = createPokiPlatform({ getSdk: () => sdk });
    await p.init();
    const life = createLifecycle(p);
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    sdk.manual = true;
    const grants: RewardPlacement[] = [];
    const st = { loop: true, input: false };
    const flow = createAdFlow({
      ads: p.ads,
      isMuted: () => false,
      life,
      input: { setBlocked: (_r, on) => void (st.input = on) },
      loop: { pause: () => void (st.loop = false), resume: () => void (st.loop = true) },
      isHidden: () => false,
      setMuted: () => {},
      resumeAudio: () => {},
      saveBeforeAd: () => {},
      grant: (x) => (grants.push(x), { ok: true }),
      pauseForReward: pausesForReward(p.target),
    });
    sdk.log.length = 0;
    const r = track<RewardResult>(flow.requestReward('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe('failed');
    expect(grants).toEqual([]);
    expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']);
    expect([st.loop, st.input]).toEqual([true, false]);
    sdk.start();
    expect([st.loop, st.input]).toEqual([false, true]);
    sdk.finish();
    await flush();
    expect(grants).toEqual(['R2']);
    expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart', 'gameplayStop', 'gameplayStart']);
    expect([st.loop, st.input]).toEqual([true, false]);
  });
});
