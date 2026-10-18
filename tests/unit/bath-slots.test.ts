// BL-016: 湯船のレベル・枠 4・無料の入れ替え・泉質の効果、倍率を集める場所（TS-016-01〜18。gdd §5-4・§5-5、arch §6-2、確認事項 #6・Q-31）
// TS-016-19（標準ボットの #6）は BL-033 の目標表の判定（それまでは npm run sim のレポート）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fcRuns } from '../helpers/fc-runs.ts';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, SPRING_BY_ID } from '../../src/content/springs.ts';
import { UPGRADE_BY_ID } from '../../src/content/upgrades.ts';
import type { Effect } from '../../src/content/effects.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import {
  advance,
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
  num,
  offlineEfficiency,
  slotsForBathLevel,
  springViews,
  stateHash,
  upgradeEffect,
  type GameEvent,
} from '../../src/core/index.ts';
import { SPRING_IDS, stateWith } from '../support/states.ts';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const slotEvents = (evs: readonly GameEvent[]): number[] =>
  evs.filter((e): e is Extract<GameEvent, { type: 'SlotUnlocked' }> => e.type === 'SlotUnlocked').map((e) => e.n);

describe('TS-016-01・02 湯船のコストは 150×1.25^Lv、1 Lv ごとに入湯料の合計 +5%（足し算）', () => {
  it('TS-016-01 コスト: Lv0 150・1 187.5・4 366.2109375・5 457.763671875・14 3,410.605…・15 4,263.256…・34 295,822.84…・35 369,778.55…', () => {
    const ref: [number, number][] = [
      [0, 150],
      [1, 187.5],
      [4, 366.2109375],
      [5, 457.763671875],
      [14, 3410.6051],
      [15, 4263.2564],
      [34, 295822.84],
      [35, 369778.55],
    ];
    for (const [lv, v] of ref) {
      expect(rel(bathCost(lv).toNumber(), 150 * 1.25 ** lv)).toBeLessThan(1e-9);
      expect(rel(bathCost(lv).toNumber(), v)).toBeLessThan(1e-6);
    }
  });

  it('TS-016-02 入湯料: 単純温泉 Lv1 だけで湯船 Lv1 は ×1.05、Lv20 は ×2.0（1.05^20 ではない）', () => {
    const one = (bath: number): number => bathIncomePerSec(stateWith({ bath, pumps: { simple: 1 } })).toNumber();
    expect(rel(one(1), one(0) * 1.05)).toBeLessThan(1e-12);
    expect(rel(one(20), one(0) * 2)).toBeLessThan(1e-12);
    const base = bathIncomePerSec(stateWith({ bath: 0, pumps: { simple: 10 } })).toNumber();
    for (const lv of [1, 2, 4]) {
      expect(rel(bathIncomePerSec(stateWith({ bath: lv, pumps: { simple: 10 } })).toNumber(), base * (1 + 0.05 * lv))).toBeLessThan(1e-12);
    }
    expect(bathView(stateWith({ bath: 7 })).bonusPct).toBe(35);
  });

  it('TS-016-01 湯船を買うとコインが表示のコストだけ減り、Lv が上がる（買えないときは状態が変わらない）', () => {
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

describe('TS-016-03・04 湯船の Lv0・5・15・35 で枠が 1・2・3・4、SlotUnlocked を出す。最初の源泉の湯船は無料', () => {
  it('TS-016-03 slotsForBathLevel・nextSlotLevel の境界', () => {
    expect([0, 4, 5, 14, 15, 34, 35, 100, 1_000_000].map(slotsForBathLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4]);
    expect([0, 4, 5, 14, 15, 34, 35, 1000].map(nextSlotLevel)).toEqual([5, 5, 15, 15, 35, 35, null, null]);
    expect(PARAMS.bath.slotsAtLevel).toEqual([0, 5, 15, 35]);
  });

  it('TS-016-04 1 つずつ買うと、Lv5・15・35 に届いたときにだけ SlotUnlocked{n: 2・3・4} が出て、空きの枠が足される', () => {
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

  it('TS-016-04 Lv4 から ×10（Lv14）は n=2 だけ。Lv0 から最大は n=2・3・4 の順（4 枠で止まる。既存の枠の中身は変わらない）', () => {
    const t = stateWith({ coins: '1e30', bath: 4, pumps: { simple: 1 } });
    const r10 = dispatch(t, { type: 'buy', item: 'bath', qty: 10 });
    expect(t.run.bath.level).toBe(14);
    expect(slotEvents(r10.events)).toEqual([2]);
    expect(t.run.bath.slots).toEqual(['simple', null]);
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

describe('TS-016-05〜09・16 入れ替えは無料・いつでも、ポンプの Lv は源泉に残る。1 つの源泉は 1 つの枠だけ（確認事項 #6）', () => {
  it('TS-016-05 空きの枠へつなぐ・外す・別の源泉に替える。コインは変わらず、ポンプの Lv も変わらない', () => {
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

  it('TS-016-06・07 別の枠につないである源泉を指定すると、2 つの枠の中身が入れ替わる（重ねてつながない。空きとも入れ替わる）', () => {
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

  it('TS-016-09 範囲外の枠は noSlot、未発見の源泉は notFound、形の壊れた入力は invalid。どれも状態は変わらない', () => {
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

  it('TS-016-08 性質: どんな入れ替えの列の後も、枠の数は変わらず、同じ源泉は 2 つの枠になく、つないだ源泉はすべて発見済み（fast-check）', () => {
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
      fcRuns(300),
    );
  });
});

describe('TS-016-10〜16 泉質の効果は枠につないでいる間だけ効く', () => {
  /** 源泉 id を発見済み（Lv1）にして枠 1 につないだ状態と、つながない状態 */
  const pair = (id: (typeof SPRING_IDS)[number], spec: Parameters<typeof stateWith>[0] = {}) => {
    const on = stateWith({ ...spec, bath: 0, pumps: { [id]: 1 } });
    const off = stateWith({ ...spec, bath: 0, pumps: { [id]: 1 } });
    dispatch(off, { type: 'assignSlot', slot: 0, spring: null });
    return { on, off };
  };

  it('TS-016-10 単純温泉: 全入湯料 ×1.2（ほかの源泉の入湯料にも掛かる。タヌキは残る）', () => {
    const with2 = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } }); // simple・co2 をつなぐ
    const without = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } });
    dispatch(without, { type: 'assignSlot', slot: 0, spring: null });
    expect(modifiers(with2).incomeAll / modifiers(without).incomeAll).toBeCloseTo(1.2, 12);
    const co2Only = 30 * 10 * 2 * (1 + 0.05 * 5) * 1.5; // タヌキはどちらにもいる
    expect(rel(bathIncomePerSec(without).toNumber(), co2Only)).toBeLessThan(1e-12);
    expect(rel(bathIncomePerSec(with2).toNumber(), (co2Only + 1 * (1 + 0.05 * 5) * 1.5) * 1.2)).toBeLessThan(1e-12);
  });

  it('TS-016-11 二酸化炭素泉: ドリル威力 ×1.5', () => {
    const { on, off } = pair('co2', { drill: 10 });
    expect(rel(drillPower(on).toNumber(), drillPower(off).toNumber() * 1.5)).toBeLessThan(1e-12);
  });

  it('TS-016-14 塩化物泉: オフライン効率 +25%（足し算で 50% → 75%。上限 100%。Q-31 (c)）', () => {
    const { on, off } = pair('salt');
    expect(offlineEfficiency(off)).toBe(0.5);
    expect(offlineEfficiency(on)).toBe(0.75);
    expect(bathView(on).offlineEfficiency).toBe(0.75);
    const m = baseModifiers();
    applyEffect(m, { kind: 'offlineEff', add: 0.25 });
    applyEffect(m, { kind: 'offlineEff', add: 0.5 });
    expect(offlineEfficiency(off, m)).toBe(1);
  });

  it('TS-016-12 硫黄泉: 鉱石の価値 ×2（鉱石でないブロックの価値は変わらない）', () => {
    const { on, off } = pair('sulfur');
    expect(rel(blockValue(on, 260, true).toNumber(), blockValue(off, 260, true).toNumber() * 2)).toBeLessThan(1e-12);
    expect(blockValue(on, 260, false).toString()).toBe(blockValue(off, 260, false).toString());
  });

  it('TS-016-13 含鉄泉: 地層の硬さ ×0.8（ブロックの HP）', () => {
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

  it('TS-016-15 単純温泉 ×1.2 とタヌキ ×1.5、二酸化炭素泉 ×1.5 とニホンザル ×2 が掛け算で重なる（全入湯料 ×1.8・威力 ×3）', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } });
    expect(s.run.guests).toEqual(['tanuki', 'monkey']);
    const m = modifiers(s);
    expect(m.incomeAll).toBeCloseTo(1.8, 12);
    expect(m.drillPower).toBeCloseTo(3, 12);
  });

  it('TS-016-16 入れ替えた直後の step から新しい倍率で入湯料が入る（前の構成の倍率が残らない）', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 3 } });
    const before = s.run.coins;
    dispatch(s, { type: 'assignSlot', slot: 0, spring: null }); // 単純温泉を外す（×1.2 が消える）
    const expected = bathIncomePerSec(s).toNumber() * 0.1;
    advance(s, 100);
    expect(rel(s.run.coins.sub(before).toNumber(), expected)).toBeLessThan(1e-9);
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

  it('改良の口 upgradeEffect: 知っている ID は定義の効果、知らない ID（後半の grip・prototype の名前）は効果なし・例外なし（BL-018）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 5 } });
    const m = modifiers(s);
    s.run.upgrades = ['grip', '__proto__', 'constructor'] as unknown as typeof s.run.upgrades;
    expect(upgradeEffect('noren')).toEqual(UPGRADE_BY_ID.noren.effect);
    expect(UPGRADE_BY_ID.noren.effect.kind).toBe('incomeAll');
    expect(upgradeEffect('grip' as 'noren')).toBeUndefined();
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
      fcRuns(200),
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

  it('性質: 枠ごとの入湯料の合計＝入湯料/秒、springViews の同じ源泉の値と一致（湯船の Lv・並び・湯の華を動かす。fast-check。レビュー PR #10 S-1）', () => {
    const lv = fc.integer({ min: 0, max: 200 });
    fc.assert(
      fc.property(
        fc.tuple(lv, lv, lv, lv, lv),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.array(fc.record({ slot: fc.integer({ min: 0, max: 3 }), spring: fc.constantFrom(null, ...SPRING_IDS) }), { maxLength: 8 }),
        (lvs, bath, yunohana, acts) => {
          const s = stateWith({ bath, pumps: Object.fromEntries(SPRING_IDS.map((id, i) => [id, lvs[i] ?? 0])) });
          s.meta.yunohana.lifetime = num(yunohana);
          for (const a of acts) dispatch(s, { type: 'assignSlot', ...a });
          const v = bathView(s);
          const sum = v.slots.reduce((a, x) => a + x.incomePerSec.toNumber(), 0);
          const total = bathIncomePerSec(s).toNumber();
          const sv = springViews(s);
          const same = v.slots.every((x) => x.spring === null || sv.find((y) => y.id === x.spring)?.incomePerSec.eq(x.incomePerSec));
          return same && (total === 0 ? sum === 0 : rel(sum, total) < 1e-9);
        },
      ),
      fcRuns(200),
    );
  });

  it('湯船の購入ボタンは今までどおり buyQuote(s, "bath", qty)', () => {
    const q = buyQuote(stateWith({ coins: 150, bath: 0 }), 'bath', 1);
    expect(q).toMatchObject({ state: 'affordable', n: 1, level: 0 });
  });
});

describe('TS-016-17・18 最初の源泉の前の湯船・保存の往復', () => {
  it('TS-016-17 最初の源泉の前でも湯船を買える（ok・Lv1・入湯料 0。Q-31 (f)）', () => {
    const s = stateWith({ coins: 1000 });
    const r = dispatch(s, { type: 'buy', item: 'bath', qty: 1 });
    expect(r.ok).toBe(true);
    expect(s.run.bath.level).toBe(1);
    expect(bathIncomePerSec(s).toNumber()).toBe(0);
  });

  it('TS-016-18 枠 3 つにつないだ湯船 Lv15: 保存 → 読み込みで枠の中身と順番・Lv・効果が同じ', () => {
    const s = stateWith({ bath: 15, pumps: { simple: 4, co2: 12, salt: 2 } });
    dispatch(s, { type: 'assignSlot', slot: 0, spring: 'salt' });
    const r = decodeSave(encodeSave(s, 1, 1_700_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.run.bath).toEqual({ level: 15, slots: ['salt', 'co2', 'simple'] });
    expect(modifiers(r.state)).toEqual(modifiers(s));
    expect(offlineEfficiency(r.state)).toBe(0.75);
  });
});
