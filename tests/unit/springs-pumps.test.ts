// BL-015: 源泉 5 種とポンプ（TS-015-01〜15。gdd §5-4・arch §6-2・Q-31）。
// 発見（越えたら発見）・無料のポンプ Lv1・入湯料の式・マイルストーン・コスト・つないでいない源泉は 0・保存の往復・刻み幅。
// TS-015-16〜20（標準ボットの #3・#4・#7・#8・#18）は BL-033 の目標表の判定（それまでは npm run sim のレポート）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../../src/content/springs.ts';
import {
  advance,
  bathIncomePerSec,
  blockHp,
  buyQuote,
  cloneState,
  contentProblems,
  createInitialState,
  dispatch,
  drillPower,
  isHealthy,
  modifiers,
  nextPumpMilestone,
  num,
  pumpCost,
  pumpMilestoneMult,
  springAtDepth,
  springIncome,
  springViews,
  stateHash,
  type GameEvent,
  type GameState,
  type Qty,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { SPRING_IDS, stateWith } from '../support/states.ts';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

/** 深さ d−1 のブロックの手前から 1 回タップして、深さ d に届かせる（威力を十分に大きくし、帯の境目の幕間で止まる） */
function reach(s: GameState, d: number): GameEvent[] {
  s.run.depth = d - 1;
  s.run.maxDepth = Math.max(s.run.maxDepth, d - 1);
  s.run.drill.level = 5000;
  s.run.drill.tool = 7;
  const r = dispatch(s, { type: 'tap' });
  expect(r.ok).toBe(true);
  expect(s.run.depth).toBe(d);
  return r.events;
}

/**
 * 深さ d−1 のブロックを「ちょうど 1 打で壊れる」状態にして 1 回タップし、深さ d に進める（それより先は壊さない。
 * 幕間は解除しておく）
 */
function oneBlockTo(s: GameState, d: number): GameEvent[] {
  s.run.depth = d - 1;
  s.run.maxDepth = Math.max(s.run.maxDepth, d - 1);
  s.run.interludeMs = 0;
  s.run.drill.level = 0;
  s.run.drill.tool = 0;
  s.run.blockDmg = blockHp(s, d - 1).sub(drillPower(s));
  const r = dispatch(s, { type: 'tap' });
  expect(r.ok).toBe(true);
  expect(s.run.depth).toBe(d);
  return r.events;
}

const found = (evs: readonly GameEvent[]): Extract<GameEvent, { type: 'SpringFound' }>[] =>
  evs.filter((e): e is Extract<GameEvent, { type: 'SpringFound' }> => e.type === 'SpringFound');

describe('TS-015-01 源泉の定義（gdd §5-4 の表）と内容定義の検査', () => {
  it('5 種の ID・深さ・初期コスト・成長率・基本湧出・効果', () => {
    expect(SPRINGS.map((sp) => [sp.id, sp.depth, sp.pumpC0, sp.pumpR, sp.flow, sp.effect])).toEqual([
      ['simple', 30, 60, 1.11, 1, { kind: 'incomeAll', mult: 1.2 }],
      ['co2', 80, 3_000, 1.12, 30, { kind: 'drillPower', mult: 1.5 }],
      ['salt', 150, 120_000, 1.13, 1_200, { kind: 'offlineEff', add: 0.25 }],
      ['sulfur', 250, 2e7, 1.14, 5e4, { kind: 'oreValue', mult: 2 }],
      ['iron', 400, 8e9, 1.15, 2.5e6, { kind: 'hardness', mult: 0.8 }],
    ]);
  });

  it('contentProblems() が 0 件（深さ・コスト・基本湧出が増えていく、成長率 > 1、マイルストーンが増えていく、名前のキー）', () => {
    expect(contentProblems()).toEqual([]);
  });

  it('名前のキー spring.<id> が en.json・ja.json の両方にある', () => {
    for (const sp of SPRINGS) {
      expect(sp.nameKey).toBe(`spring.${sp.id}`);
      expect(Object.hasOwn(en, sp.nameKey)).toBe(true);
      expect(Object.hasOwn(ja, sp.nameKey)).toBe(true);
    }
  });

  it('springAtDepth（表示用）は源泉の深さちょうどだけ。500m は伝説の源泉（BL-023）なので今は null', () => {
    expect(SPRINGS.map((sp) => springAtDepth(sp.depth))).toEqual(SPRING_IDS);
    for (const d of [0, 29, 31, 79, 81, 149, 151, 249, 251, 399, 401, 500]) expect(springAtDepth(d)).toBeNull();
  });
});

describe('TS-015-02・03 深さに届くと源泉を発見し、ポンプ Lv1 が無料で付く（山あい）', () => {
  it('TS-015-02 新しいゲームで 30m に届く: SpringFound 1 回・Lv1・図鑑・枠 0・StratumEntered{band:1}・コインは減らない', () => {
    const s = createInitialState(1);
    const coinsBefore = s.run.coins;
    const ev = reach(s, 30);
    expect(ev.map((e) => e.type)).toEqual(['BlockBroken', 'StratumEntered', 'SpringFound', 'GuestArrived']);
    expect(found(ev)).toEqual([{ type: 'SpringFound', spring: 'simple', depth: 30 }]);
    expect(ev).toContainEqual({ type: 'StratumEntered', band: 1 });
    expect(s.run.springs.simple).toEqual({ pump: 1 });
    expect(s.collection.springsSeen).toEqual(['simple']);
    expect(s.run.bath).toEqual({ level: 0, slots: ['simple'] });
    expect(s.run.coins.gte(coinsBefore)).toBe(true);
  });

  it.each([
    ['co2', 80],
    ['salt', 150],
    ['sulfur', 250],
    ['iron', 400],
  ] as [SpringId, number][])('TS-015-03 %s: %im に届いた時点で 1 回だけ発見・Lv1・代金を取らない', (id, depth) => {
    const before = SPRINGS.filter((sp) => sp.depth < depth).map((sp) => sp.id);
    const s = stateWith({ bath: 35, pumps: Object.fromEntries(before.map((b) => [b, 1])) });
    const coinsBefore = s.run.coins;
    const ev = reach(s, depth);
    expect(found(ev)).toEqual([{ type: 'SpringFound', spring: id, depth }]);
    expect(s.run.springs[id]).toEqual({ pump: 1 });
    expect(s.collection.springsSeen).toContain(id);
    const gained = ev.reduce((a, e) => (e.type === 'BlockBroken' ? a.add(num(e.coins)) : a), num(0));
    expect(rel(s.run.coins.toNumber(), coinsBefore.add(gained).toNumber())).toBeLessThan(1e-12);
  });

  it('発見した源泉は空いている最初の枠につながる（2 つ目以降も。Q-31 (a)）。空きがなければつながない', () => {
    const t = stateWith({ bath: 5, pumps: { simple: 3 } });
    expect(t.run.bath.slots).toEqual(['simple', null]);
    reach(t, 80);
    expect(t.run.bath.slots).toEqual(['simple', 'co2']);
    const u = stateWith({ bath: 15, pumps: { simple: 3, co2: 1 } });
    u.run.bath.slots = [null, 'co2', null];
    reach(u, 150);
    expect(u.run.bath.slots).toEqual(['salt', 'co2', null]);
  });
});

describe('TS-015-04・05 発見の境目', () => {
  it('TS-015-04 同じ周回でもう一度 30m を越えても 2 回目の発見はない（ポンプの Lv は戻らない・図鑑は重複しない）', () => {
    const s = createInitialState(1);
    reach(s, 30);
    s.run.springs.simple = { pump: 7 };
    s.run.depth = 25; // setState で浅く戻したのと同じ（同じ周回。帯 2 は入ったことがある）
    const ev = oneBlockTo(s, 30);
    expect(found(ev)).toEqual([]);
    expect(s.run.springs.simple).toEqual({ pump: 7 });
    expect(s.collection.springsSeen).toEqual(['simple']);
  });

  it('TS-015-05 29m のブロックの残り HP が 1 打より少し多いと発見しない・ちょうど 1 打分なら壊しきった打撃で発見する', () => {
    const at = (extra: number): { s: GameState; ev: GameEvent[] } => {
      const s = createInitialState(1);
      s.run.depth = 29;
      s.run.maxDepth = 29;
      s.run.drill.level = 3;
      const hp = blockHp(s, 29);
      s.run.blockDmg = hp.sub(drillPower(s)).sub(extra);
      return { s, ev: dispatch(s, { type: 'tap' }).events };
    };
    const more = at(1e-6); // 残り HP ＝ 1 打 ＋ ほんの少し
    expect(more.s.run.depth).toBe(29);
    expect(found(more.ev)).toEqual([]);
    expect(more.s.run.springs.simple).toBeUndefined();
    const exact = at(0);
    expect(exact.s.run.depth).toBe(30);
    expect(found(exact.ev)).toEqual([{ type: 'SpringFound', spring: 'simple', depth: 30 }]);
  });

  it('Q-31 (e) 源泉の深さを越えた状態（読み込み・地形）から掘っても見逃さない: 次に壊したブロックで浅い順に発見し、depth は源泉の深さ', () => {
    const s = createInitialState(2);
    s.run.depth = 100; // 単純温泉・二酸化炭素泉の深さを越えているが未発見
    s.run.maxDepth = 100;
    s.run.stratumSeen = [0, 1, 2];
    const ev = oneBlockTo(s, 101);
    expect(found(ev)).toEqual([
      { type: 'SpringFound', spring: 'simple', depth: 30 },
      { type: 'SpringFound', spring: 'co2', depth: 80 },
    ]);
    expect(s.run.springs).toEqual({ simple: { pump: 1 }, co2: { pump: 1 } });
    expect(s.run.bath.slots).toEqual(['simple']); // 枠は 1 つ
  });

  it('TS-015-15 499m → 500m を越えて掘っても例外がなく、伝説の源泉（BL-023）の SpringFound はまだ出ない', () => {
    const s = stateWith({ bath: 35, pumps: { simple: 1, co2: 1, salt: 1, sulfur: 1, iron: 1 } });
    let ev: GameEvent[] = [];
    expect(() => {
      ev = reach(s, 500);
      advance(s, 5_000, { input: { tapsPerSec: 8 } });
    }).not.toThrow();
    expect(found(ev)).toEqual([]);
    expect(s.run.depth).toBeGreaterThanOrEqual(500);
    expect(isHealthy(s.run.coins)).toBe(true);
  });
});

describe('TS-015-06・07 入湯料/秒＝基本湧出×Lv×マイルストーン×湯船×お客さん×泉質×転生の倍率', () => {
  it('マイルストーン: Lv10・25・50・100 で各 ×2。次のマイルストーン', () => {
    expect([1, 9, 10, 24, 25, 49, 50, 99, 100, 1000].map(pumpMilestoneMult)).toEqual([1, 1, 2, 2, 4, 4, 8, 8, 16, 16]);
    expect([0, 1, 9, 10, 24, 25, 49, 50, 99, 100, 5000].map(nextPumpMilestone)).toEqual([10, 10, 10, 25, 25, 50, 50, 100, 100, null, null]);
  });

  it('TS-015-06 単純温泉の基本の入湯料 Lv1＝1・9＝9・10＝20・24＝48・25＝100・49＝196・50＝400・99＝792・100＝1,600', () => {
    const lvs = [1, 9, 10, 24, 25, 49, 50, 99, 100];
    expect(lvs.map((lv) => springIncome(stateWith({ pumps: { simple: lv } }), 'simple').toNumber())).toEqual([1, 9, 20, 48, 100, 196, 400, 792, 1600]);
  });

  it.each(SPRING_IDS)('TS-015-06 %s の基本の入湯料＝基本湧出 × Lv × マイルストーン（Lv1 と Lv10 は ×20）', (id) => {
    const flow = SPRING_BY_ID[id].flow;
    expect(springIncome(stateWith({ pumps: { [id]: 1 } }), id).toNumber()).toBe(flow);
    for (const lv of [10, 25, 50, 100, 137]) {
      expect(rel(springIncome(stateWith({ pumps: { [id]: lv } }), id).toNumber(), flow * lv * pumpMilestoneMult(lv))).toBeLessThan(1e-12);
    }
  });

  it('TS-015-07 湯船 Lv5 に単純温泉 Lv10・二酸化炭素泉 Lv1: (20＋30)×1.25×(1.2×1.5)＝112.5、湯の華 10 で ×1.2＝135', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 10, co2: 1 } });
    expect(s.run.bath.slots).toEqual(['simple', 'co2']);
    expect(s.run.guests).toEqual(['tanuki']);
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(112.5, 9);
    s.meta.yunohana.lifetime = num(10);
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(135, 9);
    expect(isHealthy(bathIncomePerSec(s))).toBe(true);
  });

  it('枠 1 に単純温泉 Lv10 だけ: 20 × 1.2 × 1.5 ＝ 36/秒。湯船 Lv4 で ×1.2', () => {
    expect(bathIncomePerSec(stateWith({ bath: 0, pumps: { simple: 10 } })).toNumber()).toBeCloseTo(36, 10);
    expect(bathIncomePerSec(stateWith({ bath: 4, pumps: { simple: 10 } })).toNumber()).toBeCloseTo(36 * 1.2, 9);
  });
});

describe('TS-015-08 枠につないでいない源泉の入湯料は 0', () => {
  it('枠 1 が単純温泉で埋まっているとき、見つけた二酸化炭素泉のポンプを Lv20 にしても入湯料もドリル威力も変わらない', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 12 }, coins: '1e12' });
    const income = bathIncomePerSec(s).toString();
    const power = drillPower(s).toString();
    reach(s, 80);
    s.run.drill.level = 0;
    s.run.drill.tool = 0;
    const powerAfterReach = drillPower(s).toString();
    expect(dispatch(s, { type: 'buy', item: 'pump:co2', qty: 10 }).ok).toBe(true);
    expect(dispatch(s, { type: 'buy', item: 'pump:co2', qty: 'max' }).ok).toBe(true);
    expect(s.run.springs.co2?.pump).toBeGreaterThanOrEqual(20);
    expect(s.run.bath.slots).toEqual(['simple']);
    expect(bathIncomePerSec(s).toString()).toBe(income);
    expect(drillPower(s).toString()).toBe(powerAfterReach);
    expect(modifiers(s).drillPower).toBe(1);
    expect(power).toBe(drillPower(stateWith({ bath: 0, pumps: { simple: 12 } })).toString());
  });

  it('springViews: 枠にない源泉の incomePerSec は 0、つないだときの目安は正。枠の源泉は合計と一致', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 5, co2: 3 } });
    const v = springViews(s);
    const co2 = v.find((x) => x.id === 'co2');
    expect(co2).toMatchObject({ found: true, pump: 3, slot: null });
    expect(co2?.incomePerSec.toNumber()).toBe(0);
    expect(co2?.potentialPerSec.gt(0)).toBe(true);
    expect(rel(v.find((x) => x.id === 'simple')?.incomePerSec.toNumber() ?? 0, bathIncomePerSec(s).toNumber())).toBeLessThan(1e-12);
  });

  it('枠から外すと 0、つなぎ直すと戻る（ポンプの Lv は源泉に残る）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 20 } });
    const before = bathIncomePerSec(s).toString();
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: null }).ok).toBe(true);
    expect(bathIncomePerSec(s).toNumber()).toBe(0);
    expect(s.run.springs.simple?.pump).toBe(20);
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: 'simple' }).ok).toBe(true);
    expect(bathIncomePerSec(s).toString()).toBe(before);
  });

  it('性質: springViews の incomePerSec の合計＝入湯料/秒（丸めの範囲）、つないでいない源泉は 0（fast-check）', () => {
    const lv = fc.integer({ min: 0, max: 300 });
    fc.assert(
      fc.property(fc.tuple(lv, lv, lv, lv, lv), fc.integer({ min: 0, max: 60 }), (lvs, bath) => {
        const s = stateWith({ bath, pumps: Object.fromEntries(SPRING_IDS.map((id, i) => [id, lvs[i] ?? 0])) });
        const v = springViews(s);
        const sum = v.reduce((a, x) => a + x.incomePerSec.toNumber(), 0);
        const total = bathIncomePerSec(s).toNumber();
        return v.every((x) => x.slot !== null || x.incomePerSec.eq(0)) && (total === 0 ? sum === 0 : rel(sum, total) < 1e-9);
      }),
      { numRuns: 200 },
    );
  });
});

describe('TS-015-09〜12 ポンプの購入とコスト（次の 1 Lv＝c₀×r^今の Lv。Q-31 (b)）', () => {
  it('TS-015-09 単純温泉 Lv1・コイン 1,000: ×1 は 66.6、続けて ×10・最大。代金は見積もりどおり、Purchased の数', () => {
    const s = stateWith({ coins: 1000, bath: 0, pumps: { simple: 1 } });
    for (const qty of [1, 10, 'max'] as Qty[]) {
      const q = buyQuote(s, 'pump:simple', qty);
      const before = s.run.coins;
      const lv = s.run.springs.simple?.pump ?? 0;
      const r = dispatch(s, { type: 'buy', item: 'pump:simple', qty });
      if (qty === 1) expect(q.cost.toNumber()).toBeCloseTo(66.6, 9);
      if (q.state === 'affordable') {
        expect(r.ok).toBe(true);
        expect(r.events).toContainEqual({ type: 'Purchased', item: 'pump:simple', qty: q.n });
        expect(s.run.coins.toString()).toBe(before.sub(q.cost).toString());
        expect((s.run.springs.simple?.pump ?? 0) - lv).toBe(q.n);
      } else {
        expect(r).toEqual({ ok: false, reason: 'insufficient', events: [] });
      }
    }
  });

  it.each(SPRING_IDS)('%s: Lv1 の次は c₀×r（参考 66.6・3,360・135,600・2,280 万・92 億）、Lv の式と相対誤差 1e-9', (id) => {
    const { pumpC0: c0, pumpR: r } = SPRING_BY_ID[id];
    const ref: Record<SpringId, number> = { simple: 66.6, co2: 3360, salt: 135_600, sulfur: 2.28e7, iron: 9.2e9 };
    expect(rel(pumpCost(id, 1).toNumber(), ref[id])).toBeLessThan(1e-9);
    for (const lv of [1, 2, 10, 25, 60]) expect(rel(pumpCost(id, lv).toNumber(), c0 * r ** lv)).toBeLessThan(1e-9);
  });

  it('TS-015-10 未発見の源泉のポンプは locked（解放の深さ＝発見の深さ）、状態不変', () => {
    const s = stateWith({ coins: '1e30', pumps: { simple: 1 } });
    for (const sp of SPRINGS.filter((x) => x.id !== 'simple')) {
      expect(buyQuote(s, `pump:${sp.id}`, 1)).toMatchObject({ state: 'locked', unlockDepth: sp.depth, n: 0 });
      const h = stateHash(s);
      expect(dispatch(s, { type: 'buy', item: `pump:${sp.id}`, qty: 1 })).toEqual({ ok: false, reason: 'locked', events: [] });
      expect(stateHash(s)).toBe(h);
    }
  });

  it('TS-015-11 見積もりと購入が一致する（ポンプ 5 種・fast-check）', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e15, noNaN: true }),
        fc.integer({ min: 1, max: 400 }),
        fc.constantFrom<Qty>(1, 10, 'max'),
        fc.constantFrom(...SPRING_IDS),
        (coins, lv, qty, id) => {
          const s = stateWith({ coins, bath: 35, pumps: { simple: lv, co2: lv, salt: lv, sulfur: lv, iron: lv } });
          const item = `pump:${id}` as const;
          const q = buyQuote(s, item, qty);
          const before = stateHash(s);
          const coinsBefore = s.run.coins;
          const r = dispatch(s, { type: 'buy', item, qty });
          if (r.ok !== (q.state === 'affordable')) return false;
          if (!r.ok) return stateHash(s) === before;
          return s.run.coins.eq(coinsBefore.sub(q.cost)) && (s.run.springs[id]?.pump ?? 0) - lv === q.n;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('TS-015-12 コストは Lv に対して狭義単調増加で健全（#22）。Lv の上限では maxed', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SPRING_IDS), fc.integer({ min: 1, max: 1000 }), (id, lv) => {
        const a = pumpCost(id, lv);
        const b = pumpCost(id, lv + 1);
        const inc = springIncome(stateWith({ pumps: { [id]: lv } }), id);
        return b.gt(a) && isHealthy(a) && isHealthy(b) && isHealthy(inc) && inc.gt(0);
      }),
      { numRuns: 300 },
    );
    const s = stateWith({ coins: '1e300', pumps: { simple: PARAMS.levelMax } });
    expect(buyQuote(s, 'pump:simple', 1).state).toBe('maxed');
    expect(dispatch(s, { type: 'buy', item: 'pump:simple', qty: 1 }).reason).toBe('maxed');
  });

  it('入湯料はポンプの Lv に対して減らない（fast-check）', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SPRING_IDS), fc.integer({ min: 1, max: 5000 }), (id, lv) => {
        const a = bathIncomePerSec(stateWith({ bath: 35, pumps: { [id]: lv } }));
        const b = bathIncomePerSec(stateWith({ bath: 35, pumps: { [id]: lv + 1 } }));
        return b.gte(a) && b.gt(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('TS-015-13・14 保存の往復・刻み幅', () => {
  it('TS-015-13 源泉 3 種（Lv 12・3・1、枠に 2 種）: 保存 → 読み込みで入湯料・Lv・枠・図鑑・お客さんが同じ', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 12, co2: 3, salt: 1 } });
    s.collection.springsSeen = ['simple', 'co2', 'salt'];
    const r = decodeSave(encodeSave(s, 1, 1_700_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(t.run.springs).toEqual(s.run.springs);
    expect(t.run.bath).toEqual(s.run.bath);
    expect(t.collection.springsSeen).toEqual(s.collection.springsSeen);
    expect(t.run.guests).toEqual(s.run.guests);
    expect(bathIncomePerSec(t).toString()).toBe(bathIncomePerSec(s).toString());
    expect(stateHash(t)).toBe(stateHash(s));
  });

  it('TS-015-14 源泉 2 種をつないで操作なしで 1 時間: 0.1 秒刻みと 1 秒刻みのコインの差が 1% 以内', () => {
    const base = stateWith({ bath: 5, pumps: { simple: 30, co2: 12 } });
    const a = cloneState(base);
    const b = cloneState(base);
    advance(a, 3_600_000, 100);
    advance(b, 3_600_000, 1000);
    expect(rel(a.run.coins.toNumber(), b.run.coins.toNumber())).toBeLessThan(0.01);
    expect(a.run.coins.gt(0)).toBe(true);
  });
});

describe('springViews（湯宿タブ T2 用）', () => {
  it('5 種すべてを定義の順に返す（未発見は found: false・Lv0・枠なし・次のマイルストーン 10・入湯料 0）', () => {
    const v = springViews(createInitialState(1));
    expect(v.map((x) => x.id)).toEqual(SPRING_IDS);
    for (const x of v) {
      expect(x).toMatchObject({ found: false, pump: 0, slot: null, nextMilestone: 10, depth: SPRING_BY_ID[x.id].depth });
      expect(x.incomePerSec.eq(0) && x.potentialPerSec.eq(0)).toBe(true);
      expect(x.effect).toEqual(SPRING_BY_ID[x.id].effect);
    }
  });
});
