// BL-012: 掘削の入力（タップ・長押し・自動掘り）とブロック（TS-012-01〜14・25。Q-02・Q-03・Q-04）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advance,
  blockHp,
  blockValue,
  createAdvanceCarry,
  createInitialState,
  dispatch,
  isOre,
  num,
  stateHash,
  step,
  temperatureAt,
  temperatureOf,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

const hits = (s: GameState): number => s.stats.hits;

describe('TS-012-01 タップ 1 回で 1 打', () => {
  it('新しいゲーム（威力 1）で blockDmg と打撃数・タップ数が 1 増える', () => {
    const s = createInitialState(1);
    const r = dispatch(s, { type: 'tap', count: 1 });
    expect(r.ok).toBe(true);
    expect(s.run.blockDmg.eq(1)).toBe(true);
    expect([s.stats.hits, s.stats.taps]).toEqual([1, 1]);
  });
  it('count を省くと 1 打', () => {
    const s = createInitialState(1);
    dispatch(s, { type: 'tap' });
    expect(hits(s)).toBe(1);
  });
});

describe('TS-012-02 長押しは毎秒 4 打（最初の 1 打は間隔の半分の後。刻み幅によらない）', () => {
  it('1 秒で 4 打、10 秒で 40 打', () => {
    const a = createInitialState(1);
    dispatch(a, { type: 'hold', on: true });
    advance(a, 1000);
    expect(hits(a)).toBe(4);
    const b = createInitialState(1);
    dispatch(b, { type: 'hold', on: true });
    advance(b, 10_000);
    expect(hits(b)).toBe(40);
  });
  it('最初の 1 打は 0.125 秒の後（100ms 刻みなら 2 ステップ目）', () => {
    const s = createInitialState(1);
    dispatch(s, { type: 'hold', on: true });
    step(s, 100);
    expect(hits(s)).toBe(0);
    step(s, 100);
    expect(hits(s)).toBe(1);
  });
  it('0.1 秒・0.25 秒・1 秒刻みで 10 秒の打数が同じ', () => {
    const counts = [100, 250, 1000].map((stepMs) => {
      const s = createInitialState(1);
      dispatch(s, { type: 'hold', on: true });
      advance(s, 10_000, stepMs);
      return hits(s);
    });
    expect(counts).toEqual([40, 40, 40]);
  });
  it('長押しを離すと端数を捨て、次の長押しは 0.5 から数え直す', () => {
    const s = createInitialState(1);
    dispatch(s, { type: 'hold', on: true });
    advance(s, 1100); // 0.5 + 4.4 = 4.9 → 4 打、端数 0.9
    expect(hits(s)).toBe(4);
    dispatch(s, { type: 'hold', on: false });
    expect(s.run.digCarry).toBe(0);
    dispatch(s, { type: 'hold', on: true });
    expect(s.run.digCarry).toBe(0.5);
  });
});

describe('TS-012-03 連打の上限: 任意の 1 秒（移動窓 (t−1000, t]）で 8 打まで（Q-04(a)）', () => {
  it('同じ時刻に 8 回は入り、9 回目は rateLimited で状態が変わらない', () => {
    const s = createInitialState(1);
    for (let i = 0; i < 8; i++) expect(dispatch(s, { type: 'tap' }).ok).toBe(true);
    const before = stateHash(s);
    const r = dispatch(s, { type: 'tap' });
    expect(r).toEqual({ ok: false, reason: 'rateLimited', events: [] });
    expect(stateHash(s)).toBe(before);
    expect(hits(s)).toBe(8);
  });
  it('tap(9)・tap(20) は 8 打', () => {
    for (const c of [9, 20]) {
      const s = createInitialState(1);
      dispatch(s, { type: 'tap', count: c });
      expect(hits(s)).toBe(8);
    }
  });
  it('999ms 後はまだ窓の中、1000ms 後は窓の外（計 16 打）', () => {
    const s = createInitialState(1);
    dispatch(s, { type: 'tap', count: 8 });
    step(s, 999);
    expect(dispatch(s, { type: 'tap' }).reason).toBe('rateLimited');
    step(s, 1);
    dispatch(s, { type: 'tap', count: 8 });
    expect(hits(s)).toBe(16);
  });
  it('窓は移動する: 0.5 秒ごとに 4 回ずつなら、どの 1 秒にも 8 回で、すべて入る', () => {
    const s = createInitialState(1);
    for (let i = 0; i < 10; i++) {
      dispatch(s, { type: 'tap', count: 4 });
      step(s, 500);
    }
    expect(hits(s)).toBe(40);
  });
});

describe('TS-012-04 タップの形の検査', () => {
  it('0・負・NaN・Infinity・文字列は invalid で状態不変。巨大な値は 8 で止まる', () => {
    const s = createInitialState(1);
    const before = stateHash(s);
    for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(dispatch(s, { type: 'tap', count }).reason).toBe('invalid');
    }
    expect(stateHash(s)).toBe(before);
    dispatch(s, { type: 'tap', count: 1e9 });
    expect(hits(s)).toBe(8);
  });
});

describe('TS-012-05 最初の強化（ツルハシ）の前は自動掘りを使えない（Q-03）', () => {
  it('setAutoDig(true) は locked で状態不変、10 秒進めても打撃 0', () => {
    const s = createInitialState(1);
    const before = stateHash(s);
    expect(dispatch(s, { type: 'setAutoDig', on: true })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(stateHash(s)).toBe(before);
    advance(s, 10_000);
    expect(hits(s)).toBe(0);
  });
  it('setAutoDig(false) はいつでも ok（何もしない）', () => {
    const s = createInitialState(1);
    expect(dispatch(s, { type: 'setAutoDig', on: false }).ok).toBe(true);
  });
  it('ドリル・自動掘削機を先に買っても解放されない（道具の段だけで決まる）', () => {
    const s = stateWith({ drill: 5, digger: 3 });
    expect(dispatch(s, { type: 'setAutoDig', on: true }).reason).toBe('locked');
  });
});

describe('TS-012-06 ツルハシの後の自動掘り（毎秒 2 打）', () => {
  it('オンの 10 秒で 20 打、オフの 10 秒で 0 打', () => {
    const s = stateWith({ tool: 1 });
    expect(dispatch(s, { type: 'setAutoDig', on: true }).ok).toBe(true);
    advance(s, 10_000);
    expect(hits(s)).toBe(20);
    dispatch(s, { type: 'setAutoDig', on: false });
    advance(s, 10_000);
    expect(hits(s)).toBe(20);
  });
});

describe('TS-012-07 切り替えで打撃が増えない', () => {
  it('100ms ごとにオン・オフを繰り返しても、ずっとオンより多くならない', () => {
    const toggled = stateWith({ tool: 1 });
    for (let i = 0; i < 100; i++) {
      dispatch(toggled, { type: 'setAutoDig', on: i % 2 === 0 });
      step(toggled, 100);
    }
    const steady = stateWith({ tool: 1 });
    dispatch(steady, { type: 'setAutoDig', on: true });
    advance(steady, 10_000);
    expect(hits(toggled)).toBeLessThanOrEqual(hits(steady));
  });
});

describe('TS-012-08 組み合わせ（Q-04(b)）', () => {
  it('長押し＋自動掘りは足さない（4/秒）', () => {
    const s = stateWith({ tool: 1, autoOn: true });
    dispatch(s, { type: 'hold', on: true });
    advance(s, 10_000);
    expect(hits(s)).toBe(40);
  });
  it('長押し中の連打・自動掘り中の連打も、手動の合計は 8/秒まで。自動掘削機の分は別枠で足される', () => {
    const a = stateWith({ tool: 1 });
    advance(a, 10_000, { input: { hold: true, tapsPerSec: 20 } });
    expect(hits(a)).toBeLessThanOrEqual(80);
    expect(hits(a)).toBeGreaterThanOrEqual(78);
    const b = stateWith({ tool: 1, autoOn: true, digger: 10 }); // 自動掘削機 Lv10 = 2 打/秒
    advance(b, 10_000, { input: { tapsPerSec: 20 } });
    expect(hits(b)).toBeGreaterThan(80);
    expect(hits(b)).toBeLessThanOrEqual(80 + 20);
  });
});

describe('TS-012-09 HP(d)・V(d)', () => {
  const s = createInitialState(1);
  const ref: [number, number, number][] = [
    [0, 4, 0.5],
    [10, 7.5794, 0.83009],
    [30, 27.213, 2.2879],
    [100, 2386.6, 79.532],
    [500, 3.0246e14, 0],
  ];
  it('式 4×1.066^d・0.5×1.052^d と相対誤差 1e-9 以内、シナリオの参考値と 5 桁で一致', () => {
    for (const [d, hp, v] of ref) {
      const h = blockHp(s, d).toNumber();
      expect(Math.abs(h - 4 * 1.066 ** d) / (4 * 1.066 ** d)).toBeLessThan(1e-9);
      expect(Math.abs(h - hp) / hp).toBeLessThan(1e-4);
      const val = blockValue(s, d, false).toNumber();
      expect(Math.abs(val - 0.5 * 1.052 ** d) / (0.5 * 1.052 ** d)).toBeLessThan(1e-9);
      if (v > 0) expect(Math.abs(val - v) / v).toBeLessThan(1e-4);
    }
  });
});

describe('TS-012-10 壊すと V(d) のコインが自動で入る（鉱石は ×8）', () => {
  it('普通のブロック・鉱石のブロック', () => {
    const s = stateWith({ seed: 3 });
    let oreDepth = -1;
    for (let d = 5; d < 200 && oreDepth < 0; d++) if (isOre(s, d)) oreDepth = d;
    expect(oreDepth).toBeGreaterThanOrEqual(5);
    for (const [d, ore] of [
      [oreDepth - 1, false],
      [oreDepth, true],
    ] as const) {
      const t = stateWith({ seed: 3, depth: d });
      expect(isOre(t, d)).toBe(ore);
      t.run.blockDmg = blockHp(t, d).sub(1);
      const before = t.run.coins;
      dispatch(t, { type: 'tap' });
      const got = t.run.coins.sub(before).toNumber();
      const want = 0.5 * 1.052 ** d * (ore ? 8 : 1);
      expect(Math.abs(got - want) / want).toBeLessThan(1e-9);
      expect(t.stats.totalCoins.sub(before).toNumber()).toBeCloseTo(got, 9);
    }
  });
});

describe('TS-012-11 ちょうど壊れる・少し足りない・余りの持ち越し（Q-02）', () => {
  it('残り HP ちょうどで壊れ、0.001 足りなければ壊れない', () => {
    const exact = createInitialState(1);
    exact.run.blockDmg = num(3);
    dispatch(exact, { type: 'tap' });
    expect([exact.run.depth, exact.run.blockDmg.toNumber()]).toEqual([1, 0]);
    const short = createInitialState(1);
    short.run.blockDmg = num(2.999);
    dispatch(short, { type: 'tap' });
    expect(short.run.depth).toBe(0);
    expect(short.run.blockDmg.toNumber()).toBeCloseTo(3.999, 9);
  });
  it('余ったダメージは次のブロックへ持ち越す', () => {
    const s = createInitialState(1);
    s.run.blockDmg = num(3.5);
    dispatch(s, { type: 'tap' });
    expect(s.run.depth).toBe(1);
    expect(s.run.blockDmg.toNumber()).toBeCloseTo(0.5, 12);
  });
  it('0〜4m は鉱石にしない（どのシードでも）', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const s = createInitialState(seed);
      for (let d = 0; d < 5; d++) expect(isOre(s, d)).toBe(false);
    }
  });
  it('#2: 毎秒 2 回のタップで、コインが初めてツルハシのコスト 3 以上になるのは 14.5 秒（どのシードでも）', () => {
    for (const seed of [1, 2, 10, 42, 12345]) {
      const s = createInitialState(seed);
      const carry = createAdvanceCarry();
      let t = 0;
      while (s.run.coins.lt(3) && t < 60_000) {
        advance(s, 100, { input: { tapsPerSec: 2 }, carry });
        t += 100;
      }
      expect(t).toBe(14_500);
      expect(s.stats.hits).toBe(29);
    }
  });
});

describe('TS-012-12 1 ステップで複数のブロックが壊れる', () => {
  it('深さの順に BlockBroken が N 回、コインは V(d)〜V(d+N−1) の合計', () => {
    const s = stateWith({ seed: 9, depth: 160, drill: 300 });
    const d0 = s.run.depth;
    let want = num(0);
    const out: GameEvent[] = [];
    dispatch(s, { type: 'tap' }).events.forEach((e) => out.push(e));
    const broken = out.filter((e) => e.type === 'BlockBroken');
    const n = s.run.depth - d0;
    expect(n).toBeGreaterThan(1);
    expect(broken.map((e) => (e as { depth: number }).depth)).toEqual(Array.from({ length: n }, (_, i) => d0 + i));
    for (let d = d0; d < d0 + n; d++) want = want.add(blockValue(s, d, isOre(s, d)));
    expect(Math.abs(s.run.coins.toNumber() - want.toNumber()) / want.toNumber()).toBeLessThan(1e-9);
  });
});

describe('TS-012-13 極端な威力でも 1 ステップが短時間で終わる', () => {
  it('ドリル Lv10000（威力 1e120 超）: 50ms 以内・結果が決定的', () => {
    const run = (): { ms: number; hash: string } => {
      const s = stateWith({ seed: 4, depth: 450, drill: 10_000, tool: 7 });
      const t0 = performance.now();
      dispatch(s, { type: 'tap' });
      return { ms: performance.now() - t0, hash: stateHash(s) };
    };
    // 実時間の判定を安定させる（全体の実行・CI では 1 回目の JIT やごみ集めで 60ms 台になることがあった。PM の指摘）:
    // 1 回温めてから 5 回測り、中央値で判定する
    const first = run();
    const runs = Array.from({ length: 5 }, run);
    for (const r of runs) expect(r.hash).toBe(first.hash);
    const median = runs.map((r) => r.ms).sort((x, y) => x - y)[2] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(50);
  });
});

describe('レビュー S-9: 刻みは 1 秒まで（それより長い step・advance は 1 秒ずつ進める）', () => {
  it('長押し 60 秒: 10 秒刻みは 1 秒刻みと同じ状態。0.1 秒刻みとの打数の差は 1% 以内（以前は 240 打と 48 打）', () => {
    const make = (): GameState => stateWith({ seed: 3, depth: 10, drill: 5, tool: 1 });
    const a = make();
    const b = make();
    const c = make();
    advance(a, 60_000, { stepMs: 10_000, input: { hold: true } });
    advance(b, 60_000, { stepMs: 1_000, input: { hold: true } });
    advance(c, 60_000, { stepMs: 100, input: { hold: true } });
    expect(stateHash(a)).toBe(stateHash(b));
    expect(Math.abs(hits(a) - hits(c)) / hits(c)).toBeLessThanOrEqual(0.01);
    expect(hits(c)).toBeGreaterThanOrEqual(230);
  });
  it('step(s, 10 秒) は step(s, 1 秒) を 10 回と同じ（自動掘削機・入湯料・帯の境目を含む）', () => {
    const make = (): GameState => stateWith({ seed: 9, depth: 25, drill: 30, tool: 2, digger: 20, autoOn: true, pumps: { simple: 3 }, bath: 0 });
    const a = make();
    const b = make();
    const ea: GameEvent[] = [];
    const eb: GameEvent[] = [];
    step(a, 10_000, ea);
    for (let i = 0; i < 10; i++) step(b, 1_000, eb);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(ea).toEqual(eb);
  });
});

describe('TS-012-14 地温（表示用の ℃。content/params.ts の折れ線）', () => {
  it('0m 15℃・10m 25℃・30m 38℃・80m 42℃・500m 85℃、その先は 1m あたり +0.13℃', () => {
    expect([0, 10, 30, 80, 150, 250, 400, 500].map(temperatureAt)).toEqual([15, 25, 38, 42, 48, 58, 72, 85]);
    expect(temperatureAt(5)).toBe(20);
    expect(temperatureAt(100)).toBe(44); // 42 + 6×20/70 = 43.7
    expect(temperatureAt(600)).toBe(98); // 85 + 13
  });
  it('深さとともに単調に増え（減らない）、不正な深さは 0m 扱い', () => {
    let prev = -Infinity;
    for (let d = 0; d <= 2000; d++) {
      const t = temperatureAt(d);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect([temperatureAt(-5), temperatureAt(Number.NaN)]).toEqual([15, 15]);
  });
  it('selector temperatureOf は今の深さの地温', () => {
    expect(temperatureOf(stateWith({ depth: 30 }))).toBe(38);
  });
});

describe('TS-012-25 ランダムな入力列でも、手動の打撃は任意の 1 秒で 8 以下（property）', () => {
  it('タップ・長押し・自動掘りのオンオフを 60 秒', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            taps: fc.integer({ min: 0, max: 12 }),
            hold: fc.option(fc.boolean(), { nil: undefined }),
            auto: fc.option(fc.boolean(), { nil: undefined }),
            wait: fc.integer({ min: 1, max: 6 }).map((k) => k * 100),
          }),
          { minLength: 20, maxLength: 120 },
        ),
        (plan) => {
          const s = stateWith({ tool: 1 });
          const log: [number, number][] = []; // [playedMs, 打撃の増分]
          const note = (before: number): void => {
            if (hits(s) > before) log.push([s.clock.playedMs, hits(s) - before]);
          };
          for (const p of plan) {
            if (s.clock.playedMs >= 60_000) break;
            let h = hits(s);
            if (p.taps > 0) dispatch(s, { type: 'tap', count: p.taps });
            if (p.hold !== undefined) dispatch(s, { type: 'hold', on: p.hold });
            if (p.auto !== undefined) dispatch(s, { type: 'setAutoDig', on: p.auto });
            note(h);
            for (let t = 0; t < p.wait; t += 100) {
              h = hits(s);
              step(s, 100);
              note(h);
            }
          }
          for (const [t] of log) {
            const inWindow = log.filter(([u]) => u > t - 1000 && u <= t).reduce((a, [, n]) => a + n, 0);
            expect(inWindow).toBeLessThanOrEqual(8);
          }
        },
      ),
      { numRuns: 60, seed: 12 },
    );
  });
});
