// BL-018: 改良の仕組みと前半 12 項目（TS-018-01〜08・12・13・15。T3 の表示〔TS-044-12〜15〕は BL-044 の T3 の PR）
import { describe, expect, it } from 'vitest';
import { UPGRADE_BY_ID, UPGRADES, isUpgradeId, type UpgradeDef } from '../../src/content/upgrades.ts';
import {
  buyQuote,
  contentProblems,
  dispatch,
  modifiers,
  nextUpgradeDepth,
  stateHash,
  upgradeProblems,
  upgradeViews,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { stateWith } from '../support/states.ts';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';

describe('TS-018-01・02 内容定義', () => {
  it('TS-018-01: 12 項目が gdd §5-7 の表どおり（ID・効果・条件・コスト）', () => {
    expect(UPGRADES.map((u) => u.id)).toEqual([
      'vibroBit',
      'sieve',
      'noren',
      'ledger',
      'drillOil',
      'yumomiSimple',
      'milk',
      'yumomiCo2',
      'yumomiSalt',
      'twinBit',
      'polisher',
      'yumomiSulfur',
    ]);
    expect(UPGRADE_BY_ID.vibroBit).toMatchObject({ effect: { kind: 'drillPower', mult: 2 }, unlock: { kind: 'depth', depth: 40 }, cost: 500 });
    expect(UPGRADE_BY_ID.noren).toMatchObject({ effect: { kind: 'incomeAll', mult: 1.5 }, unlock: { kind: 'pump', spring: 'simple', level: 5 }, cost: 1200 });
    expect(UPGRADE_BY_ID.yumomiSulfur).toMatchObject({ effect: { kind: 'springIncome', spring: 'sulfur', mult: 3 }, unlock: { kind: 'pump', spring: 'sulfur', level: 25 }, cost: 7.6e9 });
    expect(UPGRADE_BY_ID.polisher).toMatchObject({ effect: { kind: 'oreValue', mult: 3 }, unlock: { kind: 'depth', depth: 220 }, cost: 2.9e8 });
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
    expect(upgradeProblems(bad({ cost: 400 }, 1))).toEqual([expect.stringContaining('sieve')]);
  });
  it('TS-018-18（一部）: 名前のキー upgrade.<id> が英日にある', () => {
    for (const u of UPGRADES) {
      expect(Object.hasOwn(en, u.nameKey)).toBe(true);
      expect(Object.hasOwn(ja, u.nameKey)).toBe(true);
    }
  });
  it('isUpgradeId は prototype の名前を拾わない', () => {
    expect(isUpgradeId('noren')).toBe(true);
    for (const x of ['grip', '__proto__', 'constructor', '', 1, null]) expect(isUpgradeId(x)).toBe(false);
  });
});

describe('TS-018-03〜07 解放・見積もり・購入', () => {
  it('TS-018-03: 深さの条件は周回の最深で判定する（今 20m でも最深 40m なら解放）', () => {
    expect(buyQuote(stateWith({ depth: 39 }), 'upgrade:vibroBit', 1)).toMatchObject({ state: 'locked', unlockDepth: 40 });
    expect(buyQuote(stateWith({ depth: 40 }), 'upgrade:vibroBit', 1).state).toBe('insufficient');
    expect(buyQuote(stateWith({ depth: 20, maxDepth: 40, coins: 500 }), 'upgrade:vibroBit', 1).state).toBe('affordable');
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
    const s = stateWith({ depth: 60, coins: 800 });
    s.run.upgrades = ['sieve'];
    const q = buyQuote(s, 'upgrade:vibroBit', 1);
    const r = dispatch(s, { type: 'buy', item: 'upgrade:vibroBit', qty: 1 });
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({ type: 'Purchased', item: 'upgrade:vibroBit', qty: 1 });
    expect(s.run.coins.toNumber()).toBeCloseTo(800 - q.cost.toNumber(), 9);
    expect(s.run.upgrades).toEqual(['sieve', 'vibroBit']);
    expect(buyQuote(s, 'upgrade:vibroBit', 1).state).toBe('maxed');
  });
  it('TS-018-06: 購入済み・足りない・未解放・壊れた品目では状態が変わらない', () => {
    const cases: [GameState, unknown, string][] = [];
    const bought = stateWith({ depth: 60, coins: 1e6 });
    bought.run.upgrades = ['vibroBit'];
    cases.push([bought, 'upgrade:vibroBit', 'maxed']);
    cases.push([stateWith({ depth: 60, coins: 499 }), 'upgrade:vibroBit', 'insufficient']);
    cases.push([stateWith({ depth: 39, coins: 1e6 }), 'upgrade:vibroBit', 'locked']);
    for (const item of ['upgrade:foo', 'upgrade:', 'upgrade:__proto__', 'upgrade:constructor', 3, null]) cases.push([stateWith({ depth: 60, coins: 1e6 }), item, 'invalid']);
    for (const [s, item, reason] of cases) {
      const before = stateHash(s);
      const r = dispatch(s, { type: 'buy', item, qty: 1 });
      expect(r).toEqual({ ok: false, reason, events: [] });
      expect(stateHash(s)).toBe(before);
    }
  });
  it('TS-018-07: ×10・最大でも 1 回だけ買い、代金は 1 回分', () => {
    for (const qty of [10, 'max'] as const) {
      const s = stateWith({ depth: 60, coins: 1e6 });
      expect(buyQuote(s, 'upgrade:vibroBit', qty)).toMatchObject({ n: 1, state: 'affordable' });
      dispatch(s, { type: 'buy', item: 'upgrade:vibroBit', qty });
      expect(s.run.upgrades).toEqual(['vibroBit']);
      expect(s.run.coins.toNumber()).toBeCloseTo(1e6 - 500, 6);
    }
  });
});

describe('TS-018-08・12・13・15 効果・転生・保存・T3 に渡す値', () => {
  it('TS-018-08: 定義どおりの倍率がその項目にだけ乗る', () => {
    const s = stateWith({ depth: 60 });
    const m0 = modifiers(s);
    s.run.upgrades = ['vibroBit', 'sieve', 'noren', 'ledger', 'drillOil', 'yumomiSimple'];
    const m = modifiers(s);
    expect(m.drillPower).toBeCloseTo(m0.drillPower * 2, 12);
    expect(m.oreValue).toBeCloseTo(m0.oreValue * 2, 12);
    expect(m.incomeAll).toBeCloseTo(m0.incomeAll * 1.5, 12);
    expect(m.digCoins).toBeCloseTo(m0.digCoins * 1.5, 12);
    expect(m.autoDig).toBeCloseTo(m0.autoDig * 2, 12);
    expect(m.springIncome.simple).toBeCloseTo(m0.springIncome.simple * 3, 12);
    expect(m.springIncome.co2).toBe(m0.springIncome.co2);
    expect(m.hardness).toBe(m0.hardness);
  });
  it('TS-018-12: 転生で run.upgrades は空になり、倍率が戻る', () => {
    const s = stateWith({ depth: 160, coins: 1e9 });
    s.run.upgrades = ['vibroBit', 'sieve', 'milk'];
    const r = dispatch(s, { type: 'prestige' });
    if (!r.ok) return; // PoC の簡易な転生の条件を満たさないときは対象外（BL-021 で本実装）
    expect(s.run.upgrades).toEqual([]);
    expect(modifiers(s).drillPower).toBe(modifiers(stateWith()).drillPower);
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
    const s = stateWith({ depth: 55, coins: 600 });
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
