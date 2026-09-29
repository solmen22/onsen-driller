// BL-015: 源泉 5 種とポンプ（gdd §5-4・arch §6-2）。発見・無料のポンプ Lv1・入湯料の式・マイルストーン・コスト・つないでいない源泉は 0
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../../src/content/springs.ts';
import {
  bathIncomePerSec,
  buyQuote,
  contentProblems,
  createInitialState,
  dispatch,
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
} from '../../src/core/index.ts';
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

describe('BL-015 AC1 深さに届くと源泉を発見し、ポンプ Lv1 が無料で付く（山あい）', () => {
  const table: [SpringId, number][] = [
    ['simple', 30],
    ['co2', 80],
    ['salt', 150],
    ['sulfur', 250],
    ['iron', 400],
  ];

  it('定義の深さは 30・80・150・250・400m（gdd §5-4）で、500m は伝説の源泉（BL-023）なので今は源泉なし', () => {
    expect(SPRINGS.map((sp) => [sp.id, sp.depth])).toEqual(table);
    expect(springAtDepth(500)).toBeNull();
    for (const d of [0, 29, 31, 79, 81, 149, 151, 249, 251, 399, 401]) expect(springAtDepth(d)).toBeNull();
  });

  it.each(table)('%s: %im に届いた時点で SpringFound{spring, depth}・ポンプ Lv1・図鑑に記録。ポンプの代金は取らない', (id, depth) => {
    // 前の源泉はすべて発見済みで、枠は 4 つ（最後の 1 つは空き）
    const before = SPRINGS.filter((sp) => sp.depth < depth).map((sp) => sp.id);
    const s = stateWith({ bath: 35, pumps: Object.fromEntries(before.map((b) => [b, 1])) });
    const coinsBefore = s.run.coins;
    const ev = reach(s, depth);
    const found = ev.filter((e) => e.type === 'SpringFound');
    expect(found).toEqual([{ type: 'SpringFound', spring: id, depth }]);
    expect(s.run.springs[id]).toEqual({ pump: 1 });
    expect(s.collection.springsSeen).toContain(id);
    // 増えたコインは壊したブロックの分だけ（ポンプは無料）
    const broken = ev.filter((e): e is Extract<GameEvent, { type: 'BlockBroken' }> => e.type === 'BlockBroken');
    const gained = broken.reduce((a, e) => a.add(num(e.coins)), num(0));
    expect(rel(s.run.coins.toNumber(), coinsBefore.add(gained).toNumber())).toBeLessThan(1e-12);
  });

  it('イベントの順番: BlockBroken → StratumEntered → SpringFound → GuestArrived（30m・単純温泉・タヌキ）', () => {
    const s = createInitialState(1);
    const ev = reach(s, 30);
    expect(ev.map((e) => e.type)).toEqual(['BlockBroken', 'StratumEntered', 'SpringFound', 'GuestArrived']);
    expect(ev[3]).toEqual({ type: 'GuestArrived', guest: 'tanuki', first: true });
  });

  it('発見した源泉は空いている最初の枠につながる（最初の源泉は枠 1 の無料の湯船に）', () => {
    const s = createInitialState(1);
    reach(s, 30);
    expect(s.run.bath.slots).toEqual(['simple']);
    const t = stateWith({ bath: 5, pumps: { simple: 3 } }); // 枠 2 つ・2 つ目は空き
    expect(t.run.bath.slots).toEqual(['simple', null]);
    reach(t, 80);
    expect(t.run.bath.slots).toEqual(['simple', 'co2']);
  });

  it('空いている枠がなければ、発見しても枠にはつながらない（入湯料は変わらない。入れ替えは assignSlot で）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 12 } });
    expect(s.run.bath.slots).toEqual(['simple']);
    const incomeBefore = bathIncomePerSec(s).toNumber();
    const ev = reach(s, 80);
    expect(ev.some((e) => e.type === 'SpringFound' && e.spring === 'co2')).toBe(true);
    expect(s.run.springs.co2).toEqual({ pump: 1 });
    expect(s.run.bath.slots).toEqual(['simple']);
    expect(bathIncomePerSec(s).toNumber()).toBe(incomeBefore);
  });

  it('転生の後の周回でも同じ深さで発見し直す（図鑑の記録は重複しない）', () => {
    const s = createInitialState(3);
    reach(s, 30);
    s.run.maxDepth = 150; // 湯の華が得られる深さ
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.run.springs).toEqual({});
    const ev = reach(s, 30);
    expect(ev.filter((e) => e.type === 'SpringFound')).toHaveLength(1);
    expect(s.collection.springsSeen).toEqual(['simple']);
  });

  it('未発見の源泉のポンプは買えない（locked・解放の深さ＝発見の深さ）', () => {
    const s = stateWith({ coins: '1e30', pumps: { simple: 1 } });
    for (const sp of SPRINGS.filter((x) => x.id !== 'simple')) {
      const q = buyQuote(s, `pump:${sp.id}`, 1);
      expect(q.state).toBe('locked');
      expect(q.unlockDepth).toBe(sp.depth);
      const h = stateHash(s);
      expect(dispatch(s, { type: 'buy', item: `pump:${sp.id}`, qty: 1 })).toEqual({ ok: false, reason: 'locked', events: [] });
      expect(stateHash(s)).toBe(h);
    }
  });
});

describe('BL-015 AC2 入湯料/秒＝基本湧出×Lv×マイルストーン×湯船×お客さん×泉質×転生の倍率、コストは c₀×r^Lv', () => {
  it('表の値（gdd §5-4）: 初期コスト・成長率・基本湧出', () => {
    expect(SPRINGS.map((sp) => [sp.id, sp.pumpC0, sp.pumpR, sp.flow])).toEqual([
      ['simple', 60, 1.11, 1],
      ['co2', 3_000, 1.12, 30],
      ['salt', 120_000, 1.13, 1_200],
      ['sulfur', 2e7, 1.14, 5e4],
      ['iron', 8e9, 1.15, 2.5e6],
    ]);
  });

  it('マイルストーン: Lv10・25・50・100 で各 ×2（Lv9→1、10→2、24→2、25→4、49→4、50→8、99→8、100→16）', () => {
    expect([1, 9, 10, 24, 25, 49, 50, 99, 100, 1000].map(pumpMilestoneMult)).toEqual([1, 1, 2, 2, 4, 4, 8, 8, 16, 16]);
    expect([0, 1, 9, 10, 24, 25, 49, 50, 99, 100, 5000].map(nextPumpMilestone)).toEqual([10, 10, 10, 25, 25, 50, 50, 100, 100, null, null]);
  });

  it.each(SPRING_IDS)('%s の基本の入湯料＝基本湧出 × Lv × マイルストーン（枠・全体の倍率の前）', (id) => {
    for (const lv of [1, 9, 10, 25, 50, 100, 137]) {
      const s = stateWith({ pumps: { [id]: lv } });
      const salt = 1; // カピバラがいない（塩化物泉を枠につないでいない）ので ×1
      expect(rel(springIncome(s, id).toNumber(), SPRING_BY_ID[id].flow * lv * pumpMilestoneMult(lv) * salt)).toBeLessThan(1e-12);
    }
  });

  it('枠 1 に単純温泉 Lv10 だけ: 1×10×2 ×（湯船 Lv0＝1）× 単純温泉 1.2 × タヌキ 1.5 ＝ 36/秒', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 10 } });
    expect(s.run.guests).toEqual(['tanuki']);
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(36, 10);
  });

  it('湯船の Lv で +5%/Lv、湯の華 1 つで +2%（転生の倍率）が掛け算で乗る', () => {
    const s = stateWith({ bath: 4, pumps: { simple: 10 } }); // Lv4（枠は 1 つのまま）→ ×1.2
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(36 * 1.2, 9);
    s.meta.yunohana.lifetime = num(10); // ×1.2
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(36 * 1.2 * 1.2, 9);
  });

  it('2 つの源泉をつなぐと基本の入湯料の合計に同じ倍率が掛かる（単純温泉 Lv1 と二酸化炭素泉 Lv1、湯船 Lv5）', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 1 } });
    expect(s.run.bath.slots).toEqual(['simple', 'co2']);
    // (1 + 30) × 1.25 × 1.2 × 1.5
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(31 * 1.25 * 1.2 * 1.5, 9);
  });

  it.each(SPRING_IDS)('%s のポンプの次の 1 Lv のコスト＝c₀ × r^今の Lv（Lv1 から最初に買う Lv2 は c₀×r）', (id) => {
    const { pumpC0: c0, pumpR: r } = SPRING_BY_ID[id];
    for (const lv of [1, 2, 10, 25, 60]) expect(rel(pumpCost(id, lv).toNumber(), c0 * r ** lv)).toBeLessThan(1e-9);
    const s = stateWith({ coins: c0 * r, pumps: { [id]: 1 } });
    const q = buyQuote(s, `pump:${id}`, 1);
    expect(q.state).toBe('affordable');
    expect(q.level).toBe(1);
    expect(rel(q.cost.toNumber(), c0 * r)).toBeLessThan(1e-9);
  });

  it('ポンプを買うと Lv が上がり、代金は表示と同じ額（×10 も）', () => {
    const s = stateWith({ coins: '1e6', bath: 0, pumps: { simple: 1 } });
    const q = buyQuote(s, 'pump:simple', 10);
    const before = s.run.coins;
    const r = dispatch(s, { type: 'buy', item: 'pump:simple', qty: 10 });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: 'Purchased', item: 'pump:simple', qty: 10 });
    expect(s.run.springs.simple?.pump).toBe(11);
    expect(s.run.coins.toString()).toBe(before.sub(q.cost).toString());
  });

  it('性質: 入湯料はポンプの Lv に対して減らない（fast-check）', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SPRING_IDS), fc.integer({ min: 1, max: 5000 }), (id, lv) => {
        const a = stateWith({ bath: 35, pumps: { [id]: lv } });
        const b = stateWith({ bath: 35, pumps: { [id]: lv + 1 } });
        return bathIncomePerSec(b).gte(bathIncomePerSec(a)) && bathIncomePerSec(b).gt(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('BL-015 AC3 枠につないでいない源泉の入湯料は 0', () => {
  it('発見済みでも枠にない源泉は入湯料に入らない（springViews の incomePerSec も 0、つないだときの目安は正）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 5, co2: 3 } });
    expect(s.run.bath.slots).toEqual(['simple']);
    const only = bathIncomePerSec(s).toNumber();
    const v = springViews(s);
    const co2 = v.find((x) => x.id === 'co2');
    expect(co2).toMatchObject({ found: true, pump: 3, slot: null });
    expect(co2?.incomePerSec.toNumber()).toBe(0);
    expect(co2?.potentialPerSec.gt(0)).toBe(true);
    const simple = v.find((x) => x.id === 'simple');
    expect(simple?.slot).toBe(0);
    expect(rel(simple?.incomePerSec.toNumber() ?? 0, only)).toBeLessThan(1e-12);
  });

  it('枠から外すと入湯料が 0 になり、つなぎ直すと戻る（ポンプの Lv は源泉に残る）', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 20 } });
    const before = bathIncomePerSec(s).toString();
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: null }).ok).toBe(true);
    expect(bathIncomePerSec(s).toNumber()).toBe(0);
    expect(s.run.springs.simple?.pump).toBe(20);
    expect(dispatch(s, { type: 'assignSlot', slot: 0, spring: 'simple' }).ok).toBe(true);
    expect(bathIncomePerSec(s).toString()).toBe(before);
  });

  it('性質: springViews の incomePerSec の合計は入湯料/秒と丸めの範囲で一致し、つないでいない源泉は 0（fast-check）', () => {
    const lv = fc.integer({ min: 0, max: 300 });
    fc.assert(
      fc.property(fc.tuple(lv, lv, lv, lv, lv), fc.integer({ min: 0, max: 60 }), (lvs, bath) => {
        const pumps = Object.fromEntries(SPRING_IDS.map((id, i) => [id, lvs[i] ?? 0]));
        const s = stateWith({ bath, pumps });
        const v = springViews(s);
        const sum = v.reduce((a, x) => a + x.incomePerSec.toNumber(), 0);
        const total = bathIncomePerSec(s).toNumber();
        const unslottedZero = v.every((x) => x.slot !== null || x.incomePerSec.eq(0));
        return unslottedZero && (total === 0 ? sum === 0 : rel(sum, total) < 1e-9);
      }),
      { numRuns: 200 },
    );
  });
});

describe('BL-015 内容定義', () => {
  it('contentProblems() が空（源泉の深さ・コスト・基本湧出が増えていく、成長率 > 1、マイルストーンが増えていく、名前のキー）', () => {
    expect(contentProblems()).toEqual([]);
  });

  it('源泉の名前のキー spring.<id> が en.json・ja.json の両方にある', () => {
    for (const sp of SPRINGS) {
      expect(sp.nameKey).toBe(`spring.${sp.id}`);
      expect(Object.hasOwn(en, sp.nameKey)).toBe(true);
      expect(Object.hasOwn(ja, sp.nameKey)).toBe(true);
    }
  });

  it('springViews は 5 種すべてを定義の順に返す（未発見は found: false・Lv0・枠なし・次のマイルストーン 10）', () => {
    const v = springViews(createInitialState(1));
    expect(v.map((x) => x.id)).toEqual(SPRING_IDS);
    for (const x of v) {
      expect(x).toMatchObject({ found: false, pump: 0, slot: null, nextMilestone: 10, depth: SPRING_BY_ID[x.id].depth });
      expect(x.incomePerSec.eq(0) && x.potentialPerSec.eq(0)).toBe(true);
      expect(x.effect).toEqual(SPRING_BY_ID[x.id].effect);
    }
  });
});
