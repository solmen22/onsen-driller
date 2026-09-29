// BL-016: 湯船のレベル・枠 4・無料の入れ替え・泉質の効果、倍率を集める場所（gdd §5-4・§5-5、arch §6-2、確認事項 #6）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, SPRING_BY_ID } from '../../src/content/springs.ts';
import type { Effect } from '../../src/content/effects.ts';
import {
  applyEffect,
  baseModifiers,
  bathCost,
  bathIncomePerSec,
  bathView,
  blockHp,
  blockValue,
  buyQuote,
  contentProblems,
  createInitialState,
  dispatch,
  drillPower,
  effectProblems,
  modifiers,
  nextSlotLevel,
  offlineEfficiency,
  slotsForBathLevel,
  stateHash,
  upgradeEffect,
  type GameEvent,
} from '../../src/core/index.ts';
import { SPRING_IDS, stateWith } from '../support/states.ts';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const slotEvents = (evs: readonly GameEvent[]): number[] =>
  evs.filter((e): e is Extract<GameEvent, { type: 'SlotUnlocked' }> => e.type === 'SlotUnlocked').map((e) => e.n);

describe('BL-016 AC1 湯船のコストは 150×1.25^Lv、1 Lv ごとに入湯料の合計 +5%', () => {
  it('コスト: Lv0 150・Lv1 187.5・Lv5・Lv35 が式と相対誤差 1e-9', () => {
    for (const lv of [0, 1, 5, 15, 35, 80]) expect(rel(bathCost(lv).toNumber(), 150 * 1.25 ** lv)).toBeLessThan(1e-9);
    expect(bathCost(0).toNumber()).toBe(150);
    expect(bathCost(1).toNumber()).toBe(187.5);
  });

  it('入湯料: Lv L の湯船は Lv0 の (1＋0.05×L) 倍（枠の数が同じ範囲で比べる）', () => {
    const base = bathIncomePerSec(stateWith({ bath: 0, pumps: { simple: 10 } })).toNumber();
    for (const lv of [1, 2, 4]) {
      expect(rel(bathIncomePerSec(stateWith({ bath: lv, pumps: { simple: 10 } })).toNumber(), base * (1 + 0.05 * lv))).toBeLessThan(1e-12);
    }
    expect(bathView(stateWith({ bath: 7 })).bonusPct).toBe(35);
  });

  it('湯船を買うとコインが表示のコストだけ減り、Lv が上がる（買えないときは状態が変わらない）', () => {
    const s = stateWith({ coins: 150, bath: 0 });
    const h = stateHash(stateWith({ coins: 149, bath: 0 }));
    const poor = stateWith({ coins: 149, bath: 0 });
    expect(dispatch(poor, { type: 'buy', item: 'bath', qty: 1 })).toEqual({ ok: false, reason: 'insufficient', events: [] });
    expect(stateHash(poor)).toBe(h);
    expect(dispatch(s, { type: 'buy', item: 'bath', qty: 1 }).ok).toBe(true);
    expect(s.run.bath.level).toBe(1);
    expect(s.run.coins.toNumber()).toBe(0);
  });
});

describe('BL-016 AC2 湯船の Lv0・5・15・35 で枠が 1・2・3・4、SlotUnlocked を出す。最初の源泉の湯船は無料', () => {
  it('slotsForBathLevel・nextSlotLevel の境界', () => {
    expect([0, 4, 5, 14, 15, 34, 35, 100, 1_000_000].map(slotsForBathLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4]);
    expect([0, 4, 5, 14, 15, 34, 35, 1000].map(nextSlotLevel)).toEqual([5, 5, 15, 15, 35, 35, null, null]);
    expect(PARAMS.bath.slotsAtLevel).toEqual([0, 5, 15, 35]);
  });

  it('1 つずつ買うと、Lv5・15・35 に届いたときにだけ SlotUnlocked{n: 2・3・4} が出て、空きの枠が足される', () => {
    const s = stateWith({ coins: '1e30', bath: 0, pumps: { simple: 1 } });
    const seen: [number, number[]][] = [];
    for (let i = 0; i < 40; i++) {
      const r = dispatch(s, { type: 'buy', item: 'bath', qty: 1 });
      expect(r.ok).toBe(true);
      const n = slotEvents(r.events);
      if (n.length > 0) seen.push([s.run.bath.level, n]);
    }
    expect(seen).toEqual([
      [5, [2]],
      [15, [3]],
      [35, [4]],
    ]);
    expect(s.run.bath.slots).toEqual(['simple', null, null, null]);
  });

  it('×10・最大でまとめて越えたときは、越えた枠の数だけ順に SlotUnlocked を出す（4 枠で止まる）', () => {
    const s = stateWith({ coins: '1e30', bath: 0 });
    const r = dispatch(s, { type: 'buy', item: 'bath', qty: 'max' });
    expect(r.ok).toBe(true);
    expect(slotEvents(r.events)).toEqual([2, 3, 4]);
    expect(s.run.bath.slots).toHaveLength(4);
    const again = dispatch(s, { type: 'buy', item: 'bath', qty: 10 });
    expect(slotEvents(again.events)).toEqual([]);
    expect(s.run.bath.slots).toHaveLength(4);
  });

  it('新しいゲームは湯船 Lv0 で枠 1 つ（空き）。最初の源泉を見つけると代金なしでその枠につながる', () => {
    const s = createInitialState(5);
    expect(s.run.bath).toEqual({ level: 0, slots: [null] });
    s.run.depth = 29;
    s.run.maxDepth = 29;
    s.run.drill.level = 5000;
    dispatch(s, { type: 'tap' });
    expect(s.run.bath).toEqual({ level: 0, slots: ['simple'] });
    expect(bathIncomePerSec(s).gt(0)).toBe(true);
  });
});

describe('BL-016 AC3 入れ替えは無料・いつでも、ポンプの Lv は源泉に残る。1 つの源泉は 1 つの枠だけ（確認事項 #6）', () => {
  it('空きの枠へつなぐ・外す・別の源泉に替える。コインは変わらず、ポンプの Lv も変わらない', () => {
    const s = stateWith({ coins: 1234, bath: 15, pumps: { simple: 12, co2: 30, salt: 7 } });
    expect(s.run.bath.slots).toEqual(['simple', 'co2', 'salt']);
    const coins = s.run.coins.toString();
    expect(dispatch(s, { type: 'assignSlot', slot: 2, spring: null }).ok).toBe(true);
    expect(s.run.bath.slots).toEqual(['simple', 'co2', null]);
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: 'salt' }).ok).toBe(true);
    expect(s.run.bath.slots).toEqual(['salt', 'co2', null]);
    expect(s.run.coins.toString()).toBe(coins);
    expect(s.run.springs).toEqual({ simple: { pump: 12 }, co2: { pump: 30 }, salt: { pump: 7 } });
  });

  it('別の枠につないである源泉を指定すると、2 つの枠の中身が入れ替わる（重ねてつながない）', () => {
    const s = stateWith({ bath: 15, pumps: { simple: 1, co2: 1, salt: 1 } });
    expect(dispatch(s, { type: 'assignSlot', slot: 2, spring: 'simple' }).ok).toBe(true);
    expect(s.run.bath.slots).toEqual(['salt', 'co2', 'simple']);
    s.run.bath.slots[1] = null;
    expect(dispatch(s, { type: 'assignSlot', slot: 1, spring: 'salt' }).ok).toBe(true);
    expect(s.run.bath.slots).toEqual([null, 'salt', 'simple']);
    // 同じ枠に同じ源泉は何も変えない
    const h = stateHash(s);
    expect(dispatch(s, { type: 'assignSlot', slot: 1, spring: 'salt' })).toEqual({ ok: true, events: [] });
    expect(stateHash(s)).toBe(h);
  });

  it('幕間の間でも入れ替えられる（いつでも）', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 1 } });
    s.run.interludeMs = 1000;
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: 'co2' }).ok).toBe(true);
    expect(s.run.bath.slots).toEqual(['co2', 'simple']);
  });

  it('範囲外の枠は noSlot、未発見の源泉は notFound、形の壊れた入力は invalid。どれも状態は変わらない', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1 } });
    const h = stateHash(s);
    expect(dispatch(s, { type: 'assignSlot', slot: 2, spring: 'simple' }).reason).toBe('noSlot');
    expect(dispatch(s, { type: 'assignSlot', slot: -1, spring: null }).reason).toBe('noSlot');
    expect(dispatch(s, { type: 'assignSlot', slot: 1, spring: 'iron' }).reason).toBe('notFound');
    for (const bad of [
      { type: 'assignSlot', slot: 0.5, spring: 'simple' },
      { type: 'assignSlot', slot: '0', spring: 'simple' },
      { type: 'assignSlot', slot: 0, spring: 'legend' },
      { type: 'assignSlot', slot: 0, spring: '__proto__' },
      { type: 'assignSlot', slot: 0 },
    ]) {
      expect(dispatch(s, bad).reason).toBe('invalid');
    }
    expect(stateHash(s)).toBe(h);
  });

  it('性質: どんな入れ替えの列の後も、枠の数は変わらず、同じ源泉は 2 つの枠になく、つないだ源泉はすべて発見済み（fast-check）', () => {
    const act = fc.record({ slot: fc.integer({ min: -1, max: 4 }), spring: fc.constantFrom(null, ...SPRING_IDS) });
    fc.assert(
      fc.property(fc.array(act, { maxLength: 40 }), fc.integer({ min: 0, max: 40 }), (acts, bath) => {
        const s = stateWith({ bath, pumps: { simple: 3, co2: 2, salt: 1, sulfur: 4 } });
        const n = s.run.bath.slots.length;
        const coins = s.run.coins.toString();
        for (const a of acts) dispatch(s, { type: 'assignSlot', ...a });
        const ids = s.run.bath.slots.filter((x) => x !== null);
        return (
          s.run.bath.slots.length === n &&
          new Set(ids).size === ids.length &&
          ids.every((id) => s.run.springs[id] !== undefined) &&
          s.run.coins.toString() === coins &&
          s.run.springs.co2?.pump === 2
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('BL-016 AC4 泉質の効果は枠につないでいる間だけ効く', () => {
  /** 源泉 id を発見済み（Lv1）にして枠 1 につないだ状態と、つながない状態 */
  const pair = (id: (typeof SPRING_IDS)[number], spec: Parameters<typeof stateWith>[0] = {}) => {
    const on = stateWith({ ...spec, bath: 0, pumps: { [id]: 1 } });
    const off = stateWith({ ...spec, bath: 0, pumps: { [id]: 1 } });
    dispatch(off, { type: 'assignSlot', slot: 0, spring: null });
    return { on, off };
  };

  it('単純温泉: 全入湯料 ×1.2（ほかの源泉の入湯料にも掛かる）', () => {
    const with2 = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } }); // simple・co2 をつなぐ
    const without = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } });
    dispatch(without, { type: 'assignSlot', slot: 0, spring: null });
    expect(modifiers(with2).incomeAll / modifiers(without).incomeAll).toBeCloseTo(1.2, 12);
    const co2Only = 30 * 10 * 2 * (1 + 0.05 * 5) * 1.5; // タヌキはどちらにもいる
    expect(rel(bathIncomePerSec(without).toNumber(), co2Only)).toBeLessThan(1e-12);
    expect(rel(bathIncomePerSec(with2).toNumber(), (co2Only + 1 * (1 + 0.05 * 5) * 1.5) * 1.2)).toBeLessThan(1e-12);
  });

  it('二酸化炭素泉: ドリル威力 ×1.5', () => {
    const { on, off } = pair('co2', { drill: 10 });
    expect(rel(drillPower(on).toNumber(), drillPower(off).toNumber() * 1.5)).toBeLessThan(1e-12);
  });

  it('塩化物泉: オフライン効率 +25%（50% → 75%）。上限は 100%', () => {
    const { on, off } = pair('salt');
    expect(offlineEfficiency(off)).toBe(0.5);
    expect(offlineEfficiency(on)).toBe(0.75);
    expect(bathView(on).offlineEfficiency).toBe(0.75);
    const m = baseModifiers();
    applyEffect(m, { kind: 'offlineEff', add: 0.25 });
    applyEffect(m, { kind: 'offlineEff', add: 0.5 });
    expect(offlineEfficiency(off, m)).toBe(1);
  });

  it('硫黄泉: 鉱石の価値 ×2（鉱石でないブロックの価値は変わらない）', () => {
    const { on, off } = pair('sulfur');
    expect(rel(blockValue(on, 260, true).toNumber(), blockValue(off, 260, true).toNumber() * 2)).toBeLessThan(1e-12);
    expect(blockValue(on, 260, false).toString()).toBe(blockValue(off, 260, false).toString());
  });

  it('含鉄泉: 地層の硬さ ×0.8（ブロックの HP）', () => {
    const { on, off } = pair('iron');
    expect(rel(blockHp(on, 410).toNumber(), blockHp(off, 410).toNumber() * 0.8)).toBeLessThan(1e-12);
  });

  it('外すと効果が消え、つなぎ直すと戻る（5 種とも。倍率の初期値に戻る）', () => {
    for (const sp of SPRINGS) {
      const { on, off } = pair(sp.id);
      const base = baseModifiers();
      const mOff = modifiers(off);
      expect({ ...mOff, springIncome: base.springIncome }).toEqual(base); // 何もつながず、お客さんもいない
      const mOn = modifiers(on);
      expect(mOn).not.toEqual(base);
      dispatch(on, { type: 'assignSlot', slot: 0, spring: null });
      expect(modifiers(on)).toEqual(mOff);
    }
  });
});

describe('BL-016 倍率を集める場所（改良の口）', () => {
  it('applyEffect: 倍率は掛け算、足し算は足す。源泉ごとの倍率はその源泉だけ', () => {
    const m = baseModifiers();
    const effects: Effect[] = [
      { kind: 'incomeAll', mult: 1.5 },
      { kind: 'incomeAll', mult: 2 },
      { kind: 'springIncome', spring: 'co2', mult: 3 },
      { kind: 'drillPower', mult: 2 },
      { kind: 'autoDig', mult: 2 },
      { kind: 'oreValue', mult: 3 },
      { kind: 'hardness', mult: 0.8 },
      { kind: 'digCoins', mult: 1.5 },
      { kind: 'offlineEff', add: 0.25 },
    ];
    for (const e of effects) applyEffect(m, e);
    expect(m).toEqual({
      incomeAll: 3,
      springIncome: { simple: 1, co2: 3, salt: 1, sulfur: 1, iron: 1 },
      drillPower: 2,
      autoDig: 2,
      oreValue: 3,
      hardness: 0.8,
      digCoins: 1.5,
      offlineEff: 0.25,
    });
  });

  it('源泉ごとの倍率は、その源泉の入湯料にだけ掛かる（カピバラ → 塩化物泉 ×2 と同じ道）', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } });
    const m = modifiers(s);
    const before = bathIncomePerSec(s, m).toNumber();
    applyEffect(m, { kind: 'springIncome', spring: 'co2', mult: 3 });
    const scale = (1 + 0.05 * 5) * 1.2 * 1.5;
    expect(rel(bathIncomePerSec(s, m).toNumber() - before, 30 * 10 * 2 * 2 * scale)).toBeLessThan(1e-9);
  });

  it('改良の口 upgradeEffect は BL-018 まで何も返さない（知らない ID を持つセーブでも効果なし・例外なし）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 5 } });
    const m = modifiers(s);
    s.run.upgrades = ['grip', 'noren', '__proto__', 'constructor'];
    expect(upgradeEffect('noren')).toBeUndefined();
    expect(modifiers(s)).toEqual(m);
  });

  it('effectProblems: 倍率が正の有限の数でない・足し算が有限でない・源泉がない効果を見つける', () => {
    expect(effectProblems('x', { kind: 'incomeAll', mult: 1.5 })).toEqual([]);
    expect(effectProblems('x', { kind: 'incomeAll', mult: 0 })).toHaveLength(1);
    expect(effectProblems('x', { kind: 'drillPower', mult: Number.NaN })).toHaveLength(1);
    expect(effectProblems('x', { kind: 'offlineEff', add: Infinity })).toHaveLength(1);
    expect(effectProblems('x', { kind: 'springIncome', spring: 'legend' as never, mult: 2 })).toHaveLength(1);
    expect(contentProblems()).toEqual([]);
  });

  it('性質: 効果を掛ける順番を入れ替えても倍率は同じ（fast-check。浮動小数の丸めの範囲）', () => {
    const eff: fc.Arbitrary<Effect> = fc.oneof(
      fc.record({ kind: fc.constant('incomeAll' as const), mult: fc.double({ min: 0.5, max: 4, noNaN: true }) }),
      fc.record({ kind: fc.constant('drillPower' as const), mult: fc.double({ min: 0.5, max: 4, noNaN: true }) }),
      fc.record({ kind: fc.constant('springIncome' as const), spring: fc.constantFrom(...SPRING_IDS), mult: fc.double({ min: 0.5, max: 4, noNaN: true }) }),
      fc.record({ kind: fc.constant('offlineEff' as const), add: fc.double({ min: 0, max: 0.5, noNaN: true }) }),
    );
    fc.assert(
      fc.property(fc.array(eff, { maxLength: 12 }), (es) => {
        const a = baseModifiers();
        const b = baseModifiers();
        for (const e of es) applyEffect(a, e);
        for (const e of [...es].reverse()) applyEffect(b, e);
        const close = (x: number, y: number): boolean => rel(x, y) < 1e-12 || Math.abs(x - y) < 1e-15;
        return (
          close(a.incomeAll, b.incomeAll) &&
          close(a.drillPower, b.drillPower) &&
          close(a.offlineEff, b.offlineEff) &&
          SPRING_IDS.every((id) => close(a.springIncome[id], b.springIncome[id]))
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe('BL-016 bathView（湯宿タブ T2 の湯船の枠）', () => {
  it('枠ごとの源泉・入湯料・効果、次の枠の Lv、枠の最大', () => {
    const s = stateWith({ bath: 15, pumps: { simple: 10, co2: 3 } });
    const v = bathView(s);
    expect(v).toMatchObject({ level: 15, slotCount: 3, maxSlots: 4, nextSlotLevel: 35, bonusPct: 75, offlineEfficiency: 0.5 });
    expect(v.slots.map((x) => [x.slot, x.spring, x.effect])).toEqual([
      [0, 'simple', SPRING_BY_ID.simple.effect],
      [1, 'co2', SPRING_BY_ID.co2.effect],
      [2, null, null],
    ]);
    const sum = v.slots.reduce((a, x) => a + x.incomePerSec.toNumber(), 0);
    expect(rel(sum, bathIncomePerSec(s).toNumber())).toBeLessThan(1e-9);
    expect(v.slots[2]?.incomePerSec.toNumber()).toBe(0);
  });

  it('湯船の購入ボタンは今までどおり buyQuote(s, "bath", qty)', () => {
    const q = buyQuote(stateWith({ coins: 150, bath: 0 }), 'bath', 1);
    expect(q).toMatchObject({ state: 'affordable', n: 1, level: 0 });
  });
});
