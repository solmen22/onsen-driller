// BL-031: シミュレーターのボット（gdd §8-2。標準・アクティブ・放置）の単体テスト
import { describe, expect, it } from 'vitest';
import { SPRINGS, type SpringId } from '../../src/content/springs.ts';
import { buyQuote, cloneState, computeGuests, stateHash, type LevelItem } from '../../src/core/index.ts';
import { arrangeSlots, botAct, BOTS, canBuyAnything, manualHitsPerSec, newBotMemory, totalRate } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';
import { stateWith } from '../support/states.ts';

describe('BL-031 ボットの定義（gdd §8-2）', () => {
  it('標準＝自動掘り（最初の強化の前は毎秒 2 タップ）・5 秒ごと、アクティブ＝長押し・2 秒ごと、放置＝毎秒 0.3 タップ・60 秒ごと', () => {
    expect(BOTS.standard).toMatchObject({ manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, rewards: 'ads' });
    expect(BOTS.active).toMatchObject({ manual: { kind: 'hold' }, buyEverySec: 2, rewards: 'ads' });
    expect(BOTS.idle).toMatchObject({ manual: { kind: 'taps', perSec: 0.3 }, buyEverySec: 60, rewards: 'none' });
  });

  it('見積もりの手動の打数/秒: 標準はツルハシの前 2・後 2（自動掘り）、アクティブ 4、放置 0.3', () => {
    const before = stateWith({});
    const after = stateWith({ tool: 1 });
    expect(manualHitsPerSec(before, BOTS.standard)).toBe(2);
    expect(manualHitsPerSec(after, BOTS.standard)).toBe(2);
    expect(manualHitsPerSec(before, BOTS.active)).toBe(4);
    expect(manualHitsPerSec(after, BOTS.idle)).toBe(0.3);
  });

  it('放置ボットは自動掘りを使わず、毎秒 0.3 回タップする（10 分で約 180 回）', () => {
    const r = runBot(BOTS.idle, { hours: 10 / 60, stepMs: 1000, seed: 3 });
    expect(r.state.run.autoDig.on).toBe(false);
    expect(r.state.stats.taps).toBeGreaterThanOrEqual(175);
    expect(r.state.stats.taps).toBeLessThanOrEqual(181);
  });

  it('アクティブは最初から長押し、標準はツルハシの後に自動掘りをオンにする', () => {
    const a = runBot(BOTS.active, { hours: 1 / 60, stepMs: 1000, seed: 1 });
    expect(a.state.input.hold).toBe(true);
    const s = runBot(BOTS.standard, { hours: 1 / 60, stepMs: 1000, seed: 1 });
    expect(s.state.run.drill.tool).toBeGreaterThanOrEqual(1);
    expect(s.state.run.autoDig.on).toBe(true);
  });
});

describe('BL-031 買い方と枠（投資効率・収入が最大の組み合わせ）', () => {
  const allSets = (found: SpringId[], n: number): SpringId[][] => {
    if (n === 0) return [[]];
    if (found.length < n) return [];
    const [h, ...rest] = found as [SpringId, ...SpringId[]];
    return [...allSets(rest, n - 1).map((c) => [h, ...c]), ...allSets(rest, n)];
  };

  it('源泉 5 種・枠 4 つ: つなぐ集合は、5 通りの組み合わせのうち収入（掘削＋入湯料。泉質の効果・お客さんを含む）が最大のもの', () => {
    const s = stateWith({ bath: 35, pumps: { simple: 40, co2: 25, salt: 12, sulfur: 10, iron: 3 }, drill: 80, tool: 5, digger: 60, maxDepth: 420, autoOn: true });
    arrangeSlots(s, BOTS.standard);
    const chosen = new Set(s.run.bath.slots);
    const rateOf = (set: SpringId[]): number => {
      const t = cloneState(s);
      t.run.bath.slots = [...set];
      t.run.guests = computeGuests(t);
      return totalRate(t, BOTS.standard).toNumber();
    };
    const sets = allSets(SPRINGS.map((x) => x.id), 4);
    const best = Math.max(...sets.map(rateOf));
    expect(rateOf([...chosen].filter((x): x is SpringId => x !== null))).toBe(best);
    expect(new Set(s.run.bath.slots).size).toBe(4);
    expect(s.run.guests).toEqual(computeGuests(s));
  });

  it('つないである源泉はその枠に残す（見つけた源泉が枠の数以下なら全部つなぐ）', () => {
    const s = stateWith({ bath: 15, pumps: { simple: 3, co2: 3 } });
    s.run.bath.slots = [null, 'co2', null];
    arrangeSlots(s, BOTS.standard);
    expect(s.run.bath.slots[1]).toBe('co2');
    expect(s.run.bath.slots.filter((x) => x !== null).sort()).toEqual(['co2', 'simple']);
  });

  it('二酸化炭素泉のポンプ Lv9: Lv10 でニホンザル（威力 ×2）が来る分も見積もりに入れて、ポンプを選ぶ', () => {
    const s = stateWith({ bath: 5, pumps: { simple: 30, co2: 9 }, drill: 30, tool: 3, digger: 20, maxDepth: 100, autoOn: true });
    const q = buyQuote(s, 'pump:co2', 1);
    s.run.coins = q.cost; // ちょうどポンプ 1 つ分
    const lvBefore = s.run.springs.co2?.pump;
    botAct(s, BOTS.standard, newBotMemory());
    expect(s.run.springs.co2?.pump).toBe((lvBefore ?? 0) + 1);
    expect(s.run.guests).toContain('monkey');
  });

  it('見積もり（totalRate・canBuyAnything・候補の測定）は状態を変えない', () => {
    const s = stateWith({ bath: 35, coins: '1e6', pumps: { simple: 12, co2: 9, salt: 9 }, drill: 20, digger: 10, tool: 2, maxDepth: 160 });
    const h = stateHash(s);
    totalRate(s, BOTS.standard);
    canBuyAnything(s);
    expect(stateHash(s)).toBe(h);
    expect(s.run.guests).toEqual(computeGuests(s));
  });

  it('30 分の標準ボット: 判断のたびに、お客さんは条件どおり・枠に同じ源泉がない・レベルが買った分だけ増える', () => {
    const r = runBot(BOTS.standard, { hours: 0.5, stepMs: 1000, seed: 5 });
    const s = r.state;
    expect(s.run.guests).toEqual(computeGuests(s));
    const ids = s.run.bath.slots.filter((x) => x !== null);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.healthy).toBe(true);
  });

  it('手持ちで買えるものがなければ canBuyAnything は false（新しいゲーム）、ドリル 1 つ分あれば true', () => {
    expect(canBuyAnything(stateWith({}))).toBe(false);
    expect(canBuyAnything(stateWith({ coins: 5 }))).toBe(true);
    const items: LevelItem[] = ['drill', 'autoDigger', 'bath'];
    expect(items.some((i) => buyQuote(stateWith({ coins: 5 }), i, 1).state === 'affordable')).toBe(true);
  });
});
