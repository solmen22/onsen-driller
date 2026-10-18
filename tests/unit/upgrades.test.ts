// BL-018: 改良の仕組みと前半 12 項目（TS-018-01〜13・15。T3 の表示〔TS-044-12〜15〕は BL-044 の T3 の PR）
// 数値（コスト・倍率）は content から読む（以後の数値の調整は content/ だけの PR でできる。TS-018-16）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GUEST_BY_ID } from '../../src/content/guests.ts';
import { SPRING_BY_ID } from '../../src/content/springs.ts';
import { UPGRADE_BY_ID, UPGRADES, isUpgradeId, type UpgradeDef, type UpgradeId } from '../../src/content/upgrades.ts';
import {
  bathIncomePerSec,
  bathView,
  buyQuote,
  contentProblems,
  dispatch,
  incomePerSec,
  modifiers,
  nextUpgradeDepth,
  num,
  secondsUntil,
  springViews,
  stateHash,
  upgradeProblems,
  upgradeViews,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { fcRuns } from '../helpers/fc-runs.ts';
import { stateWith } from '../support/states.ts';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';

/** 効果の倍率（倍率でない効果〔offlineEff の add〕は NaN にして、比較で必ず赤にする） */
const multOf = (e: { kind: string; mult?: number } | { kind: string; add: number }): number => ('mult' in e && typeof e.mult === 'number' ? e.mult : Number.NaN);

describe('TS-018-01・02 内容定義', () => {
  it('TS-018-01: 12 項目が gdd §5-7 の表どおり（ID・効果の種類・解放の条件の種類と順番。コストと倍率の値は TS-018-02 の検査と docs/balance.md に任せる）', () => {
    expect(
      UPGRADES.map((u) => [u.id, u.effect.kind, 'spring' in u.effect ? u.effect.spring : null, u.unlock.kind, u.unlock.kind === 'pump' ? u.unlock.spring : null]),
    ).toEqual([
      ['vibroBit', 'drillPower', null, 'depth', null],
      ['sieve', 'oreValue', null, 'depth', null],
      ['noren', 'incomeAll', null, 'pump', 'simple'],
      ['ledger', 'digCoins', null, 'depth', null],
      ['drillOil', 'autoDig', null, 'depth', null],
      ['yumomiSimple', 'springIncome', 'simple', 'pump', 'simple'],
      ['milk', 'incomeAll', null, 'depth', null],
      ['yumomiCo2', 'springIncome', 'co2', 'pump', 'co2'],
      ['yumomiSalt', 'springIncome', 'salt', 'pump', 'salt'],
      ['twinBit', 'drillPower', null, 'depth', null],
      ['polisher', 'oreValue', null, 'depth', null],
      ['yumomiSulfur', 'springIncome', 'sulfur', 'pump', 'sulfur'],
    ]);
    // 倍率はどれも 1 より大きい（値そのものは content。BL-034 で調整する）
    for (const u of UPGRADES) expect(multOf(u.effect)).toBeGreaterThan(1);
  });
  it('TS-018-02: 正しい定義は問題なし。起動時の contentProblems にも出ない', () => {
    expect(upgradeProblems()).toEqual([]);
    expect(contentProblems().filter((p) => p.startsWith('upgrades'))).toEqual([]);
  });
  it('TS-018-02: 重複・知らない源泉・届かない条件・正でないコスト・同じ組でのコストの逆転を見つける', () => {
    const base = UPGRADES;
    const bad = (patch: Partial<UpgradeDef>, at = 0): UpgradeDef[] => base.map((u, i) => (i === at ? { ...u, ...patch } : u));
    expect(upgradeProblems([...base, base[0]!])).toHaveLength(1);
    expect(upgradeProblems(bad({ unlock: { kind: 'pump', spring: 'lava' as 'simple', level: 5 } }))).not.toEqual([]);
    expect(upgradeProblems(bad({ unlock: { kind: 'depth', depth: 10_000 } }))).not.toEqual([]);
    expect(upgradeProblems(bad({ unlock: { kind: 'pump', spring: 'simple', level: 2_000_000 } }))).not.toEqual([]);
    for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(upgradeProblems(bad({ cost }))).not.toEqual([]);
    // 深さの組: sieve（50m）を vibroBit（40m）より安くする
    expect(upgradeProblems(bad({ cost: UPGRADE_BY_ID.vibroBit.cost * 0.5 }, 1))).toEqual([expect.stringContaining('sieve')]);
  });
  it('TS-018-18（一部）: 名前のキー upgrade.<id> が英日にある', () => {
    for (const u of UPGRADES) {
      expect(Object.hasOwn(en, u.nameKey)).toBe(true);
      expect(Object.hasOwn(ja, u.nameKey)).toBe(true);
    }
  });
  it('buyQuote は型を外れた改良の ID でも例外にせず locked を返す（PR #62 のレビュー N-3）', () => {
    const s = stateWith({ depth: 300, coins: 1e15 });
    for (const id of ['foo', '__proto__', 'constructor', '']) {
      const q = buyQuote(s, `upgrade:${id}` as `upgrade:${UpgradeId}`, 1);
      expect(q).toMatchObject({ state: 'locked', n: 0 });
      expect(q.cost.toNumber()).toBe(0);
    }
  });
  it('isUpgradeId は prototype の名前を拾わない', () => {
    expect(isUpgradeId('noren')).toBe(true);
    for (const x of ['grip', '__proto__', 'constructor', '', 1, null]) expect(isUpgradeId(x)).toBe(false);
  });
});

// 仕組みのテストはコストを内容定義から読む（数値の調整〔content/ だけの PR〕で赤にならない。TS-018-16）
const VIBRO = UPGRADE_BY_ID.vibroBit.cost;

describe('TS-018-03〜07 解放・見積もり・購入', () => {
  it('TS-018-03: 深さの条件は周回の最深で判定する（今 20m でも最深 40m なら解放）', () => {
    expect(buyQuote(stateWith({ depth: 39 }), 'upgrade:vibroBit', 1)).toMatchObject({ state: 'locked', unlockDepth: 40 });
    expect(buyQuote(stateWith({ depth: 40 }), 'upgrade:vibroBit', 1).state).toBe('insufficient');
    expect(buyQuote(stateWith({ depth: 20, maxDepth: 40, coins: VIBRO }), 'upgrade:vibroBit', 1).state).toBe('affordable');
  });
  it('TS-018-04: ポンプの条件はその源泉のポンプの Lv（unlockDepth は出さない）', () => {
    const q0 = buyQuote(stateWith({ depth: 40 }), 'upgrade:noren', 1);
    expect(q0.state).toBe('locked');
    expect(q0.unlockDepth).toBeUndefined();
    expect(buyQuote(stateWith({ depth: 40, pumps: { simple: 4 } }), 'upgrade:noren', 1).state).toBe('locked');
    expect(buyQuote(stateWith({ depth: 40, pumps: { simple: 5 } }), 'upgrade:noren', 1).state).toBe('insufficient');
    expect(buyQuote(stateWith({ depth: 90, pumps: { simple: 1, co2: 25 } }), 'upgrade:yumomiSimple', 1).state).toBe('locked');
  });
  it('TS-018-05: 買うとコインが見積もりの cost だけ減り、run.upgrades の最後に足され、以後は maxed', () => {
    const s = stateWith({ depth: 60, coins: VIBRO + 300 });
    s.run.upgrades = ['sieve'];
    const q = buyQuote(s, 'upgrade:vibroBit', 1);
    const r = dispatch(s, { type: 'buy', item: 'upgrade:vibroBit', qty: 1 });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: 'Purchased', item: 'upgrade:vibroBit', qty: 1 });
    expect(s.run.coins.toNumber()).toBeCloseTo(VIBRO + 300 - q.cost.toNumber(), 9);
    expect(s.run.upgrades).toEqual(['sieve', 'vibroBit']);
    expect(buyQuote(s, 'upgrade:vibroBit', 1).state).toBe('maxed');
  });
  it('TS-018-06: 購入済み・足りない・未解放・壊れた品目では状態が変わらない', () => {
    const cases: [GameState, unknown, string][] = [];
    const bought = stateWith({ depth: 60, coins: VIBRO * 10 });
    bought.run.upgrades = ['vibroBit'];
    cases.push([bought, 'upgrade:vibroBit', 'maxed']);
    cases.push([stateWith({ depth: 60, coins: VIBRO - 1 }), 'upgrade:vibroBit', 'insufficient']);
    cases.push([stateWith({ depth: 39, coins: VIBRO * 10 }), 'upgrade:vibroBit', 'locked']);
    for (const item of ['upgrade:foo', 'upgrade:', 'upgrade:__proto__', 'upgrade:constructor', 3, null]) cases.push([stateWith({ depth: 60, coins: VIBRO * 10 }), item, 'invalid']);
    for (const [s, item, reason] of cases) {
      const before = stateHash(s);
      const r = dispatch(s, { type: 'buy', item, qty: 1 });
      expect(r).toEqual({ ok: false, reason, events: [] });
      expect(stateHash(s)).toBe(before);
    }
  });
  it('TS-018-07: ×10・最大でも 1 回だけ買い、代金は 1 回分', () => {
    for (const qty of [10, 'max'] as const) {
      const s = stateWith({ depth: 60, coins: VIBRO * 10 });
      expect(buyQuote(s, 'upgrade:vibroBit', qty)).toMatchObject({ n: 1, state: 'affordable' });
      dispatch(s, { type: 'buy', item: 'upgrade:vibroBit', qty });
      expect(s.run.upgrades).toEqual(['vibroBit']);
      expect(s.run.coins.toNumber()).toBeCloseTo(VIBRO * 9, 6);
    }
  });
});

describe('TS-018-08・12・13・15 効果・転生・保存・T3 に渡す値', () => {
  it('TS-018-08: 定義どおりの倍率がその項目にだけ乗る', () => {
    const s = stateWith({ depth: 60 });
    const m0 = modifiers(s);
    s.run.upgrades = ['vibroBit', 'sieve', 'noren', 'ledger', 'drillOil', 'yumomiSimple'];
    const m = modifiers(s);
    const k = (id: UpgradeId): number => multOf(UPGRADE_BY_ID[id].effect);
    expect(m.drillPower).toBeCloseTo(m0.drillPower * k('vibroBit'), 12);
    expect(m.oreValue).toBeCloseTo(m0.oreValue * k('sieve'), 12);
    expect(m.incomeAll).toBeCloseTo(m0.incomeAll * k('noren'), 12);
    expect(m.digCoins).toBeCloseTo(m0.digCoins * k('ledger'), 12);
    expect(m.autoDig).toBeCloseTo(m0.autoDig * k('drillOil'), 12);
    expect(m.springIncome.simple).toBeCloseTo(m0.springIncome.simple * k('yumomiSimple'), 12);
    expect(m.springIncome.co2).toBe(m0.springIncome.co2);
    expect(m.hardness).toBe(m0.hardness);
  });
  it('TS-018-12: 転生で run.upgrades は空になり、倍率が戻る。条件を満たすと再び解放され、買い直せる', () => {
    // 転生できる状態（最深 160m）を明示して作る。転生が失敗したら黙って合格にせず赤にする
    // （BL-021 で転生の条件が変わったら、ここを直す人が気づけるように。PR #62 のレビュー S-3）
    const s = stateWith({ depth: 160, coins: 1e9 });
    s.run.upgrades = ['vibroBit', 'sieve', 'milk'];
    const r = dispatch(s, { type: 'prestige' });
    expect(r.ok).toBe(true);
    expect(s.run.upgrades).toEqual([]);
    expect(modifiers(s).drillPower).toBe(modifiers(stateWith()).drillPower);
    // gdd §5-8「改良はリセット」: 条件（最深 40m）を満たすと再び解放され、買い直せる
    s.run.depth = 40;
    s.run.maxDepth = Math.max(s.run.maxDepth, 40);
    s.run.coins = num(VIBRO);
    expect(buyQuote(s, 'upgrade:vibroBit', 1).state).toBe('affordable');
    expect(dispatch(s, { type: 'buy', item: 'upgrade:vibroBit', qty: 1 }).ok).toBe(true);
    expect(s.run.upgrades).toEqual(['vibroBit']);
  });
  it('TS-018-13: 保存 → 読み込みで run.upgrades の中身と順番が同じ', () => {
    const s = stateWith({ depth: 160 });
    s.run.upgrades = ['milk', 'vibroBit', 'noren'];
    const r = decodeSave(encodeSave(s, 1, 1_700_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.run.upgrades).toEqual(['milk', 'vibroBit', 'noren']);
    expect(r.corrected).toEqual([]);
  });
  it('TS-018-15: upgradeViews は解放済みか購入済みだけを内容定義の順で返し、状態とコストは buyQuote と同じ。次の解放の深さも出す', () => {
    const s = stateWith({ depth: 55, coins: VIBRO + 100 });
    s.run.upgrades = ['sieve'];
    const v = upgradeViews(s);
    expect(v.map((x) => [x.id, x.state, x.bought])).toEqual([
      ['vibroBit', 'affordable', false],
      ['sieve', 'maxed', true],
    ]);
    for (const x of v) expect(x.cost.toNumber()).toBe(buyQuote(s, `upgrade:${x.id}`, 1).nextCost.toNumber());
    expect(nextUpgradeDepth(s)).toBe(70);
    expect(nextUpgradeDepth(stateWith({ depth: 0 }))).toBe(40);
  });
});

describe('TS-018-09〜11 重ね方・順番・表示と購入の一致（PR #62 のレビュー S-2）', () => {
  it('TS-018-09: のれん・湯上がり牛乳・単純温泉・タヌキが掛け算で重なり（今の content で ×5.4）、4 つの selectors と「あと N 秒」がそろって変わる', () => {
    // 単純温泉を枠 1 に入れ、タヌキ（枠に源泉があれば来る）がいる状態。自動掘削機なし（毎秒の収入＝入湯料だけ）
    const s = stateWith({ depth: 140, pumps: { simple: 5 }, bath: 1 });
    expect(s.run.bath.slots[0]).toBe('simple');
    expect(s.run.guests).toContain('tanuki');
    const k = multOf(UPGRADE_BY_ID.noren.effect) * multOf(UPGRADE_BY_ID.milk.effect);
    const simple = SPRING_BY_ID.simple.effect;
    const tanuki = GUEST_BY_ID.tanuki.effect;
    expect([simple.kind, tanuki.kind]).toEqual(['incomeAll', 'incomeAll']);
    const views = (x: GameState) => ({
      bath: bathIncomePerSec(x).toNumber(),
      spring: springViews(x).find((v) => v.id === 'simple')!.incomePerSec.toNumber(),
      slot: bathView(x).slots[0]!.incomePerSec.toNumber(),
      total: incomePerSec(x).toNumber(),
    });
    const m0 = modifiers(s);
    const v0 = views(s);
    const cost = num(v0.total * 1000);
    expect(secondsUntil(s, cost)).toBe(1000);
    s.run.upgrades = ['noren', 'milk'];
    const m = modifiers(s);
    expect(m.incomeAll).toBeCloseTo(m0.incomeAll * k, 12);
    expect(m.incomeAll).toBeCloseTo(k * multOf(simple) * multOf(tanuki), 12);
    const v = views(s);
    for (const key of ['bath', 'spring', 'slot', 'total'] as const) expect(v[key] / v0[key]).toBeCloseTo(k, 12);
    // 「あと N 秒」も新しい収入で計算される（1000 秒 → 1000/k 秒の切り上げ）
    expect(secondsUntil(s, cost)).toBe(Math.ceil(1000 / k - 1e-9));
  });

  // 全部の改良を解放できる状態（最深 300m・5 種のポンプ Lv30・コインは十分）
  const richState = (): GameState => {
    const s = stateWith({ depth: 300, pumps: { simple: 30, co2: 30, salt: 30, sulfur: 30, iron: 30 }, bath: 10, digger: 3, tool: 2 });
    s.run.coins = num(1e15);
    return s;
  };

  it('TS-018-10 (property): 同じ改良を違う順番で買うと、倍率と毎秒の収入は相対誤差 1e-12 以内で一致し、run.upgrades は買った順のまま', () => {
    const ids = UPGRADES.map((u) => u.id);
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 6 }).chain((picked) => fc.tuple(fc.constant(picked), fc.shuffledSubarray(picked, { minLength: picked.length }))),
        ([order1, order2]) => {
          const buyAll = (order: UpgradeId[]): GameState => {
            const s = richState();
            for (const id of order) expect(dispatch(s, { type: 'buy', item: `upgrade:${id}`, qty: 1 }).ok).toBe(true);
            return s;
          };
          const a = buyAll(order1);
          const b = buyAll(order2);
          expect(a.run.upgrades).toEqual(order1);
          expect(b.run.upgrades).toEqual(order2);
          const ma = modifiers(a);
          const mb = modifiers(b);
          for (const key of ['drillPower', 'oreValue', 'incomeAll', 'digCoins', 'autoDig'] as const) expect(Math.abs(ma[key] / mb[key] - 1)).toBeLessThanOrEqual(1e-12);
          for (const id of ['simple', 'co2', 'salt', 'sulfur', 'iron'] as const) expect(Math.abs(ma.springIncome[id] / mb.springIncome[id] - 1)).toBeLessThanOrEqual(1e-12);
          expect(Math.abs(incomePerSec(a).toNumber() / incomePerSec(b).toNumber() - 1)).toBeLessThanOrEqual(1e-12);
        },
      ),
      fcRuns(100),
    );
  });

  it('TS-018-11 (property): 改良の購入が成功するのは見積もりが affordable のときだけで、コインは見積もりの cost だけ減る。それ以外は状態不変。コインは負にならず、同じ改良は 2 回買えない', () => {
    const items = UPGRADES.map((u) => `upgrade:${u.id}` as const);
    fc.assert(
      fc.property(gameStateArb, fc.array(fc.constantFrom(...items), { minLength: 1, maxLength: 12 }), (s, seq) => {
        for (const item of seq) {
          const q = buyQuote(s, item, 1);
          const before = stateHash(s);
          const coins0 = s.run.coins;
          const had = s.run.upgrades.length;
          const r = dispatch(s, { type: 'buy', item, qty: 1 });
          if (q.state === 'affordable') {
            expect(r.ok).toBe(true);
            expect(s.run.coins.eq(coins0.sub(q.cost))).toBe(true);
            expect(s.run.upgrades).toHaveLength(had + 1);
            expect(buyQuote(s, item, 1).state).toBe('maxed');
          } else {
            expect(r.ok).toBe(false);
            expect(stateHash(s)).toBe(before);
          }
          expect(s.run.coins.lt(0)).toBe(false);
          expect(new Set(s.run.upgrades).size).toBe(s.run.upgrades.length);
        }
      }),
      fcRuns(150),
    );
  });
});
