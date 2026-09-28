// BL-013: 地層 6 帯と幕間・鉱石 12 種（TS-013-01〜12。Q-06・Q-07）
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { ORES, ORE_BY_ID } from '../../src/content/ores.ts';
import { STRATA } from '../../src/content/strata.ts';
import {
  advance,
  bandOfDepth,
  blockHp,
  blockValue,
  contentProblems,
  createAdvanceCarry,
  createInitialState,
  dispatch,
  hash32,
  isOre,
  oreAt,
  step,
  type GameEvent,
  type GameState,
  type OreId,
} from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

const of = <T extends GameEvent['type']>(evs: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] =>
  evs.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** depth のブロックの残り HP を 1 にした状態（次の 1 打で壊れる。余りのダメージは次の帯のブロックへ） */
function atEdge(depth: number, seed = 1): GameState {
  const s = stateWith({ seed, depth, tool: 1 }); // 威力 1.5: 余りは次のブロックを壊さない
  s.run.blockDmg = blockHp(s, depth).sub(1);
  return s;
}

describe('TS-013-01 content/strata.ts・ores.ts', () => {
  it('6 帯（0・30・80・150・250・400m）、帯ごとに 2 種、計 12 種で ID の重複なし', () => {
    expect(STRATA.map((b) => b.start)).toEqual([0, 30, 80, 150, 250, 400]);
    expect(STRATA.every((b) => b.ores.length === 2)).toBe(true);
    expect(ORES).toHaveLength(12);
    expect(new Set(ORES.map((o) => o.id)).size).toBe(12);
    expect(new Set(STRATA.flatMap((b) => b.ores)).size).toBe(12);
  });
  it('整合の検査（参照切れ・帯・割合・道具・源泉）に問題がない', () => {
    expect(contentProblems()).toEqual([]);
  });
  it('帯と鉱石の名前のキーが en.json・ja.json の両方にある', () => {
    const keys = [...STRATA.map((b) => b.nameKey), ...ORES.map((o) => o.nameKey)];
    for (const k of keys) {
      expect(en, k).toHaveProperty([k]);
      expect(ja, k).toHaveProperty([k]);
    }
  });
});

describe('TS-013-02 帯の境目で StratumEntered がちょうど 1 回（band は 0 始まり）', () => {
  it('29m は帯 1、30m は帯 2（開始の深さを含む）', () => {
    expect([0, 29, 30, 79, 80, 149, 150, 249, 250, 399, 400, 10_000].map(bandOfDepth)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
  for (const [edge, band] of [
    [30, 1],
    [80, 2],
    [150, 3],
    [250, 4],
    [400, 5],
  ] as const) {
    it(`${edge - 1}m → ${edge}m で band ${band}`, () => {
      const s = atEdge(edge - 1);
      const r = dispatch(s, { type: 'tap' });
      expect(of(r.events, 'StratumEntered')).toEqual([{ type: 'StratumEntered', band }]);
      expect(s.run.depth).toBe(edge); // 境目でドリルが止まる（1 打で先まで掘らない）
      expect(s.run.stratumSeen).toContain(band);
      expect(s.run.interludeMs).toBe(1500);
    });
  }
});

describe('TS-013-03 起動直後（0m・帯 1）は StratumEntered も幕間も出さない', () => {
  it('新しいゲームで 0m から 5m まで掘る', () => {
    const s = createInitialState(1);
    const evs = advance(s, 20_000, { input: { tapsPerSec: 2 } });
    expect(s.run.depth).toBeGreaterThanOrEqual(5);
    expect(of(evs, 'StratumEntered')).toEqual([]);
    expect(s.run.interludeMs).toBe(0);
  });
});

describe('TS-013-04 幕間の 1.5 秒はドリルが止まる（ロジック。入湯料は止まらない。Q-06）', () => {
  it('長押し中に 30m に入る → 1.5 秒は打撃 0（タップは interlude）→ その後に再開', () => {
    const s = stateWith({ depth: 29, drill: 30, tool: 1, hold: true });
    s.run.digCarry = 0.5;
    const evs: GameEvent[] = [];
    while (s.run.depth < 30) step(s, 100, evs);
    expect(of(evs, 'StratumEntered')).toHaveLength(1);
    const h = s.stats.hits;
    const coins = s.run.coins;
    expect(dispatch(s, { type: 'tap' })).toEqual({ ok: false, reason: 'interlude', events: [] });
    advance(s, 1500);
    expect(s.stats.hits).toBe(h);
    expect(s.run.interludeMs).toBe(0);
    expect(s.run.coins.gt(coins)).toBe(true); // 30m の単純温泉で入湯料が入り始め、幕間でも止まらない
    advance(s, 1000);
    expect(s.stats.hits).toBeGreaterThan(h);
  });
  it('自動掘削機の打撃も止まり、端数もたまらない。刻み幅によらず幕間は 1.5 秒', () => {
    for (const stepMs of [100, 250, 1000]) {
      const s = stateWith({ depth: 30, digger: 20 });
      s.run.interludeMs = 1500;
      const carry = s.run.diggerCarry;
      advance(s, 1500, stepMs);
      expect(s.stats.hits).toBe(0);
      expect(s.run.diggerCarry).toBe(carry);
      advance(s, 1000, stepMs);
      expect(s.stats.hits).toBeGreaterThan(0);
    }
  });
  it('ステップの途中で幕間が終われば、残りの時間は掘る', () => {
    const s = stateWith({ depth: 30, digger: 25 }); // 10 打/秒
    s.run.interludeMs = 1500;
    step(s, 2000);
    expect(s.stats.hits).toBe(5);
  });
});

describe('TS-013-05 同じ周回で一度入った帯はもう出さない（stratumSeen）', () => {
  it('30m を越えた後に 25m に戻して、もう一度越える', () => {
    const s = atEdge(29);
    dispatch(s, { type: 'tap' });
    advance(s, 1500);
    s.run.depth = 25;
    s.run.drill.level = 5; // 80m まで届かない威力で越え直す
    const evs: GameEvent[] = [];
    for (let i = 0; i < 60 && s.run.depth < 31; i++) advance(s, 1000, { input: { tapsPerSec: 8 }, out: evs });
    expect(s.run.depth).toBeGreaterThanOrEqual(31);
    expect(of(evs, 'StratumEntered')).toEqual([]);
    expect(s.run.interludeMs).toBe(0);
  });
});

describe('TS-013-06 M2 の機会は帯 4〜6（band 3〜5）の幕間の終わりだけ', () => {
  it('帯 2〜6 に入るたびに、幕間の終わりの BreakOpportunity を数える', () => {
    const got: Record<number, number> = {};
    for (const [edge, band] of [
      [30, 1],
      [80, 2],
      [150, 3],
      [250, 4],
      [400, 5],
    ] as const) {
      const s = atEdge(edge - 1);
      const evs = [...dispatch(s, { type: 'tap' }).events];
      expect(of(evs, 'BreakOpportunity')).toEqual([]); // 入った瞬間ではない
      evs.push(...advance(s, 1400));
      expect(of(evs, 'BreakOpportunity')).toEqual([]);
      evs.push(...advance(s, 100));
      got[band] = of(evs, 'BreakOpportunity').length;
      if (band >= 3) expect(of(evs, 'BreakOpportunity')).toEqual([{ type: 'BreakOpportunity', placement: 'M2', band }]);
    }
    expect(got).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  });
});

describe('TS-013-07 1 ステップで越える新しい帯は 1 つまで（Q-06）', () => {
  it('25m から極端な威力で掘ると、帯 2・3・4 が 1 回ずつ深さの順に、幕間はそのたびに 1.5 秒', () => {
    const s = stateWith({ depth: 25, drill: 3000, tool: 7, digger: 50 });
    const evs: GameEvent[] = [];
    step(s, 100, evs);
    expect(s.run.depth).toBe(30);
    expect(of(evs, 'StratumEntered')).toEqual([{ type: 'StratumEntered', band: 1 }]);
    advance(s, 20_000, { out: evs });
    expect(of(evs, 'StratumEntered').map((e) => e.band).slice(0, 3)).toEqual([1, 2, 3]);
    expect(of(evs, 'BreakOpportunity').filter((e) => e.band === 3)).toHaveLength(1);
  });
});

describe('TS-013-08 鉱石: hash32(seed, d)/2^32 < 6%（0〜4m を除く）で価値 ×8', () => {
  it('判定がハッシュの式どおりで、種類は帯の 2 種のどちらか', () => {
    const s = createInitialState(77);
    for (let d = 0; d < 3000; d++) {
      const want = d >= 5 && hash32(s.run.seed, d) / 2 ** 32 < 0.06;
      expect(isOre(s, d)).toBe(want);
      const o = oreAt(s, d);
      expect(o !== null).toBe(want);
      if (o) expect(STRATA[bandOfDepth(d)]?.ores).toContain(o);
    }
  });
  it('鉱石の価値は普通のブロックの 8 倍', () => {
    const s = createInitialState(1);
    expect(blockValue(s, 50, true).div(blockValue(s, 50, false)).toNumber()).toBeCloseTo(8, 12);
  });
});

/** 0m から 200m まで掘り、200m 未満の鉱石の深さと種類を集める */
function oresTo200(seed: number, run: (s: GameState, out: GameEvent[]) => void): Map<number, OreId> {
  const s = stateWith({ seed, drill: 120, tool: 2 });
  const out: GameEvent[] = [];
  for (let guard = 0; guard < 20_000 && s.run.maxDepth < 200; guard++) run(s, out);
  expect(s.run.maxDepth).toBeGreaterThanOrEqual(200);
  const m = new Map<number, OreId>();
  for (const e of of(out, 'BlockBroken')) if (e.ore && e.depth < 200) m.set(e.depth, e.ore);
  return m;
}

describe('TS-013-09 打つ順番・刻み幅・進め方で鉱石の配置が変わらない（property）', () => {
  it('タップ 8/秒・自動 2/秒（0.1 秒刻み）・自動 2/秒（1 秒刻み）・大きな塊の advance が同じ', () => {
    for (const seed of [1, 2, 3, 99, 2026]) {
      const taps = oresTo200(seed, (s, out) => advance(s, 1000, { input: { tapsPerSec: 8 }, out }));
      const auto01 = oresTo200(seed, (s, out) => {
        if (!s.run.autoDig.on) dispatch(s, { type: 'setAutoDig', on: true });
        advance(s, 1000, { stepMs: 100, out });
      });
      const auto1 = oresTo200(seed, (s, out) => {
        if (!s.run.autoDig.on) dispatch(s, { type: 'setAutoDig', on: true });
        advance(s, 1000, { stepMs: 1000, out });
      });
      const chunk = oresTo200(seed, (s, out) => {
        if (!s.run.autoDig.on) dispatch(s, { type: 'setAutoDig', on: true });
        advance(s, 60_000, { out });
      });
      expect(taps.size).toBeGreaterThan(0);
      for (const other of [auto01, auto1, chunk]) expect([...other.entries()].sort()).toEqual([...taps.entries()].sort());
    }
  });
});

describe('TS-013-10 鉱石を壊すと図鑑の数（collection.ores）が増える', () => {
  it('鉱石では種類別に 1 増え、普通のブロックでは増えない', () => {
    const probe = createInitialState(5);
    let d = 6;
    while (!(isOre(probe, d) && !isOre(probe, d - 1) && bandOfDepth(d) === bandOfDepth(d - 1))) d++;
    const kind = oreAt(probe, d) as OreId;
    const s = atEdge(d - 1, 5);
    dispatch(s, { type: 'tap' }); // 普通のブロック（d−1）
    expect(s.run.depth).toBe(d);
    expect(s.collection.ores).toEqual({});
    s.run.blockDmg = blockHp(s, d).sub(1);
    step(s, 1000);
    const r = dispatch(s, { type: 'tap' }); // 鉱石のブロック（d）
    expect(of(r.events, 'BlockBroken')[0]).toMatchObject({ depth: d, ore: kind });
    expect(s.collection.ores).toEqual({ [kind]: 1 });
  });
});

describe('TS-013-11 帯ごとの鉱石の種類（1 種目 70%・2 種目 30%。Q-07）', () => {
  it('シード 20 個 × 帯 1〜6: その帯の 2 種だけが出て、両方とも出る。1 種目の割合はシード 400 個で 65〜75%', () => {
    for (let band = 0; band < STRATA.length; band++) {
      const b = STRATA[band]!;
      const end = STRATA[band + 1]?.start ?? b.start + 400;
      const few = new Set<OreId>();
      for (let seed = 1; seed <= 20; seed++) {
        const s = createInitialState(seed);
        for (let d = b.start; d < end; d++) {
          const o = oreAt(s, d);
          if (o) few.add(o);
        }
      }
      expect([...few].sort()).toEqual([...b.ores].sort());
      const count = new Map<OreId, number>();
      for (let seed = 1; seed <= 400; seed++) {
        const s = createInitialState(seed);
        for (let d = b.start; d < end; d++) {
          const o = oreAt(s, d);
          if (o) count.set(o, (count.get(o) ?? 0) + 1);
        }
      }
      expect([...count.keys()].sort()).toEqual([...b.ores].sort());
      const first = count.get(b.ores[0]) ?? 0;
      const total = [...count.values()].reduce((a, c) => a + c, 0);
      expect(first / total).toBeGreaterThan(0.65);
      expect(first / total).toBeLessThan(0.75);
      expect(ORE_BY_ID[b.ores[0]].weight).toBe(0.7);
    }
  });
});

describe('TS-013-12 1000m でも帯 6 のまま続き、例外なし', () => {
  it('深さ 1000m から掘っても新しい StratumEntered は出ない', () => {
    const s = stateWith({ depth: 1000, drill: 4000, tool: 7 });
    const evs = advance(s, 5000, { input: { tapsPerSec: 8 } });
    expect(s.run.depth).toBeGreaterThan(1000);
    expect(of(evs, 'StratumEntered')).toEqual([]);
    expect(bandOfDepth(s.run.depth)).toBe(5);
  });
});

describe('advance の端数の持ち越し（テスト用フックの advance。Q-16）', () => {
  it('advance(99) は何も起きず、続けて advance(1) で 1 ステップ', () => {
    const s = stateWith({ tool: 1, autoOn: true });
    const carry = createAdvanceCarry();
    expect(advance(s, 99, { carry })).toEqual([]);
    expect(s.clock.playedMs).toBe(0);
    advance(s, 1, { carry });
    expect(s.clock.playedMs).toBe(100);
    expect(carry.ms).toBe(0);
  });
  it('0 以下・NaN・Infinity は何もしない（空の配列）', () => {
    const s = createInitialState(1);
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(advance(s, ms, { carry: createAdvanceCarry() })).toEqual([]);
    expect(s.clock.playedMs).toBe(0);
  });
  it('input.hold はその間だけ長押しにして、終わったら元に戻す', () => {
    const s = createInitialState(1);
    advance(s, 1000, { input: { hold: true } });
    expect(s.stats.hits).toBe(4);
    expect(s.input.hold).toBe(false);
  });
  it('タップの端数も持ち越す（毎秒 2 回を 300ms ずつ 10 回 → 6 回）', () => {
    const s = createInitialState(1);
    const carry = createAdvanceCarry();
    for (let i = 0; i < 10; i++) advance(s, 300, { input: { tapsPerSec: 2 }, carry });
    expect(s.stats.taps).toBe(6);
  });
});
