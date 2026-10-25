// BL-021: 転生の表示の値（prestigeView）とリセットの範囲（gdd §5-8）。TS-ID はテスト設計者のシナリオ（BL-021_prestige.md）。表の残りは prestige-scenarios.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import {
  cloneState,
  createRun,
  depthForGain,
  dispatch,
  gainTickets,
  num,
  prestigeView,
  toStr,
  yunohanaGain,
  yunohanaMult,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { botAct, BOTS, newBotMemory } from '../../tools/sim/bots.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { fcRuns } from '../helpers/fc-runs.ts';
import { stateWith } from '../support/states.ts';

const P = PARAMS.prestige;
const gainAt = (d: number): number => Math.floor((d / P.divisor) ** 2);

describe('TS-021-02 depthForGain（湯の華が g になる最小の深さ）', () => {
  it('gdd の例: 9→150、16→200、36→300、64→400、100→500。10 は 159m（158m では 9）', () => {
    expect([9, 16, 36, 64, 100].map(depthForGain)).toEqual([150, 200, 300, 400, 500]);
    expect(depthForGain(10)).toBe(159);
    expect(gainAt(158)).toBe(9);
  });
  it('解放の深さより浅くはならない（g が 0〜9 なら 150m）', () => {
    for (let g = 0; g <= 9; g++) expect(depthForGain(g)).toBe(P.unlockDepth);
  });
  it('g＝1〜5000: その深さで g 以上、1m 浅いと g 未満（解放の深さを除く）', () => {
    for (let g = 10; g <= 5000; g++) {
      const d = depthForGain(g);
      expect(gainAt(d)).toBeGreaterThanOrEqual(g);
      expect(gainAt(d - 1)).toBeLessThan(g);
    }
  });
});

describe('BL-021 prestigeView（T4・確認の画面に出す値）', () => {
  it('TS-021-05 新しいゲーム: 未解放・転生できない・湯の華 0・次は 150m・チケットは 2 枚とも入る', () => {
    const v = prestigeView(stateWith({}));
    expect(v).toMatchObject({ unlocked: false, unlockDepth: 150, canPrestige: false, runMaxDepth: 0, nextGainDepth: 150, recommended: false, ticketsGain: 2, ticketsAdded: 2 });
    expect(v.gain.toNumber()).toBe(0);
    expect(v.multNow.toNumber()).toBe(1);
    expect(v.multAfter.toNumber()).toBe(1);
  });

  it('TS-021-05・23 160m: 解放・転生できる・湯の華 10・次の +1 は 166m。転生の後の値（累計・倍率）は実際に転生した結果と同じ', () => {
    const s = stateWith({ depth: 160 });
    s.meta.yunohana.lifetime = num(20);
    const v = prestigeView(s);
    expect(v).toMatchObject({ unlocked: true, canPrestige: true, runMaxDepth: 160, nextGainDepth: 166, recommended: false });
    expect(v.gain.toNumber()).toBe(10);
    expect(v.multNow.toNumber()).toBeCloseTo(1.4, 12);
    expect(v.multAfter.toNumber()).toBeCloseTo(1.6, 12);
    const t = cloneState(s);
    expect(dispatch(t, { type: 'prestige' }).ok).toBe(true);
    expect(t.meta.yunohana.lifetime.toNumber()).toBe(v.lifetimeAfter.toNumber());
    expect(yunohanaMult(t).toNumber()).toBeCloseTo(v.multAfter.toNumber(), 12);
  });

  it('TS-021-09 転生の推奨は湯の華 30 から（273m は 29、274m は 30）', () => {
    expect(prestigeView(stateWith({ depth: 273 })).recommended).toBe(false);
    expect(prestigeView(stateWith({ depth: 274 })).recommended).toBe(true);
    expect(P.recommendGain).toBe(30);
  });

  it('TS-021-05 (D) 転生の後の周回の始め: タブは解放のまま（セーブ全体の最深）、転生はできない', () => {
    const s = stateWith({ depth: 200 });
    dispatch(s, { type: 'prestige' });
    const v = prestigeView(s);
    expect(v).toMatchObject({ unlocked: true, canPrestige: false, runMaxDepth: 0, nextGainDepth: 150 });
  });

  it('TS-021-13 チケットが上限の近く: 実際に増える枚数を出す（9 枚なら 1、10 枚なら 0）。転生の結果と同じ', () => {
    for (const [have, added] of [
      [8, 2],
      [9, 1],
      [10, 0],
    ] as const) {
      const s = stateWith({ depth: 160 });
      s.meta.tickets = have;
      expect(prestigeView(s).ticketsAdded).toBe(added);
      dispatch(s, { type: 'prestige' });
      expect(s.meta.tickets).toBe(have + added);
    }
  });

  it('prestigeView は状態を変えない', () => {
    const s = stateWith({ depth: 320 });
    const before = JSON.stringify(cloneState(s));
    prestigeView(s);
    expect(JSON.stringify(cloneState(s))).toBe(before);
  });
});

describe('TS-021-16 リセットの範囲（gdd §5-8。fast-check）', () => {
  // 周回（run）は新しい周回に戻り（地形・掘削ブーストは残す）、それ以外（湯の華・チケット・図鑑・実績・統計・チュートリアル・解放済みの地形）は残る
  it('転生できる任意の状態で: 周回は初期化、残るものは残る、湯の華と回数とチケットだけが規則どおりに増える', () => {
    fc.assert(
      fc.property(gameStateArb, fc.integer({ min: P.unlockDepth, max: 2000 }), (g, maxDepth) => {
        const s: GameState = cloneState(g);
        s.run.maxDepth = Math.max(s.run.maxDepth, maxDepth);
        const before = cloneState(s);
        const gain = yunohanaGain(before);
        const r = dispatch(s, { type: 'prestige' });
        expect(r.ok).toBe(true);
        // 周回: 新しい周回（シードは擬似乱数から。地形・掘削ブーストは引き継ぐ）
        const fresh = createRun(s.run.seed, before.run.terrain);
        expect({ ...s.run, boost: fresh.boost }).toEqual(fresh);
        expect(s.run.boost).toEqual(before.run.boost);
        // 残るもの
        expect(s.collection).toEqual(before.collection);
        expect(s.tutorial).toEqual(before.tutorial);
        expect(s.meta.perks).toEqual(before.meta.perks);
        expect(s.meta.terrainsUnlocked).toEqual(before.meta.terrainsUnlocked);
        expect(s.meta.endingSeen).toBe(before.meta.endingSeen);
        expect(s.meta.yunohana.spent).toEqual(before.meta.yunohana.spent);
        expect({ ...s.stats, totalCoins: null }).toEqual({ ...before.stats, totalCoins: null });
        expect(s.stats.totalCoins.eq(before.stats.totalCoins)).toBe(true); // 上限を超えたチケットをコインに替えない（Q-47 (d)）
        expect(s.clock).toEqual(before.clock);
        // 増えるもの
        expect(s.meta.prestiges).toBe(before.meta.prestiges + 1);
        expect(s.meta.yunohana.lifetime.toString()).toBe(before.meta.yunohana.lifetime.add(gain).toString());
        expect(s.meta.tickets).toBe(Math.min(PARAMS.tickets.max, before.meta.tickets + PARAMS.tickets.prestige));
        expect(r.events.map((e) => e.type)).toEqual(['PrestigeDone', 'TicketGained', 'BreakOpportunity']);
      }),
      fcRuns(150),
    );
  });

  it('TS-021-19 解放の深さに届いていない周回では転生できず、状態は変わらない', () => {
    const s = stateWith({ depth: 149 });
    const before = JSON.stringify(cloneState(s));
    expect(dispatch(s, { type: 'prestige' })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(JSON.stringify(cloneState(s))).toBe(before);
  });
});

describe('BL-021 転生の推奨の基準（CEO 回答 2026-10-18: 前回の獲得の 1.5 倍、最低 30）と「あと何 m」', () => {
  it('TS-021-10 1 周目は 30。前回 36 なら 54、前回 10 なら 30（最低）。前回 9 の 1.5 倍＝13.5 は 30 に届かない', () => {
    const s = stateWith({ depth: 300 });
    expect(prestigeView(s).recommendAt).toBe(30);
    for (const [last, at] of [
      [36, 54],
      [10, 30],
      [9, 30],
      [21, 32], // 31.5 → 32（湯の華は整数なので切り上げ）
      [64, 96],
    ] as const) {
      s.meta.lastPrestigeGain = num(last);
      expect(prestigeView(s).recommendAt, String(last)).toBe(at);
    }
  });
  it('TS-021-11 転生すると lastPrestigeGain が今回の獲得になり、次の周回の基準が上がる', () => {
    const s = stateWith({ depth: 300 }); // 36
    dispatch(s, { type: 'prestige' });
    expect(s.meta.lastPrestigeGain.toNumber()).toBe(36);
    expect(prestigeView(s).recommendAt).toBe(54);
    s.run.maxDepth = 367; // floor(7.34²)=53
    expect(prestigeView(s).recommended).toBe(false);
    s.run.maxDepth = 368; // floor(7.36²)=54
    expect(prestigeView(s).recommended).toBe(true);
  });
  it('TS-021-05 あと何 m: 120m なら 30、150m 以上なら 0', () => {
    expect(prestigeView(stateWith({ depth: 120 })).metersToUnlock).toBe(30);
    expect(prestigeView(stateWith({ depth: 150 })).metersToUnlock).toBe(0);
    expect(prestigeView(stateWith({ depth: 400 })).metersToUnlock).toBe(0);
  });
});

describe('BL-021 CEO 決定（10/18。Q-47 (c) (d) (m)）', () => {
  it('TS-021-13・15 (d) チケットが上限のとき: 入らない分はコインにしない（チケット 9 → +1・捨てる 1、10 → +0・捨てる 2）。確認の画面の値（ticketsAdded・ticketsOverflow）と結果が一致する', () => {
    for (const [have, added, overflow] of [
      [7, 2, 0],
      [8, 2, 0],
      [9, 1, 1],
      [10, 0, 2],
    ] as const) {
      const s = stateWith({ depth: 300 });
      s.meta.tickets = have;
      const v = prestigeView(s);
      expect([v.ticketsAdded, v.ticketsOverflow], `tickets ${have}`).toEqual([added, overflow]);
      const totalBefore = s.stats.totalCoins;
      const r = dispatch(s, { type: 'prestige' });
      expect(r.ok).toBe(true);
      expect(s.meta.tickets).toBe(have + added);
      expect(s.run.coins.eq(0), `tickets ${have}`).toBe(true);
      expect(s.stats.totalCoins.eq(totalBefore), `tickets ${have}`).toBe(true);
      expect(r.events.filter((e) => e.type === 'TicketGained')).toEqual([
        { type: 'TicketGained', source: 'prestige', n: added, overflow, coins: toStr(num(0)) },
      ]);
    }
  });

  it('TS-021-15・Q-50 (a) gainTickets の overflowToCoins: false は、収入がある状態でも上限を超えた分をコインにしない（既定は今までどおり替える）', () => {
    const rich = (): GameState => {
      const s = stateWith({ bath: 5, pumps: { simple: 15 } });
      s.meta.tickets = 10;
      return s;
    };
    const a = rich();
    const outA: GameEvent[] = [];
    gainTickets(a, 'prestige', 2, outA, { overflowToCoins: false });
    expect(a.run.coins.eq(0)).toBe(true);
    expect(outA).toEqual([{ type: 'TicketGained', source: 'prestige', n: 0, overflow: 2, coins: toStr(num(0)) }]);
    const b = rich();
    gainTickets(b, 'vein', 2, []);
    expect(b.run.coins.gt(0)).toBe(true); // 対照: 収入がある状態なので、既定では替える
  });

  it('TS-021-45・36（core の分）(m) 転生の確定の直後に M1 の機会（PrestigeDone → TicketGained → BreakOpportunity M1）。onPrestige が false なら出さない', () => {
    const s = stateWith({ depth: 160 });
    const r = dispatch(s, { type: 'prestige' });
    expect(r.events.at(-1)).toEqual({ type: 'BreakOpportunity', placement: 'M1' });
    const flags = PARAMS.ads.midgame as { onPrestige: boolean };
    const prev = flags.onPrestige;
    flags.onPrestige = false;
    try {
      const t = stateWith({ depth: 160 });
      expect(dispatch(t, { type: 'prestige' }).events.map((e) => e.type)).toEqual(['PrestigeDone', 'TicketGained']);
    } finally {
      flags.onPrestige = prev;
    }
    // 転生できないときは機会も出ない
    expect(dispatch(stateWith({ depth: 149 }), { type: 'prestige' }).events).toEqual([]);
  });

  it('TS-021-12 (c) ボットの転生の判断は T4 の推奨と同じ関数（recommendThreshold）: 前回 21 → 31 では転生せず、32 で転生する（セーブの前回の値を見る）', () => {
    const at = (depth: number): GameState => {
      const s = stateWith({ depth });
      s.meta.prestiges = 1;
      s.meta.lastPrestigeGain = num(21);
      return s;
    };
    expect([yunohanaGain(at(282)).toNumber(), yunohanaGain(at(283)).toNumber()]).toEqual([31, 32]);
    for (const [depth, want] of [
      [282, 1],
      [283, 2],
    ] as const) {
      const s = at(depth);
      expect(prestigeView(s).recommended).toBe(want === 2);
      botAct(s, BOTS.standard, newBotMemory());
      expect(s.meta.prestiges, `depth ${depth}`).toBe(want);
    }
  });
});
