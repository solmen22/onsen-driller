// BL-146: Poki のリワードで、開始の時間切れの後に onStart なしで rewardedBreak が true で決まったときの遅れた報酬（Q-45）と、
// SDK の広告の呼び出しが決まるまでの消音（決定 0012 の追記 Q-56 (a)(b)）。シナリオ BL-146_poki-late-reward-mute.md の TS-146-01〜10
// （TS-146-11 は Poki のビルドでの手の確認〔QA。G3 の Poki の行〕）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdFlow, pausesForReward, type LateKind } from '../../src/app/ad-flow.ts';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import { createRewardHooks } from '../../src/app/rewards.ts';
import { GameStore } from '../../src/app/store.ts';
import { PARAMS } from '../../src/content/params.ts';
import { createCrazyGamesPlatform, type CgAdCallbacks, type CgAdType } from '../../src/platform/crazygames.ts';
import { createPokiPlatform } from '../../src/platform/poki.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type LateReward, type RewardPlacement, type RewardResult } from '../../src/platform/types.ts';
import { crazyMock, pokiMock } from '../mocks/sdk.ts';
import { stateWith } from '../support/states.ts';

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
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * main.ts と同じ形の結線（アダプタ → 広告の流れ → ライフサイクル。消音は platform.isMuted・onMutedChange → setMuted、
 * ad-flow の isMuted も platform から）。st.muted は効果音の出口（src/audio/sfx.ts の muted）に当たる
 */
async function wired(audio?: (muted: boolean) => void) {
  const sdk = pokiMock();
  sdk.manual = true;
  const p = createPokiPlatform({ getSdk: () => sdk });
  await p.init();
  const life = createLifecycle(p);
  life.loadingStart();
  life.loadingStop();
  life.firstInput();
  const st = { muted: p.isMuted(), grants: [] as RewardPlacement[], late: [] as RewardPlacement[], loop: true, input: false, playing: [] as boolean[] };
  p.onMutedChange((m) => {
    st.muted = m;
    audio?.(m);
  });
  p.ads.onPlaying((x) => void st.playing.push(x));
  const flow = createAdFlow({
    ads: p.ads,
    isMuted: () => p.isMuted(),
    life,
    input: { setBlocked: (_r, on) => void (st.input = on) },
    loop: { pause: () => void (st.loop = false), resume: () => void (st.loop = true) },
    isHidden: () => false,
    setMuted: (m) => {
      st.muted = m;
      audio?.(m);
    },
    resumeAudio: () => {},
    saveBeforeAd: () => {},
    grant: (x) => (st.grants.push(x), { ok: true }),
    pauseForReward: pausesForReward(p.target),
  });
  flow.onLateReward((x) => void st.late.push(x));
  sdk.log.length = 0;
  return { sdk, p, flow, st, life };
}

const lateCalls = (p: { calls(): { name: string; arg?: unknown }[] }) => p.calls().filter((c) => c.name === 'lateReward');
const muteHolds = (p: { calls(): { name: string; arg?: unknown }[] }) => p.calls().filter((c) => c.name === 'muteHold').map((c) => c.arg);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('BL-146 遅れた報酬（Q-45）: onStart なしの true', () => {
  it('TS-146-01 開始の時間切れの後に onStart なしで true: onLateReward・報酬・calls() の lateReward がちょうど 1 回（R1・R2・R3）', async () => {
    for (const placement of ['R1', 'R2', 'R3'] as const) {
      const { sdk, p, flow, st } = await wired();
      const late: LateReward[] = [];
      p.ads.onLateReward((r) => void late.push(r));
      const r = track(flow.requestReward(placement));
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      expect(r.value(), placement).toBe('failed');
      expect(st.grants, placement).toEqual([]);
      sdk.finish(); // onStart なしで true
      await flush();
      expect(late, placement).toHaveLength(1);
      expect(late[0]?.placement, placement).toBe(placement);
      expect(st.grants, placement).toEqual([placement]);
      expect(st.late, placement).toEqual([placement]);
      expect(lateCalls(p), placement).toEqual([{ name: 'lateReward', arg: placement }]);
      expect(st.playing, `${placement}: onPlaying は出さない（開始の合図がない）`).toEqual([]);
    }
  });

  it('TS-146-02 (a) 29,999ms で onStart なしに true: rewarded で報酬 1 回、遅れた報酬は出ない (b) 30,000ms ちょうど: rewarded か遅れた報酬のどちらか 1 回だけ', async () => {
    {
      const { sdk, p, flow, st } = await wired();
      const r = track(flow.requestReward('R2'));
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
      sdk.finish();
      await flush();
      expect(r.value()).toBe('rewarded');
      expect(st.grants).toEqual(['R2']);
      expect(st.late).toEqual([]);
      expect(lateCalls(p)).toEqual([]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(st.grants, '時間切れのタイマーは残らない').toEqual(['R2']);
    }
    {
      const { sdk, flow, st } = await wired();
      const r = track(flow.requestReward('R2'));
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      sdk.finish();
      await flush();
      const viaResult = r.value() === 'rewarded' ? 1 : 0;
      expect(viaResult + st.late.length, 'どちらか 1 回だけ').toBe(1);
      expect(st.grants).toEqual(['R2']);
    }
  });

  it('TS-146-03 開始の時間切れの後に (a) false (b) undefined (c) reject で決まる／(d) 呼び出しが同期の例外: 遅れた報酬も報酬も出ない。例外は外に出ない', async () => {
    for (const how of ['false', 'undefined', 'reject'] as const) {
      const { sdk, p, flow, st } = await wired();
      sdk.rewarded = (how === 'false' ? false : undefined) as unknown as boolean;
      const r = track(flow.requestReward('R2'));
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      expect(r.value(), how).toBe('failed');
      sdk.finish(how === 'reject');
      await flush();
      expect([st.grants, st.late, lateCalls(p)], how).toEqual([[], [], []]);
    }
    const { sdk, p, flow, st } = await wired();
    sdk.rewardedBreak = () => {
      throw new Error('sdk sync throw');
    };
    await expect(flow.requestReward('R2')).resolves.toBe('failed');
    expect([st.grants, st.late, lateCalls(p)]).toEqual([[], [], []]);
    expect(st.muted, '消音も解ける').toBe(false);
  });

  it('TS-146-04 開始の時間切れの後に遅れて onStart → true（今までの Q-45 の経路）: 遅れた報酬はちょうど 1 回、onPlaying は true → false の 1 往復', async () => {
    const { sdk, p, flow, st } = await wired();
    void flow.requestReward('R3');
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    sdk.start();
    sdk.finish();
    await flush();
    expect(st.late).toEqual(['R3']);
    expect(st.grants).toEqual(['R3']);
    expect(lateCalls(p)).toHaveLength(1);
    expect(st.playing).toEqual([true, false]);
  });
});

describe('BL-146 SDK が決まるまでの消音（決定 0012 の追記 Q-56）', () => {
  it('TS-146-05 (a) リワード: 30 秒の待ちの間も、時間切れで画面の側（ループ・入力）が戻った後も、決まるまで消音。決まったら解く', async () => {
    for (const how of ['true', 'false', 'reject', 'late-start'] as const) {
      const { sdk, p, flow, st } = await wired();
      sdk.rewarded = how !== 'false';
      expect(st.muted, `${how}: 要求の前`).toBe(false);
      void flow.requestReward('R2');
      await flush();
      expect([st.muted, st.loop, st.input], `${how}: 30 秒の待ちの間（叩いても鳴らない）`).toEqual([true, false, true]);
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      expect([st.loop, st.input], `${how}: 画面の側は戻る（叩けば打撃とコインは進む。Q-35 (d)）`).toEqual([true, false]);
      expect([st.muted, p.isMuted()], `${how}: 時間切れの後も消音`).toEqual([true, true]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(st.muted, how).toBe(true);
      if (how === 'late-start') {
        sdk.start();
        expect(st.muted).toBe(true);
      }
      sdk.finish(how === 'reject');
      await flush();
      expect([st.muted, p.isMuted()], `${how}: 決まったら解く（次の打撃から鳴る）`).toEqual([false, false]);
      expect(muteHolds(p), how).toEqual(['on', 'off']);
    }
  });

  it('TS-146-05 (b) ミッドゲーム（M1・M2）: 待ちの間も、30 秒で機会が終わった後も、commercialBreak が決まるまで消音', async () => {
    for (const placement of ['M1', 'M2'] as const) {
      const { sdk, flow, st } = await wired();
      flow.onEvents([{ type: 'BreakOpportunity', placement, band: 3 }]);
      await flush();
      expect(st.muted, placement).toBe(true);
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      expect([flow.breaking, st.loop, st.muted], placement).toEqual([false, true, true]);
      sdk.finish();
      await flush();
      expect(st.muted, placement).toBe(false);
    }
  });

  it('TS-146-05 ふつうの経路: 要求から決まるまで消音（on → off の 1 往復）。タイマーは残らない', async () => {
    const { sdk, flow, st, p } = await wired();
    const r = flow.requestReward('R3');
    await flush();
    expect(st.muted).toBe(true);
    sdk.start();
    sdk.finish();
    await expect(r).resolves.toBe('rewarded');
    expect(st.muted).toBe(false);
    expect(muteHolds(p)).toEqual(['on', 'off']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TS-146-06 ゲームの効果音の設定（オフ・途中で切り替え）を消音の解除が上書きしない（main.ts と同じく消音は sfx の setMuted へ。設定は setSfxEnabled。BL-045 の 2 本目）', async () => {
    // 本物の src/audio/sfx.ts（ZzFX と AudioContext は偽物。鳴った回数を数える）
    vi.resetModules();
    let played = 0;
    vi.doMock('zzfx', () => ({
      zzfx: () => {
        played++;
      },
      ZZFX: { volume: 0.3, audioContext: { state: 'running', resume: () => Promise.resolve() } },
    }));
    vi.stubGlobal('AudioContext', class {});
    try {
      const sfx = await import('../../src/audio/sfx.ts');
      await sfx.unlockAudio();
      sfx.playBreak();
      expect(played, '前提: 鳴る').toBe(1);
      // (a) 設定がオフのまま広告 → 時間切れ → 決まって消音が解けても、鳴らない
      sfx.setSfxEnabled(false);
      {
        const { sdk, flow } = await wired(sfx.setMuted);
        void flow.requestReward('R2');
        await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
        sdk.finish();
        await flush();
      }
      sfx.playBreak();
      expect(played, '消音の解除で設定のオフが上書きされない').toBe(1);
      // (b) 広告の間（消音中）に設定をオンにする → 決まるまでは鳴らない、決まったら鳴る
      {
        const { sdk, flow } = await wired(sfx.setMuted);
        void flow.requestReward('R2');
        await flush();
        sfx.setSfxEnabled(true);
        sfx.playBreak();
        expect(played, '消音中は設定をオンにしても鳴らない').toBe(1);
        await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
        sfx.playBreak();
        expect(played, '時間切れの後も決まるまでは鳴らない').toBe(1);
        sdk.finish();
        await flush();
      }
      sfx.playBreak();
      expect(played, '決まったら設定どおり鳴る').toBe(2);
      // (c) 広告の間に設定をオフにする → 決まって消音が解けても鳴らない
      {
        const { sdk, flow } = await wired(sfx.setMuted);
        void flow.requestReward('R2');
        await flush();
        sfx.setSfxEnabled(false);
        sdk.start();
        sdk.finish();
        await flush();
      }
      sfx.playBreak();
      expect(played).toBe(2);
    } finally {
      vi.doUnmock('zzfx');
      vi.unstubAllGlobals();
    }
  });

  it('TS-146-07 SDK の Promise がいつまでも決まらない: 消音は要求から AD_END_TIMEOUT_MS で解き（手前では消音）、calls() に muteHold: timeout。gameplayStart は送らないまま（#88）。例外なし・遊べる', async () => {
    const { sdk, flow, st, p } = await wired();
    void flow.requestReward('R2');
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS - 1);
    expect(st.muted).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect([st.muted, p.isMuted()]).toEqual([false, false]);
    expect(muteHolds(p)).toEqual(['on', 'timeout']);
    await vi.advanceTimersByTimeAsync(10 * 60_000 - AD_END_TIMEOUT_MS);
    expect([st.loop, st.input, st.muted]).toEqual([true, false, false]);
    expect(sdk.log, 'SDK には決まるまで gameplayStart を送らない（#88 の既知のこと）').toEqual(['gameplayStop', 'rewardedBreak']);
  });

  it('TS-146-07 消音の上限が来ても、遅れて始まった広告の再生中は消音のまま。再生の時間切れ（開始から AD_END_TIMEOUT_MS）で解く', async () => {
    const { sdk, flow, st, p } = await wired();
    void flow.requestReward('R2');
    await vi.advanceTimersByTimeAsync(120_000);
    sdk.start(); // 要求から 2 分で遅れて始まった
    await vi.advanceTimersByTimeAsync(AD_END_TIMEOUT_MS - 120_000);
    expect(muteHolds(p)).toEqual(['on', 'timeout']);
    expect([st.muted, p.isMuted()], '再生中は解かない').toEqual([true, true]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect([st.muted, p.isMuted()], '再生の時間切れで解く').toEqual([false, false]);
  });
});

describe('BL-146 ほかの仕組みとの関係', () => {
  it('TS-146-08 SDK への合図は stop → rewardedBreak → start の 1 往復のまま（#88）。遅れた報酬は SDK が決まった後に付き、合図は増えない', async () => {
    const { sdk, p, flow } = await wired();
    void flow.requestReward('R2');
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak']);
    sdk.finish();
    await flush();
    expect(sdk.log).toEqual(['gameplayStop', 'rewardedBreak', 'gameplayStart']);
    const names = p.calls().map((c) => c.name);
    expect(names.lastIndexOf('gameplayStart'), '遅れた報酬は SDK が決まった後').toBeLessThan(names.indexOf('lateReward'));
  });

  it('TS-146-09 時間切れ → チケットでブースト（−1）→ onStart なしで true: 休みの中なら 1 枚返す（二重にしない）。休みが明けた後ならふつうのブースト', async () => {
    const NOW = 1_800_000_000_000;
    for (const after of [false, true]) {
      const wall = { t: NOW };
      const s = stateWith({ depth: 10, coins: '1e6' });
      s.meta.tickets = 2;
      const store = new GameStore(s, {
        onError: (e) => {
          throw e;
        },
      });
      store.useWallClock(() => wall.t);
      const rewards = createRewardHooks(store);
      const sdk = pokiMock();
      sdk.manual = true;
      const p = createPokiPlatform({ getSdk: () => sdk });
      await p.init();
      const flow = createAdFlow({
        ads: p.ads,
        isMuted: () => p.isMuted(),
        life: { setPaused: () => {} },
        input: { setBlocked: () => {} },
        loop: { pause: () => {}, resume: () => {} },
        isHidden: () => false,
        setMuted: () => {},
        resumeAudio: () => {},
        saveBeforeAd: () => {},
        reserve: (x) => rewards.reserveAd(x),
        grant: (x) => rewards.grantAd(x),
        refund: (x) => rewards.refundAd(x),
        pauseForReward: true,
      });
      const told: [RewardPlacement, LateKind][] = [];
      flow.onLateReward((x, k) => void told.push([x, k]));
      const r: Promise<RewardResult> = flow.requestReward('R2');
      await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
      await expect(r).resolves.toBe('failed');
      rewards.useBoostTicket();
      expect(store.state.meta.tickets).toBe(1);
      if (after) wall.t = NOW + PARAMS.boost.cooldownMs;
      sdk.finish(); // onStart なしで true
      await flush();
      if (after) {
        expect(told, '休みが明けた後: ふつうのブースト').toEqual([['R2', 'reward']]);
        expect(store.state.meta.tickets).toBe(1);
      } else {
        expect(told, '休みの中: 返却').toEqual([['R2', 'refund']]);
        expect(store.state.meta.tickets).toBe(2);
      }
    }
  });

  it('TS-146-10 crazygames は変わらない: 開始の時間切れの後に adStarted なしで adFinished が来ても遅れた報酬は出さず、消音は muteAudio の設定のまま', async () => {
    const sdk = crazyMock('crazygames');
    const cbs: CgAdCallbacks[] = [];
    sdk.ad.requestAd = (type: CgAdType, cb: CgAdCallbacks) => {
      sdk.log.push(`requestAd:${type}`);
      cbs.push(cb);
    };
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    await p.init();
    const late: LateReward[] = [];
    const muted: boolean[] = [];
    p.ads.onLateReward((x) => void late.push(x));
    p.onMutedChange((m) => void muted.push(m));
    const r = track(p.ads.showRewarded('R2'));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect(r.value()).toBe('failed');
    expect(p.isMuted()).toBe(false);
    cbs[cbs.length - 1]?.adFinished?.();
    await flush();
    expect(late).toEqual([]);
    expect(muted).toEqual([]);
    expect(p.calls().some((c) => c.name === 'muteHold')).toBe(false);
  });
});
