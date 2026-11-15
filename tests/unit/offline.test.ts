// BL-030: オフラインの早送り・タブの復帰・おかえりの集計（gdd §9・QA §3-5）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { isHappyBatch } from '../../src/app/happy-time.ts';
import { GameStore } from '../../src/app/store.ts';
import { wireVisibility } from '../../src/app/pause-wiring.ts';
import {
  bathIncomePerSec,
  cloneState,
  createInitialState,
  dispatch,
  modifiers,
  num,
  offlineCapMs,
  offlineEfficiency,
  runOffline,
  stateHash,
  toStr,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { BOTS } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';
import { fcRuns } from '../helpers/fc-runs.ts';
import { stateWith } from '../support/states.ts';

const H = 3_600_000;
const MIN = 60_000;

/** 入湯料だけの状態（自動掘削機なし。深さは進まない） */
function incomeOnly(pump = 20, spring: 'simple' | 'salt' = 'simple'): GameState {
  const s = stateWith({ seed: 2, depth: 160, pumps: { [spring]: pump }, bath: 0 });
  s.run.bath.slots = [spring];
  return s;
}

const perSec = (s: GameState): number => bathIncomePerSec(s, modifiers(s)).toNumber();

describe('BL-030 付与量: 生産 × 効率 × 時間（上限で切る）', () => {
  it('入湯料 × 50% × 時間。コインは pendingOffline に入り、run.coins・stats.totalCoins は変わらない（受け取りで入る）', () => {
    const s = incomeOnly();
    const rate = perSec(s);
    const coins = s.run.coins.toString();
    const total = s.stats.totalCoins.toString();
    const out: GameEvent[] = [];
    const r = runOffline(s, 2 * H, out);
    expect(r.appliedMs).toBe(2 * H);
    expect(r.coins.toNumber()).toBeCloseTo(rate * 0.5 * 2 * 3600, 3);
    expect(s.run.pendingOffline?.coins.toNumber()).toBeCloseTo(rate * 0.5 * 7200, 3);
    expect(s.run.pendingOffline?.ms).toBe(2 * H);
    expect([s.run.coins.toString(), s.stats.totalCoins.toString()]).toEqual([coins, total]);
    expect(out.at(-1)).toEqual({ type: 'OfflineSummary', ms: 2 * H, appliedMs: 2 * H, coins: toStr(r.coins), meters: 0, springs: [] });
    // 受け取ると run.coins と stats.totalCoins に入る（二重に数えない）
    expect(dispatch(s, { type: 'claimOffline', mode: 'normal' }).ok).toBe(true);
    expect(s.stats.totalCoins.sub(num(total)).toNumber()).toBeCloseTo(r.coins.toNumber(), 3);
  });

  it('上限は 8 時間（3 日離れても 8 時間分）。木「留守番の番頭」で 12 時間・効率 +50%、塩化物泉で +25%（足し算、上限 100%）', () => {
    const s = incomeOnly();
    const r = runOffline(cloneState(s), 3 * 24 * H, []);
    expect(r.elapsedMs).toBe(3 * 24 * H);
    expect(r.appliedMs).toBe(8 * H);
    expect(r.coins.toNumber()).toBeCloseTo(perSec(s) * 0.5 * 8 * 3600, 2);
    const salt = incomeOnly(20, 'salt');
    expect(offlineEfficiency(salt)).toBe(0.75);
    const banto = incomeOnly();
    banto.meta.perks = ['yumori', 'banto'];
    expect([offlineEfficiency(banto), offlineCapMs(banto)]).toEqual([1, 12 * H]);
    const rb = runOffline(banto, 3 * 24 * H, []);
    expect(rb.appliedMs).toBe(12 * H);
    expect(rb.coins.toNumber()).toBeCloseTo(perSec(banto) * 1 * 12 * 3600, 2);
  });

  it('経過が負・NaN・Infinity（時計が戻った・壊れた）: 付与 0、状態は変わらない（集計の出来事だけ）', () => {
    for (const bad of [-5 * MIN, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 0]) {
      const s = incomeOnly();
      const before = cloneState(s);
      const out: GameEvent[] = [];
      const r = runOffline(s, bad, out);
      expect([r.elapsedMs, r.appliedMs, r.coins.toNumber()]).toEqual([0, 0, 0]);
      expect(s).toEqual(before);
      expect(out.map((e) => e.type)).toEqual(['OfflineSummary']);
    }
  });

  it('性質: 付与量 ≤ 上限時間 × 効率 × 生産量（入湯料だけの状態で、式どおり）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), fc.integer({ min: 0, max: 4 * 24 * H }), (pump, ms) => {
        const s = incomeOnly(pump);
        const rate = perSec(s);
        const cap = offlineCapMs(s);
        const r = runOffline(s, ms, []);
        const want = rate * offlineEfficiency(s) * (Math.min(ms, cap) / 1000);
        expect(r.coins.toNumber()).toBeLessThanOrEqual(rate * offlineEfficiency(s) * (cap / 1000) * (1 + 1e-9));
        expect(Math.abs(r.coins.toNumber() - want)).toBeLessThanOrEqual(want * 1e-9 + 1e-6);
      }),
      fcRuns(20),
    );
  });
});

describe('BL-030 進むもの・進まないもの', () => {
  it('自動掘削機の打撃（×効率）で深さが進み、源泉を見つける。タップ・長押し・自動掘りの基本は進まない。破壊・幕間・M2 の出来事は出さない', () => {
    const s = stateWith({ seed: 4, depth: 140, digger: 60, drill: 60, tool: 4, pumps: { simple: 10, co2: 10 }, bath: 5, hold: true, autoOn: true });
    const noDigger = cloneState(s);
    noDigger.run.autoDig.level = 0;
    const out: GameEvent[] = [];
    const r = runOffline(s, 1 * H, out);
    expect(r.meters).toBeGreaterThan(10);
    expect(r.springs).toContain('salt');
    expect(out.some((e) => e.type === 'SpringFound' && e.spring === 'salt')).toBe(true);
    expect(out.some((e) => e.type === 'BlockBroken' || e.type === 'StratumEntered' || e.type === 'BreakOpportunity')).toBe(false);
    expect(s.run.interludeMs).toBe(0);
    // 自動掘削機がなければ、長押し・自動掘りのスイッチがあっても掘らない
    expect(runOffline(noDigger, 1 * H, []).meters).toBe(0);
  });

  it('掘削ブーストの効果は進まず、×2 も効かない。休み（壁時計）には触れない。ラッキー鉱脈の出現（ロジックの時間）も進まない', () => {
    const s = stateWith({ seed: 4, depth: 140, digger: 60, drill: 60, tool: 4, pumps: { simple: 10, co2: 10 }, bath: 5 });
    s.run.boost = { remainingMs: 120_000, readyAtWallMs: 5_000_000 };
    s.run.vein = { nextAtMs: s.clock.playedMs + 1000, active: null };
    const plain = cloneState(s);
    plain.run.boost = { remainingMs: 0, readyAtWallMs: 5_000_000 };
    const played = s.clock.playedMs;
    const a = runOffline(s, 2 * H, []);
    const b = runOffline(plain, 2 * H, []);
    expect(a.coins.toString()).toBe(b.coins.toString());
    expect(s.run.depth).toBe(plain.run.depth);
    expect(s.run.depth).toBeGreaterThan(140); // 掘っている状態で比べる
    expect(s.run.boost).toEqual({ remainingMs: 120_000, readyAtWallMs: 5_000_000 });
    expect(s.clock.playedMs).toBe(played);
    expect(s.run.vein).toEqual({ nextAtMs: played + 1000, active: null });
  });

  it('受け取っていない前の値を上書きしない（足す）。新しく入れたら R1 の返却の印を外す', () => {
    const s = incomeOnly();
    s.run.pendingOffline = { coins: num(1000), ms: 10 * MIN };
    s.run.ticketPaid = { R1: true, R2: true };
    const r = runOffline(s, 1 * H, []);
    expect(s.run.pendingOffline?.coins.toNumber()).toBeCloseTo(1000 + r.coins.toNumber(), 6);
    expect(s.run.pendingOffline?.ms).toBe(10 * MIN + H);
    expect(s.run.ticketPaid).toEqual({ R2: true });
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R1' }).ok).toBe(false); // 前の復帰の分は返さない
  });

  it('1 時間を超える分は 10 秒刻み: 入湯料だけなら 1 秒刻みと同じ額（刻みによらない）', () => {
    const s = incomeOnly(33);
    const r = runOffline(s, 5 * H + 1234, []);
    expect(r.coins.toNumber()).toBeCloseTo(perSec(incomeOnly(33)) * 0.5 * ((5 * H + 1234) / 1000), 3);
  });
});

describe('BL-030 ストアの復帰（GameStore.resume）', () => {
  const storeWith = (s: GameState, wall: number) => {
    const store = new GameStore(s);
    store.useWallClock(() => wall);
    return store;
  };

  it('60 秒未満: オンラインの規則（効率 100%）で追いつき、おかえりは出ない（pendingOffline は入らない）', () => {
    const s = incomeOnly();
    const rate = perSec(s);
    const store = storeWith(s, 2_000_000_000_000);
    const evs: GameEvent[][] = [];
    store.onEvents((e) => evs.push([...e]));
    const before = s.run.coins.toNumber();
    expect(store.resume(59_000, 1_999_999_941_000)).toBeNull();
    expect(store.state.run.pendingOffline).toBeNull();
    expect(store.state.run.coins.toNumber() - before).toBeCloseTo(rate * 59, 3);
    expect(evs.flat().some((e) => e.type === 'OfflineSummary')).toBe(false);
  });

  it('60 秒ちょうど以上: オフラインの規則・おかえり・集計の出来事。負は何もしない', () => {
    const store = storeWith(incomeOnly(), 2_000_000_000_000);
    const evs: GameEvent[] = [];
    store.onEvents((e) => evs.push(...e));
    const r = store.resume(60_000, 1_999_999_940_000);
    expect(r?.appliedMs).toBe(60_000);
    expect(store.state.run.pendingOffline?.ms).toBe(60_000);
    expect(evs.filter((e) => e.type === 'OfflineSummary')).toHaveLength(1);
    const before = cloneState(store.state);
    expect(store.resume(-10 * MIN, 0)).toBeNull();
    expect(store.state).toEqual(before);
  });

  it('早送りの中の初来訪: 図鑑の時刻は「留守の始め＋その来訪までの経過」（0 のまま残らない。PR #20 のレビュー S-2・案 B）', () => {
    // 単純温泉の手前・自動掘削機あり・枠が空き → 30m で単純温泉を見つけて枠につなぎ、タヌキが初めて来る
    const s = stateWith({ seed: 6, depth: 25, digger: 40, drill: 20, tool: 2 });
    const from = 1_900_000_000_000;
    const store = storeWith(s, from + 2 * H);
    const r = store.resume(2 * H, from);
    expect(r?.springs).toContain('simple');
    const at = r?.guestFirstAtMs.tanuki;
    expect(at).toBeGreaterThan(0);
    expect(store.state.collection.guestsSeen.tanuki).toBe(from + (at ?? 0));
  });

  it('happytime はバッチで 1 回まで（最初の源泉とお客さんの初来訪が同じ早送りで起きても）', () => {
    const s = stateWith({ seed: 6, depth: 25, digger: 40, drill: 20, tool: 2 });
    const evs: GameEvent[] = [];
    runOffline(s, 2 * H, evs);
    expect(evs.filter((e) => e.type === 'SpringFound' || (e.type === 'GuestArrived' && e.first)).length).toBeGreaterThanOrEqual(2);
    expect(isHappyBatch(evs, s)).toBe(true); // main.ts はバッチごとに 1 回だけ happyTime を呼ぶ
    expect(isHappyBatch([], s)).toBe(false);
  });
});

describe('BL-030 タブの非表示と復帰（app/pause-wiring.ts の wireVisibility の away）', () => {
  it('隠れた時刻を覚え、見えたら「追いつき → hidden を外す」の順で、離れていた時間と隠れた時刻を渡す', () => {
    let wall = 1_000_000;
    let hidden = false;
    const calls: string[] = [];
    const vis = wireVisibility({
      life: { setPaused: (r, on) => calls.push(`${r}:${on}`) },
      ads: { syncHidden: () => calls.push('sync'), setPrestigeConfirm: () => undefined },
      isHidden: () => hidden,
      prestigeConfirm: { onChange: () => () => undefined, dismiss: () => calls.push('dismiss') },
      away: { wallNow: () => wall, resume: (ms, from) => calls.push(`resume:${ms}:${from}`) },
    });
    calls.length = 0;
    hidden = true;
    vis.onVisibilityChange();
    wall += 90_000;
    vis.onVisibilityChange(); // 続けて hidden（最初の時刻のまま）
    hidden = false;
    wall += 1_000;
    vis.onVisibilityChange();
    expect(calls).toEqual(['hidden:true', 'dismiss', 'sync', 'hidden:true', 'dismiss', 'sync', 'resume:91000:1000000', 'hidden:false', 'sync']);
    vis.onVisibilityChange(); // 見えたまま: 何も追いつかない
    expect(calls.filter((c) => c.startsWith('resume'))).toHaveLength(1);
  });
});

describe('BL-030 「8 時間放置 → 復帰」（標準ボット・シード 1 で 30 分遊んだ後に 8 時間）', () => {
  it('stateHash が固定値と一致し、オフラインで掘る深さが上限（100m。確認事項 #12。技術リードの決め）以下', () => {
    let s: GameState = createInitialState(0);
    runBot(BOTS.standard, { hours: 0.5, stepMs: 1000, seed: 1, setup: (x) => (s = x) });
    const depth = s.run.depth;
    const r = runOffline(s, 8 * H, []);
    expect(r.appliedMs).toBe(PARAMS.offline.capMs);
    expect(r.meters).toBeGreaterThan(0);
    expect(r.meters).toBeLessThanOrEqual(100);
    expect(s.run.depth).toBe(depth + r.meters);
    expect(stateHash(s)).toBe(OFFLINE_8H_HASH);
  });
});

/** 「8 時間放置 → 復帰」の固定値。ボット・core・content を意図して変えて結果が変わったら更新し、理由を PR に書く */
const OFFLINE_8H_HASH = '05395faa';
