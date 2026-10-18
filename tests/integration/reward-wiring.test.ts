// @vitest-environment jsdom
// BL-059（BL-046 の後の結線）: ご褒美の口（app/rewards.ts）を core の useBoost・openVein・claimOffline につなぎ、
// 画面（btn-boost・シート・おかえり）を core の boostView・veinView・offlineClaimView から作る
// - 壁時計は store.wallTime()（store が R2 の休みを切り詰めるのと同じ時計。PR #42 のレビューの Should）
// - ブースト中の表記は実際の倍率（ドリル ×2・自動掘削機 ×4。PR #34 のレビューの Nit）
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createRewardHooks } from '../../src/app/rewards.ts';
import { GameStore } from '../../src/app/store.ts';
import { PARAMS } from '../../src/content/params.ts';
import type { RewardResult } from '../../src/platform/types.ts';
import { boostMult, boostView as coreBoostView, num, toStr } from '../../src/core/index.ts';
import { boostView } from '../../src/ui/overlay/boost-view.ts';
import { stateWith } from '../support/states.ts';
import { mount, uiPlatform, type Mounted } from '../support/ui.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const CD = PARAMS.boost.cooldownMs;

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

function storeAt(wall: { t: number }, tickets = 2): GameStore {
  const s = stateWith({ depth: 10 });
  s.meta.tickets = tickets;
  const store = new GameStore(s, { onError: (e) => { throw e; } });
  store.useWallClock(() => wall.t);
  return store;
}

describe('ご褒美の口（createRewardHooks）', () => {
  it('TS-126-13 useBoostTicket: store の壁時計で休みを始め、チケットを 1 枚使う。休みの間は失敗して状態を変えない', () => {
    const wall = { t: NOW };
    const store = storeAt(wall);
    const r = createRewardHooks(store);
    r.useBoostTicket();
    expect(store.state.meta.tickets).toBe(1);
    expect(store.state.run.boost.remainingMs).toBe(PARAMS.boost.durationMs);
    expect(store.state.run.boost.readyAtWallMs).toBe(NOW + CD);
    wall.t = NOW + 10 * MIN;
    r.useBoostTicket();
    expect(store.state.meta.tickets).toBe(1);
    expect(store.state.run.boost.readyAtWallMs).toBe(NOW + CD);
  });

  it('TS-126-13 grantAd: R2 は source=ad（チケットを使わない）、R3 は出ている鉱脈を開く、R1 は ×2 で受け取る', () => {
    const store = storeAt({ t: NOW });
    const r = createRewardHooks(store);
    const ev = (): string[] => store.events().map((e) => e.type);
    r.grantAd('R2');
    expect(store.state.meta.tickets).toBe(2);
    expect(store.state.run.boost.readyAtWallMs).toBe(NOW + CD);
    expect(ev()).toContain('BoostStarted');

    store.state.run.vein.active = { depth: store.state.run.depth, hits: 3, expiresAtMs: store.state.clock.playedMs + 60_000 };
    r.grantAd('R3');
    expect(store.state.run.vein.active).toBeNull();

    store.state.run.pendingOffline = { coins: num(1000), ms: 5 * MIN };
    const before = store.state.run.coins;
    r.grantAd('R1');
    expect(store.state.run.pendingOffline).toBeNull();
    expect(toStr(store.state.run.coins)).toBe(toStr(before.add(2000)));
    expect(store.state.meta.tickets).toBe(2);
  });

  it('TS-126-13 claimOffline: normal は ×1（チケットを使わない）、double はチケット 1 枚で ×2。60 秒未満の double は失敗', () => {
    const store = storeAt({ t: NOW }, 1);
    const r = createRewardHooks(store);
    store.state.run.pendingOffline = { coins: num(100), ms: 30_000 };
    r.claimOffline('double');
    expect(store.state.run.pendingOffline).not.toBeNull(); // locked
    expect(store.state.meta.tickets).toBe(1);
    r.claimOffline('normal');
    expect(store.state.run.pendingOffline).toBeNull();
    expect(store.state.meta.tickets).toBe(1);
    store.state.run.pendingOffline = { coins: num(100), ms: 5 * MIN };
    const before = store.state.run.coins;
    r.claimOffline('double');
    expect(store.state.meta.tickets).toBe(0);
    expect(toStr(store.state.run.coins)).toBe(toStr(before.add(200)));
  });
});

describe('btn-boost は core の boostView から作り、store と同じ時計で読む', () => {
  it('TS-126-15 時計が戻って保存の readyAtWallMs が 1 日先でも、休みの残りは core の上限（15:00）で出す', () => {
    const s = stateWith({ depth: 10 });
    s.run.boost.readyAtWallMs = NOW + 24 * 60 * MIN;
    expect(coreBoostView(s, NOW).cooldownLeftMs).toBe(CD);
    expect(boostView(s, NOW, true, true)).toEqual({ state: 'cooldown', time: '15:00' });
  });

  it('TS-126-15 HUD は store.wallTime() を読む（UiContext に別の時計はない）', () => {
    const wall = { t: NOW };
    const store = storeAt(wall);
    store.state.run.boost.readyAtWallMs = NOW + 10 * MIN;
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    const b = m.get('btn-boost');
    expect(b.dataset['state']).toBe('cooldown');
    expect(b.textContent).toContain('10:00');
    wall.t = NOW + 10 * MIN;
    m.notify();
    expect(m.get('btn-boost').dataset['state']).toBe('ready');
  });

  it('TS-126-15 オフライン中に効果が残ったまま休みが明けたら、core で使えるので ready（判定と表示の出どころを 1 つに。CEO 決定 2026-10-12）', () => {
    const s = stateWith({ depth: 10 });
    s.meta.tickets = 1;
    s.run.boost.remainingMs = 120_000;
    s.run.boost.readyAtWallMs = NOW - 1;
    expect(coreBoostView(s, NOW)).toMatchObject({ active: true, canUse: true, reason: null });
    expect(boostView(s, NOW, false, true)).toEqual({ state: 'ready', time: null });
    expect(boostView(s, NOW, false, false)).toEqual({ state: 'unavailable', time: null });
    s.run.boost.readyAtWallMs = NOW + 1000;
    expect(boostView(s, NOW, false, true)).toEqual({ state: 'active', time: '2:00' });
  });

  it('TS-126-01 ブースト中は実際の倍率: 基本は ×2 だけ。自動掘削機を持っているときだけ、アイテムの名前で ×4 を足す（PR #55 のレビュー S-1。「自動」と書かない）', () => {
    expect(boostMult()).toEqual({ drill: PARAMS.boost.mult, auto: PARAMS.boost.mult ** 2 });
    expect(boostMult().auto).toBe(4);
    const store = storeAt({ t: NOW });
    store.state.run.boost.remainingMs = 299_001;
    store.state.run.boost.readyAtWallMs = NOW + 899_001;
    store.state.run.autoDig.level = 0;
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    const state = (): string => m!.get('btn-boost').querySelector('.act-state')!.textContent ?? '';
    expect(state()).toBe('×2 5:00');
    expect(m.get('btn-boost').getAttribute('aria-label')).toBe('Boost: ×2 5:00');
    store.state.run.autoDig.level = 1;
    m.notify();
    expect(state()).toBe('×2 (digger ×4) 5:00');
    expect(m.get('btn-boost').getAttribute('aria-label')).toBe('Boost: ×2 (digger ×4) 5:00');
    m.unmount();
    m = mount({ store, lang: 'ja', ctx: { rewards: createRewardHooks(store) } });
    expect(state()).toBe('×2（掘削機×4） 5:00');
    for (const el of [m.get('btn-boost'), m.get('toggle-auto-dig')]) expect(el.textContent).not.toMatch(/自動×|auto ×/);
  });

  it('TS-126-14 チケットで使うと、btn-boost は active になり、チケットが 1 枚減る（シート → sheet-ticket）', () => {
    const store = storeAt({ t: NOW });
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    expect(m.get('btn-boost').dataset['state']).toBe('ready');
    m.click('btn-boost');
    expect(m.get('sheet-reward').textContent).toContain('auto-digger coins ×4'); // シートの説明もアイテムの名前（S-1）
    m.click('sheet-ticket');
    expect(store.state.meta.tickets).toBe(1);
    expect(m.get('btn-boost').dataset['state']).toBe('active');
  });
});

describe('鉱脈（veinView）とおかえり（offlineClaimView）', () => {
  it('TS-126-12 R3 のシートの「自分で叩く」は残りの回数。鉱脈が消えたらシートを閉じる', () => {
    const store = storeAt({ t: NOW });
    store.state.run.vein.active = { depth: store.state.run.depth, hits: 5, expiresAtMs: store.state.clock.playedMs + 60_000 };
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    m.click('chip-vein');
    expect(m.get('sheet-hits').textContent).toContain(String(PARAMS.vein.hits - 5));
    store.state.run.vein.active = null;
    m.notify();
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('未受け取りのオフライン収入があれば、おかえりを出し、「受け取る」で ×1 を受け取って閉じる。口がなければ出さない', () => {
    const store = storeAt({ t: NOW });
    store.state.run.pendingOffline = { coins: num(1234), ms: 5 * MIN };
    m = mount({ store });
    expect(m.q('modal-welcome')).toBeNull();
    m.unmount();
    const before = store.state.run.coins;
    m = mount({ store, ctx: { rewards: createRewardHooks(store), platform: uiPlatform() } });
    expect(m.get('welcome-amount').textContent).toContain('1.23K'); // 表記は HUD と同じ formatNum
    m.click('welcome-claim');
    expect(store.state.run.pendingOffline).toBeNull();
    expect(toStr(store.state.run.coins)).toBe(toStr(before.add(1234)));
    expect(m.q('modal-welcome')).toBeNull();
  });

  it('TS-126-08 おかえりの「チケットで ×2」: チケットが 1 枚減り、コインが ×2 入り、閉じる（onWelcome の ticket → claimOffline(double)。PR #55 のレビュー S-3）', () => {
    const store = storeAt({ t: NOW }, 2);
    store.state.run.pendingOffline = { coins: num(100), ms: 5 * MIN };
    const before = store.state.run.coins;
    m = mount({ store, ctx: { rewards: createRewardHooks(store), platform: uiPlatform() } });
    expect(m.get('welcome-ticket').hasAttribute('disabled')).toBe(false);
    m.click('welcome-ticket');
    expect(store.state.meta.tickets).toBe(1);
    expect(toStr(store.state.run.coins)).toBe(toStr(before.add(200)));
    expect(store.state.run.pendingOffline).toBeNull();
    expect(m.q('modal-welcome')).toBeNull();
  });

  it('S-5（PR #55 のレビュー）: R3 の動画の要求中に鉱脈が消えてもシートは閉じない。予約しているので、見終えたら報酬が付き、シートが閉じる', async () => {
    const store = storeAt({ t: NOW });
    store.state.run.vein.active = { depth: store.state.run.depth, hits: 0, expiresAtMs: store.state.clock.playedMs + 60_000 };
    const hooks = createRewardHooks(store);
    let resolve: ((r: RewardResult) => void) | null = null;
    // BL-059 の広告の流れと同じ順: 予約 → 広告 → rewarded なら grantAd
    const requestReward = (p: 'R1' | 'R2' | 'R3'): Promise<RewardResult> => {
      hooks.reserveAd(p);
      return new Promise<RewardResult>((r) => {
        resolve = r;
      }).then((r) => {
        if (r === 'rewarded') hooks.grantAd(p);
        return r;
      });
    };
    const platform = uiPlatform('crazygames');
    platform.ads.rewardedAvailable = () => true;
    m = mount({ store, ctx: { rewards: hooks, requestReward, platform } });
    m.click('chip-vein');
    m.click('sheet-video');
    m.run((st) => st.advance(61_000)); // 要求の間に鉱脈が消える
    expect(store.state.run.vein.active).toBeNull();
    expect(m.q('sheet-reward')).not.toBeNull(); // 要求中は閉じない（Q-41 (b)）
    const opened: string[] = [];
    store.onEvents((evs) => {
      for (const e of evs) if (e.type === 'VeinOpened') opened.push(e.source);
    });
    await act(async () => {
      resolve?.('rewarded');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(opened).toEqual(['ad']); // 消えた鉱脈の報酬（予約。1 回）
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('S-4（PR #55 のレビュー）: おかえりの「チケットで ×2」が core で断られても（押した時にはチケットが 0 枚）、×1 で受け取って閉じる', () => {
    const store = storeAt({ t: NOW }, 1);
    store.state.run.pendingOffline = { coins: num(100), ms: 5 * MIN };
    const before = store.state.run.coins;
    m = mount({ store, ctx: { rewards: createRewardHooks(store), platform: uiPlatform() } });
    store.state.meta.tickets = 0; // 描画の後にチケットがなくなった（通知の前に押す）
    m.click('welcome-ticket');
    expect(toStr(store.state.run.coins)).toBe(toStr(before.add(100)));
    expect(store.state.run.pendingOffline).toBeNull();
    expect(m.q('modal-welcome')).toBeNull();
  });

  it('S-4: 受け取りがどれも効かなくても、モーダルの操作は止まらない（もう一度押せる。閉じられないモーダルを残さない）', () => {
    const store = storeAt({ t: NOW });
    store.state.run.pendingOffline = { coins: num(100), ms: 5 * MIN };
    const calls: string[] = [];
    const rewards = { useBoostTicket: () => {}, claimOffline: (mode: 'normal' | 'double') => void calls.push(mode), grantAd: () => {} };
    m = mount({ store, ctx: { rewards, platform: uiPlatform() } });
    m.click('welcome-claim');
    m.click('welcome-claim');
    expect(calls).toEqual(['normal', 'normal']); // 1 回目が効かなかったので、もう一度押せた
    expect(m.q('modal-welcome')).not.toBeNull();
  });

  it('留守が 60 秒未満なら、おかえりの ×2（チケット）は押せない', () => {
    const store = storeAt({ t: NOW });
    store.state.run.pendingOffline = { coins: num(10), ms: 30_000 };
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    expect(m.get('welcome-ticket').hasAttribute('disabled')).toBe(true);
    expect(m.q('welcome-video')).toBeNull();
  });
});
