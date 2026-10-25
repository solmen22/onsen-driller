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

  it('PR #84 のレビュー S-1: rewardedBreak が reject・同期の例外で failed になった後も、次のリワードとミッドゲームは SDK に届く（busy が立ったままにならない）', async () => {
    for (const how of ['reject', 'throw'] as const) {
      const { p, sdk } = await ready();
      const real = sdk.rewardedBreak.bind(sdk);
      sdk.rewardedBreak =
        how === 'reject'
          ? () => (sdk.log.push('rewardedBreak'), Promise.reject(new Error('sdk')))
          : () => {
              sdk.log.push('rewardedBreak');
              throw new Error('sync');
            };
      await expect(p.ads.showRewarded('R2'), how).resolves.toBe('failed');
      sdk.rewardedBreak = real;
      await expect(p.ads.showRewarded('R2'), how).resolves.toBe('rewarded');
      await p.ads.breakOpportunity('M1');
      expect(sdk.log, how).toEqual(['rewardedBreak', 'rewardedBreak', 'commercialBreak']);
      expect(p.calls().some((c) => c.name === 'adBusy'), how).toBe(false);
    }
  });

  it('PR #84 のレビュー S-1: commercialBreak が reject・同期の例外の後も、次のミッドゲームとリワードは SDK に届く', async () => {
    for (const how of ['reject', 'throw'] as const) {
      const { p, sdk } = await ready();
      const real = sdk.commercialBreak.bind(sdk);
      sdk.commercialBreak =
        how === 'reject'
          ? () => (sdk.log.push('commercialBreak'), Promise.reject(new Error('sdk')))
          : () => {
              sdk.log.push('commercialBreak');
              throw new Error('sync');
            };
      await p.ads.breakOpportunity('M2');
      sdk.commercialBreak = real;
      await p.ads.breakOpportunity('M2');
      await expect(p.ads.showRewarded('R1'), how).resolves.toBe('rewarded');
      expect(sdk.log, how).toEqual(['commercialBreak', 'commercialBreak', 'rewardedBreak']);
      expect(p.calls().some((c) => c.name === 'adBusy'), how).toBe(false);
    }
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

/** アダプタ → 広告の流れ → ライフサイクルをつなぐ（main.ts と同じ形。音・入力・ループ・報酬・返却を記録する） */
async function wired(setup: (sdk: PokiMock) => void = () => {}) {
  const sdk = pokiMock();
  setup(sdk);
  const p = createPokiPlatform({ getSdk: () => sdk });
  await p.init();
  const life = createLifecycle(p);
  life.loadingStart();
  life.loadingStop();
  life.firstInput();
  const st = { muted: false, loop: true, input: false, resumes: 0, grants: [] as RewardPlacement[], refunds: 0, mutes: [] as boolean[] };
  const flow = createAdFlow({
    ads: p.ads,
    isMuted: () => false, // Poki の SDK には消音の設定がない（アダプタの isMuted は false）
    life,
    input: { setBlocked: (_r, on) => void (st.input = on) },
    loop: { pause: () => void (st.loop = false), resume: () => void (st.loop = true) },
    isHidden: () => false,
    setMuted: (m) => {
      st.muted = m;
      st.mutes.push(m);
    },
    resumeAudio: () => void st.resumes++,
    saveBeforeAd: () => {},
    grant: (x) => (st.grants.push(x), { ok: true }),
    refund: () => (st.refunds++, 'refund'),
    pauseForReward: pausesForReward(p.target),
  });
  sdk.log.length = 0;
  return { sdk, p, flow, st };
}

describe('広告の間の音（BL-060 の受け入れ基準 2026-10-26 追加。Poki の要件「広告の間は音を止める」）', () => {
  it('rewardedBreak: 広告が始まった時点（onStart）で消音し、再生の間は消音のまま・ループも入力も止まる。終われば true でも false でも消音を解き、音の再開を呼ぶ', async () => {
    for (const rewarded of [true, false]) {
      const { sdk, flow, st } = await wired((s) => (s.manual = true));
      sdk.rewarded = rewarded;
      const r = flow.requestReward('R2');
      await flush();
      expect(st.muted, String(rewarded)).toBe(false); // 広告が始まるまでは鳴らしたまま（止めるのはループ・入力。S-2）
      sdk.start();
      expect([st.muted, st.loop, st.input], String(rewarded)).toEqual([true, false, true]);
      sdk.finish();
      await expect(r).resolves.toBe(rewarded ? 'rewarded' : 'failed');
      expect([st.muted, st.loop, st.input], String(rewarded)).toEqual([false, true, false]);
      expect(st.mutes, String(rewarded)).toEqual([true, false]);
      expect(st.resumes, String(rewarded)).toBe(1);
    }
  });

  it('commercialBreak（M1・M2）も同じ: 消音のコールバック（onStart）で消音し、終われば戻す', async () => {
    const { sdk, flow, st } = await wired((s) => (s.manual = true));
    flow.onEvents([{ type: 'BreakOpportunity', placement: 'M2', band: 3 }]);
    await flush();
    expect(sdk.log).toContain('commercialBreak');
    sdk.start();
    expect([st.muted, st.loop, st.input]).toEqual([true, false, true]);
    sdk.finish();
    await flush();
    expect([st.muted, st.loop, st.input]).toEqual([false, true, false]);
    expect(st.mutes).toEqual([true, false]);
  });

  it('再生の時間切れ（AD_END_TIMEOUT_MS）でも消音を解く（消音のままにならない）', async () => {
    vi.useFakeTimers();
    try {
      const { sdk, flow, st } = await wired((s) => (s.manual = true));
      void flow.requestReward('R1');
      await flush();
      sdk.start();
      expect(st.muted).toBe(true);
      await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS);
      expect([st.muted, st.loop, st.input]).toEqual([false, true, false]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('広告ブロッカー（BL-060 の受け入れ基準 2026-10-26 追加。Poki の要件「広告ブロッカーを検出したら報酬を付けない」）', () => {
  it('rewardedBreak が広告を出さずに false: 報酬もチケットの返却も付けず failed（案内「今は広告を表示できません」）。gameplay・ループ・入力は戻り、音は止めない', async () => {
    const { sdk, flow, st } = await wired((s) => (s.adblock = true));
    await expect(flow.requestReward('R2')).resolves.toBe('failed');
    expect(st.grants).toEqual([]);
    expect(st.refunds).toBe(0);
    expect(st.mutes).toEqual([]);
    expect([st.loop, st.input]).toEqual([true, false]);
    expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']); // 遊べなくしない（1 往復で戻る）
  });

  it('次の要求も同じように答え、ミッドゲームも止まらない（広告ブロッカーを理由に遊べなくしない）', async () => {
    const { sdk, flow, st } = await wired((s) => (s.adblock = true));
    await flow.requestReward('R2');
    await expect(flow.requestReward('R3')).resolves.toBe('failed');
    flow.onEvents([{ type: 'BreakOpportunity', placement: 'M1' }]);
    await flush();
    expect(flow.breaking).toBe(false);
    expect([st.loop, st.input, st.grants.length, st.refunds]).toEqual([true, false, 0, 0]);
    expect(sdk.log.filter((x) => x === 'commercialBreak')).toHaveLength(1);
  });
});

describe('PR #84 のレビュー N-1: SDK を呼ばずに返るときは、gameplayStop → gameplayStart の無駄な往復を出さない', () => {
  it('SDK がない（読み込めない）: unavailable で、合図は出さない', async () => {
    const p = createPokiPlatform({ getSdk: () => undefined });
    await p.init();
    const signals: string[] = [];
    const life = createLifecycle({
      loadingStart: () => {},
      loadingStop: () => {},
      gameplayStart: () => signals.push('gameplayStart'),
      gameplayStop: () => signals.push('gameplayStop'),
    });
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    signals.length = 0;
    const flow = createAdFlow({
      ads: p.ads,
      isMuted: () => false,
      life,
      input: { setBlocked: () => {} },
      loop: { pause: () => {}, resume: () => {} },
      isHidden: () => false,
      setMuted: () => {},
      resumeAudio: () => {},
      saveBeforeAd: () => {},
      grant: () => ({ ok: true }),
      pauseForReward: pausesForReward(p.target),
    });
    await expect(flow.requestReward('R2')).resolves.toBe('unavailable');
    expect(signals).toEqual([]);
  });

  it('前の広告を SDK がまだ終えていない（開始の時間切れの後）: failed で、合図は出さない。終えた後はふつうに 1 往復', async () => {
    vi.useFakeTimers();
    try {
      const { sdk, flow } = await wired((s) => (s.manual = true));
      void flow.requestReward('R2');
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']);
      await expect(flow.requestReward('R2')).resolves.toBe('failed');
      expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']); // 往復なし
      sdk.finish(); // SDK が終えた（広告なし）
      await flush();
      const next = flow.requestReward('R2');
      await flush();
      sdk.start();
      sdk.finish();
      await expect(next).resolves.toBe('rewarded');
      expect(sdk.log.slice(3)).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']);
    } finally {
      vi.useRealTimers();
    }
  });
});
