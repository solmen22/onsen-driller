// BL-014: ドリル・自動掘削機・道具 7 段・購入（TS-014-01〜18。Q-03・Q-08・Q-09・PM の依頼 1・2）
import fc from 'fast-check';
import { fcRuns } from '../helpers/fc-runs.ts';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/content/tools.ts';
import {
  advance,
  autoDiggerCost,
  autoDiggerHitsPerSec,
  autoDigState,
  bathIncomePerSec,
  blockHp,
  blockValue,
  buyQuote,
  createInitialState,
  dispatch,
  drillCost,
  drillPower,
  incomePerSec,
  isHealthy,
  num,
  secondsUntil,
  stateHash,
  sumGeometric,
  type GameEvent,
  type Qty,
} from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

describe('TS-014-01・02 ドリルの威力 (1＋Lv)×2^floor(Lv/25)×道具の倍率', () => {
  it('道具 0: Lv0・1・24・25・49・50 → 1・2・25・52・100・204', () => {
    expect([0, 1, 24, 25, 49, 50].map((drill) => drillPower(stateWith({ drill })).toNumber())).toEqual([1, 2, 25, 52, 100, 204]);
  });
  it('Lv0: ツルハシ 1.5・手掘りやぐら 3.75・伝説のドリル 366.2109375（掛け算で積み上がる）', () => {
    expect([1, 2, 7].map((tool) => drillPower(stateWith({ tool })).toNumber())).toEqual([1.5, 3.75, 366.2109375]);
  });
});

describe('TS-014-03・05 コスト（ドリル 5×1.16^Lv、自動掘削機 40×1.18^Lv）', () => {
  it('式と相対誤差 1e-9、シナリオの参考値と 6 桁で一致', () => {
    const drill: [number, number][] = [
      [0, 5],
      [1, 5.8],
      [10, 22.05718],
      [25, 204.3712],
    ];
    for (const [lv, ref] of drill) {
      const c = drillCost(lv).toNumber();
      expect(rel(c, 5 * 1.16 ** lv)).toBeLessThan(1e-9);
      expect(rel(c, ref)).toBeLessThan(1e-6);
    }
    const auto: [number, number][] = [
      [0, 40],
      [1, 47.2],
      [10, 209.3534],
      [25, 2506.745],
    ];
    for (const [lv, ref] of auto) {
      const c = autoDiggerCost(lv).toNumber();
      expect(rel(c, 40 * 1.18 ** lv)).toBeLessThan(1e-9);
      expect(rel(c, ref)).toBeLessThan(1e-6);
    }
  });
});

describe('TS-014-04・06 自動掘削機（0.2×Lv×2^floor(Lv/25) 打/秒。自動掘りのスイッチと無関係に常に動く。Q-08）', () => {
  it('Lv0・1・10・24・25 → 0・0.2・2・4.8・10', () => {
    const got = [0, 1, 10, 24, 25].map((digger) => autoDiggerHitsPerSec(stateWith({ digger })));
    [0, 0.2, 2, 4.8, 10].forEach((want, i) => expect(got[i]).toBeCloseTo(want, 12));
  });
  it('自動掘削機 Lv5・自動掘りオフで 10 秒 → 10 打', () => {
    const s = stateWith({ digger: 5, autoOn: false });
    advance(s, 10_000);
    expect(s.stats.hits).toBe(10);
  });
});

describe('TS-014-07 道具 7 段の表（gdd §5-3）', () => {
  it('順番・解放の深さ・コスト・倍率', () => {
    expect(TOOLS.map((t) => [t.id, t.unlockDepth, t.cost, t.mult])).toEqual([
      ['shovel', 0, 0, 1],
      ['pickaxe', 0, 3, 1.5],
      ['yagura', 25, 400, 2.5],
      ['boring', 70, 2e4, 2.5],
      ['bigDrill', 130, 6e5, 2.5],
      ['geoDrill', 200, 3e7, 2.5],
      ['giantDrill', 290, 2e9, 2.5],
      ['legendDrill', 400, 3e11, 2.5],
    ]);
  });
});

describe('TS-014-08〜12 道具の進化（一度だけ・周回の最深で解放・1 回で 1 段）', () => {
  it('TS-014-08 最深 24m では手掘りやぐらは locked で状態不変', () => {
    const s = stateWith({ tool: 1, maxDepth: 24, coins: 1000 });
    const before = stateHash(s);
    expect(dispatch(s, { type: 'buy', item: 'tool', qty: 1 })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(stateHash(s)).toBe(before);
    expect(buyQuote(s, 'tool', 1)).toMatchObject({ state: 'locked', unlockDepth: 25 });
  });
  it('TS-014-09 コイン 399.99 は足りない、400 ちょうどで買えてコインがちょうど 0・ToolEvolved{tool:2} が 1 回', () => {
    const short = stateWith({ tool: 1, maxDepth: 25, coins: 399.99 });
    const before = stateHash(short);
    expect(dispatch(short, { type: 'buy', item: 'tool', qty: 1 }).reason).toBe('insufficient');
    expect(stateHash(short)).toBe(before);
    const s = stateWith({ tool: 1, maxDepth: 25, coins: 400 });
    const r = dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
    expect(r.ok).toBe(true);
    expect(s.run.coins.eq(0)).toBe(true);
    expect(s.run.coins.mantissa).toBe(0);
    expect(s.run.drill.tool).toBe(2);
    expect(r.events.filter((e) => e.type === 'ToolEvolved')).toEqual([{ type: 'ToolEvolved', tool: 2 }]);
  });
  it('TS-014-10 最深 400m・コイン十分: 1 段ずつ進み、7 段目で止まり、8 回目は maxed', () => {
    const s = stateWith({ maxDepth: 400, coins: '1e15' });
    const evolved: GameEvent[] = [];
    for (let i = 1; i <= 7; i++) {
      const r = dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
      expect(r.ok).toBe(true);
      expect(s.run.drill.tool).toBe(i);
      evolved.push(...r.events.filter((e) => e.type === 'ToolEvolved'));
    }
    expect(evolved.map((e) => (e as { tool: number }).tool)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const before = stateHash(s);
    expect(dispatch(s, { type: 'buy', item: 'tool', qty: 1 })).toEqual({ ok: false, reason: 'maxed', events: [] });
    expect(stateHash(s)).toBe(before);
    expect(buyQuote(s, 'tool', 'max').state).toBe('maxed');
  });
  it('TS-014-11 解放の判定は周回の最深（今の深さが 25m 未満でも、最深が 25m 以上なら解放）', () => {
    const s = stateWith({ tool: 1, depth: 10, maxDepth: 25, coins: 400 });
    expect(dispatch(s, { type: 'buy', item: 'tool', qty: 1 }).ok).toBe(true);
  });
  it('TS-014-12 qty 10・max でも 1 段だけ進み、コインは 1 段分だけ減る', () => {
    for (const qty of [10, 'max'] as Qty[]) {
      const s = stateWith({ maxDepth: 400, coins: 1000 });
      expect(dispatch(s, { type: 'buy', item: 'tool', qty }).ok).toBe(true);
      expect(s.run.drill.tool).toBe(1);
      expect(s.run.coins.eq(997)).toBe(true);
    }
  });
  it('ツルハシを買うと自動掘りが使えるようになる（autoDigState: locked → off → on）', () => {
    const s = stateWith({ coins: 3 });
    expect(autoDigState(s)).toBe('locked');
    dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
    expect(autoDigState(s)).toBe('off');
    dispatch(s, { type: 'setAutoDig', on: true });
    expect(autoDigState(s)).toBe('on');
  });
});

describe('TS-014-13〜15 購入の整合', () => {
  it('TS-014-13 コイン 10 でドリル ×1 → 5（Decimal で完全一致）・Lv1・Purchased', () => {
    const s = stateWith({ coins: 10 });
    const r = dispatch(s, { type: 'buy', item: 'drill', qty: 1 });
    expect(s.run.coins.eq(5)).toBe(true);
    expect(s.run.drill.level).toBe(1);
    expect(r.events).toContainEqual({ type: 'Purchased', item: 'drill', qty: 1 });
  });
  it('TS-014-14 10 個の合計ちょうどで ×10 が買えてコイン 0（負にならない）、少し足りなければ状態不変', () => {
    const sum = sumGeometric(10, 5, 1.16, 0);
    expect(sum.toNumber()).toBeCloseTo(106.60735, 4);
    const s = stateWith();
    s.run.coins = sum;
    expect(dispatch(s, { type: 'buy', item: 'drill', qty: 10 }).ok).toBe(true);
    expect(s.run.coins.eq(0)).toBe(true);
    expect(s.run.drill.level).toBe(10);
    const t = stateWith({ coins: 106.607 });
    const before = stateHash(t);
    expect(dispatch(t, { type: 'buy', item: 'drill', qty: 10 }).reason).toBe('insufficient');
    expect(stateHash(t)).toBe(before);
    expect(buyQuote(t, 'drill', 10)).toMatchObject({ state: 'insufficient', n: 10 });
  });
  it('TS-014-15 「最大」: 7 個ぶん＋少しなら 7 個買い、残りは次の 1 個未満。0 個なら insufficient で状態不変', () => {
    const s = stateWith();
    s.run.coins = sumGeometric(7, 5, 1.16, 0).add(0.5);
    const q = buyQuote(s, 'drill', 'max');
    expect(q).toMatchObject({ state: 'affordable', n: 7 });
    expect(dispatch(s, { type: 'buy', item: 'drill', qty: 'max' }).events).toContainEqual({ type: 'Purchased', item: 'drill', qty: 7 });
    expect(s.run.coins.gte(0) && s.run.coins.lt(drillCost(7))).toBe(true);
    const z = stateWith({ coins: 4.99 });
    const before = stateHash(z);
    const zq = buyQuote(z, 'drill', 'max');
    expect(zq.state).toBe('insufficient');
    expect(zq.n).toBe(0);
    expect(zq.cost.eq(0)).toBe(true);
    expect(zq.nextCost.eq(5)).toBe(true);
    expect(dispatch(z, { type: 'buy', item: 'drill', qty: 'max' })).toEqual({ ok: false, reason: 'insufficient', events: [] });
    expect(stateHash(z)).toBe(before);
  });
  it('未発見の源泉のポンプは locked（解放の深さ付き）', () => {
    const s = stateWith({ coins: 1e9 });
    expect(buyQuote(s, 'pump:co2', 1)).toMatchObject({ state: 'locked', unlockDepth: 80 });
    expect(dispatch(s, { type: 'buy', item: 'pump:co2', qty: 1 }).reason).toBe('locked');
  });
});

describe('TS-014-16 見積もりと購入が一致する（property）', () => {
  it('ランダムなコイン・レベル・qty・品目', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e12, noNaN: true }),
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 450 }),
        fc.constantFrom<Qty>(1, 10, 'max'),
        fc.constantFrom('drill', 'autoDigger', 'bath', 'tool', 'pump:simple'),
        (coins, lv, tool, maxDepth, qty, item) => {
          const s = stateWith({ coins, drill: lv, digger: lv, bath: Math.min(lv, 40), tool, maxDepth, pumps: { simple: lv + 1 } });
          const q = buyQuote(s, item, qty);
          const before = stateHash(s);
          const coinsBefore = s.run.coins;
          const levelOf = (): number =>
            item === 'drill' ? s.run.drill.level : item === 'autoDigger' ? s.run.autoDig.level : item === 'bath' ? s.run.bath.level : item === 'tool' ? s.run.drill.tool : (s.run.springs.simple?.pump ?? 0);
          const lvBefore = levelOf();
          const r = dispatch(s, { type: 'buy', item, qty });
          expect(r.ok).toBe(q.state === 'affordable');
          if (r.ok) {
            expect(s.run.coins.eq(coinsBefore.sub(q.cost)) || s.run.coins.eq(0)).toBe(true);
            expect(s.run.coins.gte(0)).toBe(true);
            expect(levelOf() - lvBefore).toBe(q.n);
          } else {
            expect(stateHash(s)).toBe(before);
          }
        },
      ),
      fcRuns(300, 1416),
    );
  });
});

describe('TS-014-17・18 コストの単調性と健全性（#22）', () => {
  it('Lv0〜1000 でドリル・自動掘削機のコストが狭義単調増加', () => {
    for (let lv = 0; lv < 1000; lv++) {
      expect(drillCost(lv + 1).gt(drillCost(lv))).toBe(true);
      expect(autoDiggerCost(lv + 1).gt(autoDiggerCost(lv))).toBe(true);
    }
  });
  it('ドリル Lv5000: コスト約 1e322 でも健全、威力も健全', () => {
    const c = drillCost(5000);
    expect(isHealthy(c)).toBe(true);
    expect(c.exponent).toBeGreaterThanOrEqual(321);
    expect(isHealthy(drillPower(stateWith({ drill: 5000, tool: 7 })))).toBe(true);
  });
});

describe('selectors: 毎秒の収入と「あと N 秒」（PM の依頼 2・Q-09）', () => {
  it('新しいゲームの収入は 0 → secondsUntil は null（「あと N コイン」を出す）、足りていれば 0', () => {
    const s = createInitialState(1);
    expect(incomePerSec(s).eq(0)).toBe(true);
    expect(secondsUntil(s, num(3))).toBeNull();
    s.run.coins = num(3);
    expect(secondsUntil(s, num(3))).toBe(0);
  });
  it('自動掘りオン（2 打/秒）: 収入 ＝ 2 × 威力 ÷ HP × 価値（0〜4m は鉱石なし）。「あと N 秒」は切り上げ', () => {
    const s = stateWith({ tool: 1, autoOn: true }); // 威力 1.5・HP(0)=4・V(0)=0.5 → 0.375/秒
    expect(incomePerSec(s).toNumber()).toBeCloseTo(0.375, 12);
    expect(secondsUntil(s, num(3))).toBe(8); // 3 ÷ 0.375 = 8（割り切れる）
    expect(secondsUntil(s, num(3.1))).toBe(9); // 8.27 → 9
    s.run.coins = num(1);
    expect(secondsUntil(s, num(3))).toBe(6); // 2 ÷ 0.375 = 5.33 → 6
  });
  it('深さ 5m 以降は鉱石の期待値（1 − p ＋ 8p）が入り、入湯料が足される', () => {
    const s = stateWith({ tool: 1, autoOn: true, depth: 40, pumps: { simple: 3 }, bath: 0 });
    const m = 1 - 0.06 + 0.06 * 8;
    const dig = (2 * drillPower(s).toNumber() * blockValue(s, 40, false).toNumber() * m) / blockHp(s, 40).toNumber();
    expect(rel(incomePerSec(s).toNumber(), dig + bathIncomePerSec(s).toNumber())).toBeLessThan(1e-9);
  });
  it('長押し・タップは含めない（手動は入力しだいのため）', () => {
    const s = stateWith({ hold: true });
    expect(incomePerSec(s).eq(0)).toBe(true);
  });
});
