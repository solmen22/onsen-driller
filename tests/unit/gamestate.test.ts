// BL-010: GameState・アクション・イベント・リプレイ・性能（TS-010-01・02・07・08・09・12・13・16・17）
import fc from 'fast-check';
import { fcRuns } from '../helpers/fc-runs.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advance,
  createInitialState,
  dispatch,
  isHealthy,
  NUM_MAX,
  num,
  SAVE_SCHEMA_VERSION,
  stateHash,
  step,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { runReplay, type ReplayFile } from '../../tools/sim/replay.ts';
import { stateWith } from '../support/states.ts';

describe('TS-010-01・02 新しいゲーム', () => {
  it('arch §6-1 のフィールドがすべて初期値', () => {
    const s = createInitialState(42);
    expect(s.schema).toBe(SAVE_SCHEMA_VERSION);
    expect(s.schema).toBe(1);
    expect(s.rng.run).toHaveLength(4);
    expect(s.clock).toEqual({ playedMs: 0 });
    const r = s.run;
    expect(r.coins.eq(0)).toBe(true);
    expect([r.depth, r.maxDepth, r.blockDmg.toNumber()]).toEqual([0, 0, 0]);
    expect(r.drill).toEqual({ level: 0, tool: 0 });
    expect(r.autoDig).toEqual({ level: 0, on: false });
    expect(r.springs).toEqual({});
    expect(r.bath).toEqual({ level: 0, slots: [null] });
    expect([r.upgrades, r.guests]).toEqual([[], []]);
    expect(r.boost).toEqual({ remainingMs: 0, readyAtWallMs: 0 });
    expect(r.vein).toEqual({ nextAtMs: 0, active: null });
    expect(r.stratumSeen).toEqual([0]);
    expect(r.terrain).toBe('mountain');
    expect(r.interludeMs).toBe(0);
    expect(s.meta.yunohana.lifetime.eq(0) && s.meta.yunohana.spent.eq(0)).toBe(true);
    expect([s.meta.perks, s.meta.prestiges, s.meta.terrainsUnlocked, s.meta.endingSeen]).toEqual([[], 0, ['mountain'], false]);
    expect(s.collection).toEqual({ ores: {}, springsSeen: [], guestsSeen: {}, achievements: [] });
    expect(s.stats.totalCoins.eq(0)).toBe(true);
    expect({ ...s.stats, totalCoins: 0 }).toEqual({ totalCoins: 0, taps: 0, hits: 0, blocks: 0, bestDepth: 0, offlineMaxMs: 0 });
    expect(s.tutorial).toEqual({ step: 0, dismissed: false });
    expect(s.input).toEqual({ hold: false, manualLog: [] });
  });
  it('温泉チケットはちょうど 2 枚', () => {
    expect(createInitialState(1).meta.tickets).toBe(2);
  });
  it('同じシードなら同じ状態、違うシードなら違う状態', () => {
    expect(stateHash(createInitialState(5))).toBe(stateHash(createInitialState(5)));
    expect(stateHash(createInitialState(5))).not.toBe(stateHash(createInitialState(6)));
  });
});

/** 実行できないアクションを作る（状態ごと） */
const failingActions = (s: GameState): unknown[] => [
  { type: 'buy', item: 'drill', qty: 1 },
  { type: 'buy', item: 'autoDigger', qty: 10 },
  { type: 'buy', item: 'tool', qty: 1 },
  { type: 'buy', item: 'pump:iron', qty: 1 },
  { type: 'assignSlot', slot: s.run.bath.slots.length + 3, spring: null },
  { type: 'assignSlot', slot: 0, spring: 'iron' },
];

describe('TS-010-07 実行できない dispatch は { ok:false, reason } で状態が変わらない', () => {
  it('ランダムな状態（property）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 20 }), (seed, depth, drill) => {
        const s = stateWith({ seed, depth, drill, coins: 0 });
        s.run.drill.tool = 7; // 道具は最後の段（買えない）
        for (const a of failingActions(s)) {
          const before = stateHash(s);
          const r = dispatch(s, a);
          expect(r.ok, JSON.stringify(a)).toBe(false);
          expect(typeof r.reason === 'string' && r.reason.length > 0).toBe(true);
          expect(r.events).toEqual([]);
          expect(stateHash(s)).toBe(before);
        }
      }),
      fcRuns(100, 7),
    );
  });
});

describe('TS-010-08 実行できる buy', () => {
  it('ok:true と Purchased、状態が変わる', () => {
    const s = stateWith({ coins: 100 });
    const before = stateHash(s);
    const r = dispatch(s, { type: 'buy', item: 'drill', qty: 1 });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: 'Purchased', item: 'drill', qty: 1 });
    expect(stateHash(s)).not.toBe(before);
  });
});

describe('TS-010-09 形の壊れたアクション', () => {
  const bad: unknown[] = [
    null,
    undefined,
    42,
    'tap',
    {},
    { type: 'nope' },
    { type: 'buy', item: 'drill', qty: 0 },
    { type: 'buy', item: 'drill', qty: -1 },
    { type: 'buy', item: 'drill', qty: 1.5 },
    { type: 'buy', item: 'drill', qty: 'abc' },
    { type: 'buy', item: 'rocket', qty: 1 },
    { type: 'buy', item: 'pump:foo', qty: 1 },
    { type: 'tap', count: NaN },
    { type: 'tap', count: -1 },
    { type: 'tap', count: 0 },
    { type: 'tap', count: Infinity },
    { type: 'tap', count: '3' },
    { type: 'hold', on: 'yes' },
    { type: 'setAutoDig' },
    { type: 'assignSlot', slot: 0.5, spring: null },
    { type: 'assignSlot', slot: 0, spring: 'foo' },
  ];
  it('どれも例外にならず { ok:false }、状態は変わらない', () => {
    const s = stateWith({ coins: 1e6, tool: 1 });
    for (const a of bad) {
      const before = stateHash(s);
      let r: ReturnType<typeof dispatch> | undefined;
      expect(() => (r = dispatch(s, a)), JSON.stringify(a) ?? String(a)).not.toThrow();
      expect(r?.ok, JSON.stringify(a) ?? String(a)).toBe(false);
      expect(r?.reason).toBe('invalid');
      expect(stateHash(s)).toBe(before);
    }
  });
});

describe('TS-010-12 序盤の step が 1ms 未満（Q-12: ウォームアップ 1,000 回の後の 1,000 回の平均）', () => {
  it('ツルハシ・ドリル Lv10・自動掘削機 Lv5・自動掘りオン、深さ 20m', () => {
    const s = stateWith({ tool: 1, drill: 10, digger: 5, autoOn: true, depth: 20 });
    const out: GameEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      step(s, 100, out);
      out.length = 0;
    }
    const times: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      step(s, 100, out);
      times.push(performance.now() - t0);
      out.length = 0;
    }
    const sorted = [...times].sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? NaN;
    console.log(`[TS-010-12] step: mean ${(mean * 1000).toFixed(2)}µs p99 ${(p99 * 1000).toFixed(2)}µs max ${((sorted.at(-1) ?? NaN) * 1000).toFixed(2)}µs`);
    expect(mean).toBeLessThan(1);
  });
});

describe('TS-010-13 リプレイ一致', () => {
  const file = resolve(process.cwd(), 'tests/replays/early-5min.json');
  const r = JSON.parse(readFileSync(file, 'utf8')) as ReplayFile;
  it('同じログを 2 回再生すると同じ stateHash になり、期待値と一致する', () => {
    const a = runReplay(r);
    const b = runReplay(r);
    expect(a.hash).toBe(b.hash);
    if (process.env.UPDATE_REPLAYS === '1') {
      writeFileSync(file, `${JSON.stringify({ ...r, expectedHash: a.hash }, null, 1)}\n`);
      return;
    }
    // 数値・規則を意図して変えたときは UPDATE_REPLAYS=1 で期待値を更新し、同じ PR に含める
    expect(a.hash, `depth ${a.state.run.depth} coins ${a.state.run.coins.toString()}`).toBe(r.expectedHash);
    expect(a.state.run.depth).toBeGreaterThan(20);
  });
});

describe('TS-010-16 イベントは 1 回だけ', () => {
  it('前の step のイベントが次の戻り値に重ならない', () => {
    const s = stateWith({ drill: 30, tool: 2, autoOn: true });
    const seen: GameEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const evs = step(s, 100);
      seen.push(...evs);
    }
    const broken = seen.filter((e) => e.type === 'BlockBroken').map((e) => (e as { depth: number }).depth);
    expect(broken.length).toBe(s.stats.blocks);
    expect(new Set(broken).size).toBe(broken.length);
  });
});

describe('TS-010-17 不変条件（ランダムな操作列を 10 分ぶん）', () => {
  const actionArb = fc.oneof(
    fc.record({ type: fc.constant('tap'), count: fc.integer({ min: 1, max: 20 }) }),
    fc.record({ type: fc.constant('hold'), on: fc.boolean() }),
    fc.record({ type: fc.constant('setAutoDig'), on: fc.boolean() }),
    fc.record({
      type: fc.constant('buy'),
      item: fc.constantFrom('drill', 'autoDigger', 'tool', 'bath', 'pump:simple'),
      qty: fc.constantFrom(1, 10, 'max'),
    }),
  );
  it('コインが負にならない・チケットが 10 以下・Num が健全・レベルと深さが 0 以上の整数', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.array(fc.tuple(actionArb, fc.integer({ min: 100, max: 5000 })), { minLength: 10, maxLength: 60 }), (seed, plan) => {
        const s = createInitialState(seed);
        s.run.coins = num(50);
        let t = 0;
        for (const [a, wait] of plan) {
          if (t > 600_000) break;
          dispatch(s, a);
          advance(s, wait);
          t += wait;
          const r = s.run;
          for (const v of [r.coins, r.blockDmg, s.stats.totalCoins, s.meta.yunohana.lifetime]) {
            expect(isHealthy(v)).toBe(true);
            expect(v.lte(NUM_MAX)).toBe(true);
          }
          expect(s.meta.tickets >= 0 && s.meta.tickets <= 10).toBe(true);
          for (const n of [r.depth, r.maxDepth, r.drill.level, r.drill.tool, r.autoDig.level, r.bath.level, s.stats.hits, s.stats.blocks])
            expect(Number.isInteger(n) && n >= 0).toBe(true);
        }
      }),
      fcRuns(60, 17),
    );
  });
});
