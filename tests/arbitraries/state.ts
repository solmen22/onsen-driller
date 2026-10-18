// fast-check の GameState の生成器（BL-026 の往復テスト。BL-027・BL-028・BL-075 でも使い回す）。
// 生成するのは「正しい」状態（読み込みの補正がかからないもの）。Decimal は 0・1・小数・1e308・上限を必ず混ぜる。
// レベルは極端な値（上限 PARAMS.levelMax まで）も混ぜる（レビュー S-4）
import fc from 'fast-check';
import Decimal from 'break_infinity.js';
import { ORE_IDS } from '../../src/content/ores.ts';
import type { SpringId } from '../../src/content/springs.ts';
import { PARAMS } from '../../src/content/params.ts';
import { UPGRADES } from '../../src/content/upgrades.ts';
import { computeGuests, createInitialState, num, NUM_MAX, slotsForBathLevel, type GameState, type Num } from '../../src/core/index.ts';

export const SPRING_IDS: SpringId[] = ['simple', 'co2', 'salt', 'sulfur', 'iron'];

/** 健全な Decimal（0 以上・上限以下） */
export const decimalArb: fc.Arbitrary<Num> = fc.oneof(
  fc.constantFrom(num(0), num(1), num(0.5), num(123.456), num('1e308'), num('1.23e45'), NUM_MAX),
  fc.double({ min: 0, max: 1e300, noNaN: true, noDefaultInfinity: true }).map((x) => num(x)),
  fc
    .tuple(fc.double({ min: 1, max: 9.999999, noNaN: true }), fc.integer({ min: -20, max: 9e15 - 2 }))
    .map(([m, e]) => num(Decimal.fromMantissaExponent_noNormalize(m, e))),
);

const count = (max = 1e6): fc.Arbitrary<number> => fc.integer({ min: 0, max });
/**
 * レベル: ふだんの範囲に、極端な値（Infinity になる 2^floor(Lv/25) の境目 25,575 付近・上限 PARAMS.levelMax）を混ぜる（レビュー S-4）
 */
export const levelArb = (normalMax: number): fc.Arbitrary<number> =>
  fc.oneof(
    { weight: 4, arbitrary: count(normalMax) },
    { weight: 1, arbitrary: fc.constantFrom(25_574, 25_575, 25_600, 30_000, PARAMS.levelMax - 1, PARAMS.levelMax) },
    { weight: 1, arbitrary: fc.integer({ min: normalMax, max: PARAMS.levelMax }) },
  );
const ms = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 2 ** 40 }), fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }));

export const gameStateArb: fc.Arbitrary<GameState> = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    coins: decimalArb,
    blockDmg: decimalArb,
    depth: count(2000),
    extraMax: count(500),
    drill: levelArb(5000),
    tool: fc.integer({ min: 0, max: 7 }),
    digger: levelArb(500),
    autoOn: fc.boolean(),
    bath: levelArb(60),
    pumps: fc.array(levelArb(300), { minLength: 5, maxLength: 5 }),
    digCarry: fc.double({ min: 0, max: 0.999, noNaN: true }),
    diggerCarry: fc.double({ min: 0, max: 0.999, noNaN: true }),
    interludeMs: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 1500 })),
    tickets: fc.integer({ min: 0, max: 10 }),
    prestiges: count(1000),
    yunohana: decimalArb,
    spent: decimalArb,
    ores: fc.dictionary(fc.constantFrom(...ORE_IDS), count()),
    boostLeft: ms,
    boostReady: ms,
    veinNext: ms,
    vein: fc.option(fc.record({ depth: count(2000), hits: count(100), expiresAtMs: ms }), { nil: null }),
    playedMs: ms,
    stats: fc.record({ taps: count(), hits: count(), blocks: count(), offlineMaxMs: ms }),
    totalCoins: decimalArb,
    tutorial: fc.record({ step: count(8), dismissed: fc.boolean() }),
    endingSeen: fc.boolean(),
    // 知っている改良の ID だけ（知らない ID は読み込みで捨てるので往復が一致しない。BL-018・TS-026-11）。順番は保つ
    upgrades: fc.uniqueArray(fc.constantFrom(...UPGRADES.map((u) => u.id)), { maxLength: 5 }),
    rng: fc.tuple(fc.nat(0xffffffff), fc.nat(0xffffffff), fc.nat(0xffffffff), fc.integer({ min: 1, max: 0xffffffff })),
  })
  .map((g) => {
    const s = createInitialState(g.seed);
    const r = s.run;
    r.coins = g.coins;
    r.blockDmg = g.blockDmg;
    r.depth = g.depth;
    r.maxDepth = g.depth + g.extraMax;
    r.drill = { level: g.drill, tool: g.tool };
    r.autoDig = { level: g.digger, on: g.autoOn && g.tool >= 1 };
    g.pumps.forEach((lv, i) => {
      const id = SPRING_IDS[i];
      if (id && lv > 0) r.springs[id] = { pump: lv };
    });
    r.bath.level = g.bath;
    const found = Object.keys(r.springs) as SpringId[];
    r.bath.slots = Array.from({ length: slotsForBathLevel(g.bath) }, (_, i) => found[i] ?? null);
    r.digCarry = g.digCarry;
    r.diggerCarry = g.diggerCarry;
    r.interludeMs = g.interludeMs;
    r.upgrades = g.upgrades;
    r.boost = { remainingMs: g.boostLeft, readyAtWallMs: g.boostReady };
    r.vein = { nextAtMs: g.veinNext, active: g.vein };
    r.stratumSeen = [0, 1, 2, 3, 4, 5].filter((b) => [0, 30, 80, 150, 250, 400][b]! <= r.maxDepth);
    s.rng.run = [...g.rng];
    s.clock.playedMs = g.playedMs;
    s.meta.tickets = g.tickets;
    s.meta.prestiges = g.prestiges;
    s.meta.yunohana = { lifetime: g.yunohana, spent: g.spent };
    s.meta.endingSeen = g.endingSeen;
    s.collection.ores = Object.fromEntries(Object.entries(g.ores).sort());
    s.collection.springsSeen = [...found];
    s.stats = { ...g.stats, totalCoins: g.totalCoins, bestDepth: r.maxDepth };
    s.tutorial = g.tutorial;
    r.guests = computeGuests(s);
    return s;
  });
