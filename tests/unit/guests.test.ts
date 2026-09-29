// BL-017: お客さん 4 種（タヌキ・ニホンザル・カピバラ・キツネ）（TS-017-01〜10・13。gdd §5-6、QA §3-2(b)、Q-31 (d)）。
// TS-017-11（初来訪の時刻を app が埋める）は tests/integration/guests-store.test.ts、TS-017-12（温泉チケット）は BL-058、
// TS-017-14（標準ボットの #5）は BL-033 の目標表の判定（それまでは npm run sim のレポート）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { GUESTS, GUEST_BY_ID, type GuestId } from '../../src/content/guests.ts';
import {
  advance,
  autoDiggerHitsPerSec,
  bathIncomePerSec,
  blockHp,
  computeGuests,
  contentProblems,
  createInitialState,
  dispatch,
  drillPower,
  guestViews,
  modifiers,
  refreshGuests,
  springIncome,
  stampGuestsSeen,
  stateHash,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { SPRING_IDS, stateWith } from '../support/states.ts';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
type Arrived = Extract<GameEvent, { type: 'GuestArrived' }>;
const arrived = (evs: readonly GameEvent[]): Arrived[] => evs.filter((e): e is Arrived => e.type === 'GuestArrived');
const left = (evs: readonly GameEvent[]): GuestId[] =>
  evs.filter((e): e is Extract<GameEvent, { type: 'GuestLeft' }> => e.type === 'GuestLeft').map((e) => e.guest);

/** 30m の 1m 手前から 1 打で単純温泉を見つける（ちょうど 1 打で壊れる状態にする） */
function findSimple(s: GameState): GameEvent[] {
  s.run.depth = 29;
  s.run.maxDepth = 29;
  s.run.blockDmg = blockHp(s, 29).sub(drillPower(s));
  return dispatch(s, { type: 'tap' }).events;
}

const BL017: GuestId[] = ['tanuki', 'monkey', 'capybara', 'fox'];

describe('TS-017-01 お客さんの定義（gdd §5-6）と内容定義の検査', () => {
  it('4 種の来訪の条件と効果', () => {
    expect(BL017.map((id) => [id, GUEST_BY_ID[id].condition, GUEST_BY_ID[id].effect])).toEqual([
      ['tanuki', { kind: 'anySlotted' }, { kind: 'incomeAll', mult: 1.5 }],
      ['monkey', { kind: 'slottedLevel', spring: 'co2', level: 10 }, { kind: 'drillPower', mult: 2 }],
      ['capybara', { kind: 'slottedLevel', spring: 'salt', level: 10 }, { kind: 'springIncome', spring: 'salt', mult: 2 }],
      ['fox', { kind: 'slottedLevel', spring: 'sulfur', level: 10 }, { kind: 'autoDig', mult: 2 }],
    ]);
    expect(GUESTS.map((g) => g.id).slice(0, 4)).toEqual(BL017);
  });

  it('contentProblems() が 0 件（条件の源泉・Lv・枠の数・名前のキー・効果）', () => {
    expect(contentProblems()).toEqual([]);
  });

  it('4 種の名前のキー guest.<id> が en.json・ja.json の両方にある（ネコ・レッサーパンダは BL-019）', () => {
    for (const id of BL017) {
      const key = GUEST_BY_ID[id].nameKey;
      expect(key).toBe(`guest.${id}`);
      expect(Object.hasOwn(en, key)).toBe(true);
      expect(Object.hasOwn(ja, key)).toBe(true);
    }
  });
});

describe('TS-017-02〜07 来訪と退出（抽選なし）', () => {
  it('TS-017-02 30m で単純温泉を見つけると、SpringFound の後に GuestArrived{tanuki, first: true} が 1 回。図鑑に記録（時刻は 0＝app が埋める）', () => {
    const s = createInitialState(1);
    const ev = findSimple(s);
    const types = ev.map((e) => e.type);
    expect(types.indexOf('GuestArrived')).toBeGreaterThan(types.indexOf('SpringFound'));
    expect(arrived(ev)).toEqual([{ type: 'GuestArrived', guest: 'tanuki', first: true }]);
    expect(s.run.guests).toEqual(['tanuki']);
    expect(s.collection.guestsSeen).toEqual({ tanuki: 0 });
  });

  it('TS-017-03 枠をすべて空きにすると GuestLeft{tanuki}・×1.5 が消える。つなぎ直すと GuestArrived{first: false}', () => {
    const s = createInitialState(1);
    findSimple(s);
    const withTanuki = modifiers(s).incomeAll;
    const off = dispatch(s, { type: 'assignSlot', slot: 0, spring: null });
    expect(left(off.events)).toEqual(['tanuki']);
    expect(s.run.guests).toEqual([]);
    expect(withTanuki / modifiers(s).incomeAll).toBeCloseTo(1.5 * 1.2, 12); // 単純温泉 ×1.2 も外れる
    const on = dispatch(s, { type: 'assignSlot', slot: 0, spring: 'simple' });
    expect(arrived(on.events)).toEqual([{ type: 'GuestArrived', guest: 'tanuki', first: false }]);
  });

  it.each([
    ['monkey', 'co2'],
    ['capybara', 'salt'],
    ['fox', 'sulfur'],
  ] as [GuestId, 'co2' | 'salt' | 'sulfur'][])('TS-017-04・05 %s: %s を枠につないで Lv9 では来ず、Lv10 にした buy のイベントで来る（first: true）', (id, spring) => {
    const s = stateWith({ coins: '1e30', bath: 0, pumps: { [spring]: 9 } });
    expect(s.run.bath.slots).toEqual([spring]);
    expect(s.run.guests).toEqual(['tanuki']);
    const r = dispatch(s, { type: 'buy', item: `pump:${spring}`, qty: 1 });
    expect(r.ok).toBe(true);
    expect(arrived(r.events)).toEqual([{ type: 'GuestArrived', guest: id, first: true }]);
    expect(s.run.guests).toEqual(['tanuki', id]);
  });

  it('TS-017-06 ポンプ Lv15 でも枠につないでいなければニホンザルは来ない（buy・step の後も）。つないだ assignSlot のイベントで来る', () => {
    const s = stateWith({ coins: '1e30', bath: 5, pumps: { simple: 1, co2: 15 } });
    dispatch(s, { type: 'assignSlot', slot: 1, spring: null });
    expect(s.run.bath.slots).toEqual(['simple', null]);
    s.collection.guestsSeen = { tanuki: 0 }; // 状態を作るときに一度来たことにされた分を消す（この周回で初めての来訪を見る）
    const b = dispatch(s, { type: 'buy', item: 'pump:co2', qty: 1 });
    expect(arrived(b.events)).toEqual([]);
    expect(advance(s, 1000).filter((e) => e.type === 'GuestArrived')).toEqual([]);
    expect(s.run.guests).toEqual(['tanuki']);
    const a = dispatch(s, { type: 'assignSlot', slot: 1, spring: 'co2' });
    expect(arrived(a.events)).toEqual([{ type: 'GuestArrived', guest: 'monkey', first: true }]);
  });

  it('TS-017-07 ニホンザルの二酸化炭素泉を塩化物泉 Lv3 に入れ替えると GuestLeft{monkey}・威力 ×2 が消える（タヌキは残る）', () => {
    const s = stateWith({ bath: 5, pumps: { co2: 10, simple: 1, salt: 3 } });
    s.run.bath.slots = ['co2', 'simple'];
    refreshGuests(s, []);
    expect(s.run.guests).toEqual(['tanuki', 'monkey']);
    const before = modifiers(s).drillPower;
    const r = dispatch(s, { type: 'assignSlot', slot: 0, spring: 'salt' });
    expect(left(r.events)).toEqual(['monkey']);
    expect(s.run.guests).toEqual(['tanuki']);
    expect(before / modifiers(s).drillPower).toBeCloseTo(2 * 1.5, 12); // 二酸化炭素泉の ×1.5 も外れる
  });

  it('TS-017-13 同時に条件を満たしたときは定義の順（ニホンザル → カピバラ → キツネ）で来る。毎回同じ', () => {
    const run = (): GameEvent[] => {
      const s = stateWith({ bath: 35, pumps: { simple: 1, co2: 10, salt: 10, sulfur: 10 } });
      s.run.bath.slots = [null, null, null, null];
      refreshGuests(s, []);
      expect(s.run.guests).toEqual([]);
      s.run.bath.slots = ['sulfur', 'salt', 'co2', null];
      const out: GameEvent[] = [];
      refreshGuests(s, out);
      return out;
    };
    const a = run();
    expect(arrived(a).map((e) => e.guest)).toEqual(['tanuki', 'monkey', 'capybara', 'fox']);
    expect(run()).toEqual(a);
  });
});

describe('TS-017-08 来訪は条件の式どおりで、擬似乱数に左右されない（fast-check）', () => {
  it('ランダムな発見済みの源泉・Lv・枠: 顔ぶれ＝条件の式。rng・周回のシードを変えても同じ', () => {
    const lv = fc.integer({ min: 0, max: 30 });
    fc.assert(
      fc.property(
        fc.tuple(lv, lv, lv, lv, lv),
        fc.integer({ min: 0, max: 40 }),
        fc.array(fc.record({ slot: fc.integer({ min: 0, max: 3 }), spring: fc.constantFrom(null, ...SPRING_IDS) }), { maxLength: 10 }),
        fc.array(fc.integer(), { minLength: 5, maxLength: 5 }),
        (lvs, bath, acts, rnd) => {
          const s = stateWith({ bath, pumps: Object.fromEntries(SPRING_IDS.map((id, i) => [id, lvs[i] ?? 0])) });
          for (const a of acts) dispatch(s, { type: 'assignSlot', ...a });
          const slotted = s.run.bath.slots.filter((x) => x !== null);
          const lvOf = (id: (typeof SPRING_IDS)[number]): number => s.run.springs[id]?.pump ?? 0;
          const expected = GUESTS.filter((g) => {
            const c = g.condition;
            if (c.kind === 'anySlotted') return slotted.length > 0;
            if (c.kind === 'slottedLevel') return slotted.includes(c.spring) && lvOf(c.spring) >= c.level;
            return s.run.bath.slots.length >= c.slots && slotted.length >= c.slots;
          }).map((g) => g.id);
          const before = [...s.run.guests];
          s.rng.run = [rnd[0] ?? 1, rnd[1] ?? 2, rnd[2] ?? 3, rnd[3] ?? 4];
          s.run.seed = (rnd[4] ?? 5) >>> 0;
          return JSON.stringify(before) === JSON.stringify(expected) && JSON.stringify(computeGuests(s)) === JSON.stringify(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('TS-017-09 来ている間の効果', () => {
  it('タヌキ: 全入湯料 ×1.5', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 10 } });
    expect(bathIncomePerSec(s).toNumber()).toBeCloseTo(20 * 1.2 * 1.5, 10);
  });

  it('ニホンザル: ドリル威力 ×2（二酸化炭素泉の ×1.5 と合わせて ×3）', () => {
    const s = stateWith({ bath: 0, pumps: { co2: 10 }, drill: 7 });
    const base = drillPower(stateWith({ drill: 7 })).toNumber();
    expect(s.run.guests).toContain('monkey');
    expect(rel(drillPower(s).toNumber(), base * 3)).toBeLessThan(1e-12);
  });

  it('カピバラ: 塩化物泉の入湯料だけ ×2（Lv10: 24,000 → 48,000。ほかの源泉は変わらない）', () => {
    const s = stateWith({ bath: 5, pumps: { salt: 10, co2: 5 } });
    expect(s.run.guests).toContain('capybara');
    expect(springIncome(s, 'salt').toNumber()).toBe(48_000);
    expect(springIncome(s, 'co2').toNumber()).toBe(150);
    const without = stateWith({ bath: 5, pumps: { salt: 9, co2: 5 } });
    expect(springIncome(without, 'salt').toNumber()).toBe(1200 * 9);
  });

  it('キツネ: 自動掘削機の打数/秒 ×2（Lv10: 2 → 4）。自動掘りの基本の毎秒 2 打には掛からない（Q-31 (d)）', () => {
    const on = stateWith({ bath: 0, pumps: { sulfur: 10 }, digger: 10 });
    const off = stateWith({ digger: 10 });
    expect(on.run.guests).toContain('fox');
    expect(autoDiggerHitsPerSec(off)).toBeCloseTo(2, 12);
    expect(autoDiggerHitsPerSec(on)).toBeCloseTo(4, 12);
    expect(modifiers(on).autoDig).toBe(2);
  });
});

describe('TS-017-10 転生で来訪はやり直し、図鑑（初来訪の日時）は残る', () => {
  it('次の周回の開始時は誰も来ておらず効果もない。図鑑の 2 種と時刻は残り、次のタヌキは first: false', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 1, co2: 10 } });
    s.collection.guestsSeen = { tanuki: 1_700_000_000_000, monkey: 1_700_000_100_000 };
    s.run.maxDepth = 150;
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.run.guests).toEqual([]);
    expect(modifiers(s).incomeAll).toBe(1);
    expect(modifiers(s).drillPower).toBe(1);
    expect(s.collection.guestsSeen).toEqual({ tanuki: 1_700_000_000_000, monkey: 1_700_000_100_000 });
    const ev = findSimple(s);
    expect(arrived(ev)).toEqual([{ type: 'GuestArrived', guest: 'tanuki', first: false }]);
    expect(s.collection.guestsSeen.tanuki).toBe(1_700_000_000_000);
  });
});

describe('stampGuestsSeen（初来訪の時刻。core の側）・guestViews', () => {
  it('first: true の来訪のうち、図鑑が 0 のものだけに時刻を入れる（2 回目・時刻のある記録・不正な時刻は変えない）', () => {
    const s = createInitialState(1);
    const ev = findSimple(s);
    expect(stampGuestsSeen(s, ev, Number.NaN)).toBe(0);
    expect(stampGuestsSeen(s, ev, -5)).toBe(0);
    expect(s.collection.guestsSeen.tanuki).toBe(0);
    expect(stampGuestsSeen(s, ev, 1_800_000_000_000)).toBe(1);
    expect(stampGuestsSeen(s, ev, 1_900_000_000_000)).toBe(0);
    expect(s.collection.guestsSeen.tanuki).toBe(1_800_000_000_000);
    expect(stampGuestsSeen(s, [{ type: 'GuestArrived', guest: 'tanuki', first: false }], 2e12)).toBe(0);
  });

  it('guestViews: 6 種を定義の順に。来ている・図鑑・初来訪の時刻（0 は null）・条件・効果', () => {
    const s = stateWith({ bath: 0, pumps: { simple: 1 } });
    s.collection.guestsSeen = { tanuki: 1_700_000_000_000, fox: 0 };
    const v = guestViews(s);
    expect(v.map((x) => x.id)).toEqual(GUESTS.map((g) => g.id));
    expect(v[0]).toMatchObject({ id: 'tanuki', present: true, seen: true, firstSeenAt: 1_700_000_000_000 });
    expect(v.find((x) => x.id === 'fox')).toMatchObject({ present: false, seen: true, firstSeenAt: null });
    expect(v.find((x) => x.id === 'monkey')).toMatchObject({ present: false, seen: false, firstSeenAt: null });
    expect(v.find((x) => x.id === 'monkey')?.condition).toEqual({ kind: 'slottedLevel', spring: 'co2', level: 10 });
  });

  it('来訪を判定し直しても状態のハッシュは条件だけで決まる（同じ状態から同じ結果）', () => {
    const a = stateWith({ bath: 15, pumps: { simple: 3, co2: 10, salt: 10 } });
    const b = stateWith({ bath: 15, pumps: { simple: 3, co2: 10, salt: 10 } });
    refreshGuests(a, []);
    expect(stateHash(a)).toBe(stateHash(b));
  });
});
