// BL-021: テスト設計者のシナリオ（org の BL-021_prestige.md。TS-021-01〜45）のうち、実装先が BL-021 で、prestige.test.ts・
// save-migrate.test.ts だけでは足りなかったもの（参考値の表・状態の表・境界・決定的・二重の転生・周回をまたぐもの）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import {
  bathIncomePerSec,
  blockValue,
  cloneState,
  createRun,
  dispatch,
  drillPower,
  isOre,
  num,
  offlineEfficiency,
  prestigeView,
  recommendThreshold,
  stateHash,
  step,
  yunohanaGain,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { botAct, BOTS, newBotMemory } from '../../tools/sim/bots.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { fcRuns } from '../helpers/fc-runs.ts';
import { stateWith } from '../support/states.ts';

const P = PARAMS.prestige;
const APP = '0.0.1';

/** 周回の最深 run と、セーブ全体の最深 best（run 以上に合わせる）の状態 */
const at = (run: number, best = run): GameState => {
  const s = stateWith({ depth: run });
  s.stats.bestDepth = Math.max(best, run);
  return s;
};
const reload = (s: GameState): GameState => {
  const r = decodeSave(encodeSave(s, 1, 1, APP));
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('TS-021-01 獲得量の参考値（倍率 1）', () => {
  it('周回の最深 0・149・150・158・159・200・273・274・300・400・500・1000 → 0・0・9・9・10・16・29・30・36・64・100・400', () => {
    const depths = [0, 149, 150, 158, 159, 200, 273, 274, 300, 400, 500, 1000];
    const want = [0, 0, 9, 9, 10, 16, 29, 30, 36, 64, 100, 400];
    expect(depths.map((d) => yunohanaGain(at(d)).toNumber())).toEqual(want);
    expect(depths.map((d) => prestigeView(at(d)).gain.toNumber())).toEqual(want);
  });
  it('今の深さ（run.depth）ではなく周回の最深から計算する', () => {
    const s = at(300);
    s.run.depth = 10;
    expect(yunohanaGain(s).toNumber()).toBe(36);
    s.run.depth = 299;
    expect(prestigeView(s).gain.toNumber()).toBe(36);
  });
});

describe('TS-021-03・04 累計 N の倍率 ×(1＋0.02N)', () => {
  /** 収入と威力がある状態（湯船 5・単純温泉ポンプ 15・ドリル 20） */
  const rich = (lifetime: number | string, spent: number | string = 0): GameState => {
    const s = stateWith({ depth: 200, bath: 5, pumps: { simple: 15 }, drill: 20, tool: 1 });
    s.meta.yunohana.lifetime = num(lifetime);
    s.meta.yunohana.spent = num(spent);
    return s;
  };

  it('TS-021-03: N＝0・9・34・50・100 でドリルの威力と入湯料/秒が ×1・1.18・1.68・2・3。木に使っても（spent）下がらない。鉱石の価値・オフラインの効率には掛からない', () => {
    const base = rich(0);
    for (const [n, mult] of [
      [0, 1],
      [9, 1.18],
      [34, 1.68],
      [50, 2],
      [100, 3],
    ] as const) {
      for (const spent of [0, n]) {
        const s = rich(n, spent);
        expect(drillPower(s).div(drillPower(base)).toNumber(), `drill N=${n} spent=${spent}`).toBeCloseTo(mult, 10);
        expect(bathIncomePerSec(s).div(bathIncomePerSec(base)).toNumber(), `income N=${n} spent=${spent}`).toBeCloseTo(mult, 10);
        expect(blockValue(s, 120, true).toString(), `ore N=${n}`).toBe(blockValue(base, 120, true).toString());
        expect(offlineEfficiency(s)).toBe(offlineEfficiency(base));
        expect(prestigeView(s).multNow.toNumber()).toBeCloseTo(mult, 10);
      }
    }
  });

  it('TS-021-04: N＝1e6・1e300 でも倍率・威力・入湯料が NaN・Infinity・負にならず、保存して読み直しても値が変わらない', () => {
    for (const n of ['1e6', '1e300']) {
      const s = rich(n); // 使った分は木のコストの合計で決まる（BL-022）ので、ここでは 0
      const vals = [prestigeView(s).multNow, prestigeView(s).multAfter, drillPower(s), bathIncomePerSec(s)];
      for (const v of vals) {
        expect(Number.isFinite(v.mantissa) && Number.isFinite(v.exponent), `${n} ${v.toString()}`).toBe(true);
        expect(v.gt(0), `${n} ${v.toString()}`).toBe(true);
      }
      const back = reload(s);
      expect(back.meta.yunohana.lifetime.toString()).toBe(s.meta.yunohana.lifetime.toString());
      expect(stateHash(back)).toBe(stateHash(s));
    }
  });
});

describe('TS-021-05 解放（セーブ全体の最深）とボタン（周回の最深）の状態の表', () => {
  it('A 0／0・B 149／149・C 150／150・D 160／0・E 300／149・F 300／150（セーブ全体／周回）', () => {
    const rows = [
      ['A', 0, 0, false, false, 150, 0],
      ['B', 149, 149, false, false, 1, 0],
      ['C', 150, 150, true, true, 0, 9],
      ['D', 160, 0, true, false, 150, 0],
      ['E', 300, 149, true, false, 1, 0],
      ['F', 300, 150, true, true, 0, 9],
    ] as const;
    for (const [name, best, run, unlocked, canPrestige, meters, gain] of rows) {
      const v = prestigeView(at(run, best));
      expect([v.unlocked, v.canPrestige, v.metersToUnlock, v.gain.toNumber()], name).toEqual([unlocked, canPrestige, meters, gain]);
    }
  });
});

describe('TS-021-08 セーブ全体の最深 ≥ 周回の最深（操作の列。fast-check）', () => {
  const op = fc.oneof(
    fc.record({ k: fc.constant('tap' as const), n: fc.integer({ min: 1, max: 8 }) }),
    fc.record({ k: fc.constant('step' as const), ms: fc.integer({ min: 1, max: 120_000 }) }),
    fc.record({ k: fc.constant('jump' as const), d: fc.integer({ min: 0, max: 600 }) }),
    fc.record({ k: fc.constant('prestige' as const) }),
    fc.record({ k: fc.constant('reload' as const) }),
  );
  it('掘る・進める・深く飛ぶ・転生・保存と読み込みのどの列でも、常に stats.bestDepth ≥ run.maxDepth ≥ run.depth', () => {
    fc.assert(
      fc.property(gameStateArb, fc.array(op, { maxLength: 12 }), (g, ops) => {
        let s = cloneState(g);
        for (const o of ops) {
          if (o.k === 'tap') dispatch(s, { type: 'tap', count: o.n });
          else if (o.k === 'step') step(s, Math.min(o.ms, 1000));
          else if (o.k === 'jump') {
            // 深さだけを書き換えた（手で書き換えたセーブと同じ）後に、読み込みの補正を通す
            s.run.depth = o.d;
            s.run.maxDepth = Math.max(s.run.maxDepth, o.d);
            s = reload(s);
          } else if (o.k === 'prestige') dispatch(s, { type: 'prestige' });
          else s = reload(s);
          expect(s.stats.bestDepth).toBeGreaterThanOrEqual(s.run.maxDepth);
          expect(s.run.maxDepth).toBeGreaterThanOrEqual(s.run.depth);
        }
      }),
      fcRuns(60),
    );
  });

  it('Q-47 (i): stats.bestDepth < run.maxDepth・run.maxDepth < run.depth のセーブは拒否せず、大きい方に合わせて補正する', () => {
    const s = at(220);
    s.stats.bestDepth = 100;
    s.run.depth = 230;
    const r = decodeSave(encodeSave(s, 1, 1, APP));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.state.run.depth, r.state.run.maxDepth, r.state.stats.bestDepth]).toEqual([230, 230, 230]);
    expect(r.corrected).toEqual(expect.arrayContaining(['run.maxDepth', 'stats.bestDepth']));
  });
});

describe('TS-021-09〜12 推奨のしきい値', () => {
  const withLast = (depth: number, last: number | string): GameState => {
    const s = at(depth);
    s.meta.prestiges = 1;
    s.meta.lastPrestigeGain = num(last);
    return s;
  };

  it('TS-021-09: 1 周目（前回 0）は 273m（29）で推奨しない、274m（30）で推奨する', () => {
    expect([prestigeView(at(273)).recommended, prestigeView(at(274)).recommended]).toEqual([false, true]);
  });

  it('TS-021-10: 前回 19・20・21・34・100 → しきい値 30・30・32・51・150。その 1 つ下では推奨しない（1.5 倍が整数になるときも誤差でずれない）', () => {
    for (const [last, th] of [
      [19, 30],
      [20, 30],
      [21, 32],
      [34, 51],
      [100, 150],
    ] as const) {
      const s = withLast(0, last);
      expect(recommendThreshold(s), `last ${last}`).toBe(th);
      expect(prestigeView(s).recommendAt).toBe(th);
      // 獲得量をしきい値の前後にする（その獲得量になる最小の深さ）
      for (const [gain, want] of [
        [th - 1, false],
        [th, true],
      ] as const) {
        s.run.maxDepth = Math.max(P.unlockDepth, Math.ceil(P.divisor * Math.sqrt(gain)));
        while (yunohanaGain(s).toNumber() < gain) s.run.maxDepth++;
        expect(yunohanaGain(s).toNumber()).toBe(gain);
        expect(prestigeView(s).recommended, `last ${last} gain ${gain}`).toBe(want);
      }
    }
  });

  it('TS-021-10: 前回が非常に大きい（1e15・1e300・number を超える 1e400）ときも、しきい値が NaN にならず推奨が出ない側に倒れる', () => {
    for (const last of ['1e15', '1e300', '1e400']) {
      const s = withLast(2000, last); // 獲得量 1600
      const th = recommendThreshold(s);
      expect(Number.isNaN(th)).toBe(false);
      expect(th).toBeGreaterThan(1600);
      expect(prestigeView(s).recommended).toBe(false);
    }
  });

  it('TS-021-11: 前回の獲得量は直前の 1 回の実際の獲得量（34 → 51、続けて 40 → 60）。最大値でも累計でもない', () => {
    const s = at(0);
    for (const [maxDepth, gain, nextTh] of [
      [292, 34, 51], // floor(5.84²)=34
      [317, 40, 60], // floor(6.34²)=40
      [292, 34, 51], // 前より少なく得ても、直前の値に戻る（最大値ではない）
    ] as const) {
      s.run.maxDepth = maxDepth;
      s.stats.bestDepth = Math.max(s.stats.bestDepth, maxDepth);
      expect(yunohanaGain(s).toNumber()).toBe(gain);
      expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
      expect(s.meta.lastPrestigeGain.toNumber()).toBe(gain);
      expect(recommendThreshold(s)).toBe(nextTh);
    }
  });

  it('TS-021-12: （獲得量, 前回）の組の表で、T4 の推奨（prestigeView）と標準ボットの転生の判断が一致する（同じ関数）', () => {
    const lasts = [0, 19, 20, 21, 34, 100];
    for (const last of lasts) {
      const th = Math.max(30, Math.ceil(last * 1.5));
      for (const gain of [th - 1, th, th + 1]) {
        const s = withLast(0, last);
        s.meta.prestiges = last === 0 ? 0 : 1;
        s.run.maxDepth = Math.max(P.unlockDepth, Math.ceil(P.divisor * Math.sqrt(gain)));
        while (yunohanaGain(s).toNumber() < gain) s.run.maxDepth++;
        s.stats.bestDepth = s.run.maxDepth;
        const recommended = prestigeView(s).recommended;
        const before = s.meta.prestiges;
        botAct(s, BOTS.standard, newBotMemory());
        expect(s.meta.prestiges > before, `last ${last} gain ${gain}`).toBe(recommended);
      }
    }
  });
});

describe('TS-021-13・15 チケットの上限（コインにしない）', () => {
  it('TS-021-13: チケット 0・8・9・10 → 転生の後 2・10・10・10。ticketsAdded（2・2・1・0）と TicketGained の量が実際の増え方と同じ', () => {
    for (const [have, after, added] of [
      [0, 2, 2],
      [8, 10, 2],
      [9, 10, 1],
      [10, 10, 0],
    ] as const) {
      const s = at(160);
      s.meta.tickets = have;
      expect(prestigeView(s).ticketsAdded).toBe(added);
      const r = dispatch(s, { type: 'prestige' });
      expect(s.meta.tickets, `have ${have}`).toBe(after);
      const ev = r.events.find((e) => e.type === 'TicketGained');
      expect(ev && ev.type === 'TicketGained' && ev.n).toBe(added);
    }
  });

  it('TS-021-15: 収入がある状態でチケット 9・10 で転生しても、コインは新しい周回の初期値ちょうど・stats.totalCoins は変わらない', () => {
    for (const have of [9, 10]) {
      const s = stateWith({ depth: 300, bath: 5, pumps: { simple: 15 } });
      expect(bathIncomePerSec(s).gt(0)).toBe(true); // 既定の規則なら、あふれはコインになる状態
      s.meta.tickets = have;
      const total = s.stats.totalCoins.toString();
      dispatch(s, { type: 'prestige' });
      expect(s.run.coins.toString(), `have ${have}`).toBe(createRun(1).coins.toString());
      expect(s.stats.totalCoins.toString()).toBe(total);
      expect(s.meta.tickets).toBe(10);
    }
  });
});

describe('TS-021-17〜20 周回をまたぐもの・決定的・二重の転生', () => {
  it('TS-021-17: (a) ブーストの残りと休みを引き継ぐ (b) 未受け取りのオフライン収入は捨てる (c) 鉱脈は消え、新しい周回で 5〜8 分後に予約 (d) 長押しの端数は 0.5 から (e) 幕間は終わる (f) 自動掘りはオフ', () => {
    const s = stateWith({ depth: 200, tool: 1, autoOn: true, hold: true });
    s.run.boost = { remainingMs: 120_000, readyAtWallMs: 9_999_999 };
    s.run.pendingOffline = { coins: num(5000), ms: 600_000 };
    s.run.vein = { nextAtMs: 1, active: { depth: 201, hits: 3, expiresAtMs: s.clock.playedMs + 30_000 } };
    s.run.interludeMs = 800;
    s.run.digCarry = 0.9;
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.run.boost).toEqual({ remainingMs: 120_000, readyAtWallMs: 9_999_999 }); // (a)
    expect(s.run.pendingOffline).toBeNull(); // (b)
    expect(s.run.vein).toEqual({ nextAtMs: 0, active: null }); // (c) 未予約
    expect(s.run.digCarry).toBe(0.5); // (d) 長押しのまま → 0.5 から
    expect(s.run.interludeMs).toBe(0); // (e)
    expect(s.run.autoDig.on).toBe(false); // (f)
    const start = s.clock.playedMs;
    step(s, 100);
    expect(s.run.vein.nextAtMs - start).toBeGreaterThanOrEqual(PARAMS.vein.minIntervalMs);
    expect(s.run.vein.nextAtMs - start).toBeLessThan(PARAMS.vein.maxIntervalMs);
  });

  it('TS-021-18: 同じ状態から転生して 10 分進めると同じ stateHash。続けて転生すると周回のシードは毎回違う。0〜4m は鉱石にならない', () => {
    const run = (): GameState => {
      const s = stateWith({ seed: 7, depth: 300, tool: 1 });
      dispatch(s, { type: 'prestige' });
      for (let i = 0; i < 600; i++) step(s, 1000);
      return s;
    };
    expect(stateHash(run())).toBe(stateHash(run()));
    const s = stateWith({ seed: 7, depth: 300 });
    const seeds = new Set<number>([s.run.seed]);
    for (let i = 0; i < 5; i++) {
      s.run.maxDepth = 300;
      dispatch(s, { type: 'prestige' });
      seeds.add(s.run.seed);
    }
    expect(seeds.size).toBe(6);
    for (let d = 0; d < PARAMS.block.oreFreeDepth; d++) expect(isOre(s, d), `depth ${d}`).toBe(false); // 新しい周回でも 0〜4m は鉱石にならない（Q-02）
  });

  it('TS-021-20: 同じステップで 2 回 dispatch しても 2 回目は locked。湯の華・回数・チケットは 1 回分、PrestigeDone は 1 回', () => {
    const s = at(160);
    s.meta.tickets = 0;
    const r1 = dispatch(s, { type: 'prestige' });
    const r2 = dispatch(s, { type: 'prestige' });
    expect([r1.ok, r2]).toEqual([true, { ok: false, reason: 'locked', events: [] }]);
    expect([s.meta.yunohana.lifetime.toNumber(), s.meta.prestiges, s.meta.tickets]).toEqual([10, 1, 2]);
    expect([...r1.events, ...r2.events].filter((e) => e.type === 'PrestigeDone')).toHaveLength(1);
  });
});
