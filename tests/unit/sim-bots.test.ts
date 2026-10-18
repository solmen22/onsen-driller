// BL-031・BL-032: シミュレーターのボット（gdd §8-2。標準・アクティブ・放置・安い順・ランダム）の単体テスト
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS, type SpringId } from '../../src/content/springs.ts';
import {
  autoDiggerHitsPerSec,
  bathIncomePerSec,
  blockHp,
  blockValue,
  buyQuote,
  cloneState,
  computeGuests,
  dispatch,
  drillPower,
  modifiers,
  nextTool,
  num,
  stateHash,
  type GameEvent,
  type GameState,
  type LevelItem,
  type Num,
} from '../../src/core/index.ts';
import { arrangeSlots, avgOre, botAct, BOTS, canBuyAnything, manualHitsPerSec, newBotMemory, totalRate } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';
import { stateWith } from '../support/states.ts';

describe('TS-032-12 BL-031 ボットの定義（gdd §8-2）', () => {
  it('TS-031-04 標準＝自動掘り（最初の強化の前は毎秒 2 タップ）・5 秒ごと、アクティブ＝長押し・2 秒ごと、放置＝毎秒 0.3 タップ・60 秒ごと', () => {
    expect(BOTS.standard).toMatchObject({ manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, rewards: 'ads' });
    expect(BOTS.active).toMatchObject({ manual: { kind: 'hold' }, buyEverySec: 2, rewards: 'ads' });
    expect(BOTS.idle).toMatchObject({ manual: { kind: 'taps', perSec: 0.3 }, buyEverySec: 60, rewards: 'none' });
  });

  it('TS-031-04 見積もりの手動の打数/秒: 標準はツルハシの前 2・後 2（自動掘り）、アクティブ 4、放置 0.3', () => {
    const before = stateWith({});
    const after = stateWith({ tool: 1 });
    expect(manualHitsPerSec(before, BOTS.standard)).toBe(2);
    expect(manualHitsPerSec(after, BOTS.standard)).toBe(2);
    expect(manualHitsPerSec(before, BOTS.active)).toBe(4);
    expect(manualHitsPerSec(after, BOTS.idle)).toBe(0.3);
  });

  it('TS-031-04 放置ボットは自動掘りを使わず、毎秒 0.3 回タップする（10 分で約 180 回）', () => {
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

  it('TS-031-03 源泉 5 種・枠 4 つ: つなぐ集合は、5 通りの組み合わせのうち収入（掘削＋入湯料。泉質の効果・お客さんを含む）が最大のもの', () => {
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

  it('TS-031-03 二酸化炭素泉のポンプ Lv9: Lv10 でニホンザル（威力 ×2）が来る分も見積もりに入れて、ポンプを選ぶ', () => {
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

  it('TS-031-06 30 分の標準ボット: 判断のたびに、お客さんは条件どおり・枠に同じ源泉がない・レベルが買った分だけ増える', () => {
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

describe('BL-032 安い順・ランダムのボット（gdd §8-2）', () => {
  it('TS-032-12 定義: 安い順＝標準と同じ打ち方・5 秒ごと・広告なし、ランダム＝毎秒 1 タップ・10 秒ごと・無作為', () => {
    expect(BOTS.cheapest).toMatchObject({ manual: { kind: 'autoDig', tapsBefore: 2 }, buyEverySec: 5, buy: 'cheapest', rewards: 'none' });
    expect(BOTS.random).toMatchObject({ manual: { kind: 'taps', perSec: 1 }, buyEverySec: 10, buy: 'random', rewards: 'random' });
    expect([BOTS.standard.buy, BOTS.active.buy, BOTS.idle.buy]).toEqual(['efficiency', 'efficiency', 'efficiency']);
  });

  it('TS-032-07 安い順: 1 回の判断で、買える間はそのつどいちばん安いもの（道具を含む）を買い、最安が買えなくなったら止まる', () => {
    const base = stateWith({ bath: 3, coins: '2e3', pumps: { simple: 3 }, drill: 5, digger: 2, tool: 1, maxDepth: 40 });
    const s = cloneState(base);
    const events: GameEvent[] = [];
    botAct(s, BOTS.cheapest, newBotMemory(), events);
    const bought = events.flatMap((e) => (e.type === 'Purchased' ? [e.item] : []));
    expect(bought.length).toBeGreaterThan(1);
    // 同じ買い物を写しで 1 つずつ再生し、買う直前の最安と一致するかを見る
    const r = cloneState(base);
    const cheapest = (): { item: string; affordable: boolean } => {
      const opts: { item: string; cost: Num; affordable: boolean }[] = [];
      const t = nextTool(r);
      if (t) opts.push({ item: 'tool', cost: num(t.cost), affordable: r.run.coins.gte(t.cost) });
      const items: LevelItem[] = ['drill', 'autoDigger', 'bath'];
      for (const id of r.run.bath.slots) if (id) items.push(`pump:${id}`);
      for (const item of items) {
        const q = buyQuote(r, item, 1);
        if (q.state !== 'locked' && q.state !== 'maxed') opts.push({ item, cost: q.cost, affordable: q.state === 'affordable' });
      }
      opts.sort((x, y) => x.cost.cmp(y.cost));
      const o = opts[0]!;
      return { item: o.item, affordable: o.affordable };
    };
    for (const item of bought) {
      expect(cheapest()).toEqual({ item, affordable: true });
      expect(dispatch(r, { type: 'buy', item, qty: 1 }).ok).toBe(true);
    }
    expect(r.run.coins.eq(s.run.coins)).toBe(true); // 買い物は同じ（自動掘りのスイッチ・枠は所持を変えない）
    expect(bought.length).toBeLessThan(40); // 上限（1 回の判断で 40）で止まったのではない
    expect(cheapest().affordable).toBe(false);
  });

  it('TS-032-06 ランダム: 同じシードなら同じ買い物、買えるものだけを買う（所持は負にならない）', () => {
    const base = stateWith({ bath: 3, coins: '5e4', pumps: { simple: 3 }, drill: 5, digger: 2, tool: 1, maxDepth: 90 });
    const run = (seed: number): string => {
      const s = cloneState(base);
      botAct(s, BOTS.random, newBotMemory(seed));
      expect(s.run.coins.gte(0)).toBe(true);
      return stateHash(s);
    };
    expect(run(3)).toBe(run(3));
    expect(new Set([1, 2, 3, 4, 5].map(run)).size).toBeGreaterThan(1);
  });
});

describe('ボットの収入の見積もりに鉱石の価値の倍率を入れる（硫黄泉・BL-018 の選鉱ざる・研磨台）', () => {
  /** 掘削の収入の期待値を core の式から直接組み立てる: 打数 × 威力 ÷ 硬さ × {(1−p) × 普通の価値 + p × 鉱石の価値} */
  const expectedDig = (s: GameState): number => {
    const m = modifiers(s);
    const d = s.run.depth;
    const p = PARAMS.block.oreChance;
    const hits = manualHitsPerSec(s, BOTS.standard) + autoDiggerHitsPerSec(s, m);
    const perBlock = blockValue(s, d, false, m).mul(1 - p).add(blockValue(s, d, true, m).mul(p));
    return drillPower(s, m).mul(hits).div(blockHp(s, d, m)).mul(perBlock).toNumber();
  };
  const digOf = (s: GameState): number => totalRate(s, BOTS.standard).sub(bathIncomePerSec(s, modifiers(s))).toNumber();

  it('avgOre: 1 + 出現率 × (8 × 鉱石の価値の倍率 − 1)。倍率 1 は従来の定数（1.42）、硫黄泉の ×2 で 1.9', () => {
    expect(PARAMS.block.oreChance).toBe(0.06);
    expect(PARAMS.block.oreMult).toBe(8);
    expect(avgOre(1)).toBeCloseTo(1.42, 12);
    expect(avgOre(2)).toBeCloseTo(1.9, 12);
  });

  it('硫黄泉をつないだ状態: totalRate の掘削の分は鉱石の価値 ×2 を入れた期待値と一致し、硫黄泉を外した状態の 1.9/1.42 倍', () => {
    const s = stateWith({ bath: 10, pumps: { simple: 8, sulfur: 5 }, drill: 40, tool: 3, digger: 20, depth: 260, maxDepth: 260, autoOn: true });
    expect(s.run.bath.slots).toContain('sulfur');
    expect(modifiers(s).oreValue).toBe(2);
    const withSulfur = digOf(s);
    expect(withSulfur / expectedDig(s)).toBeCloseTo(1, 9);

    const t = cloneState(s);
    t.run.bath.slots = t.run.bath.slots.map((x) => (x === 'sulfur' ? null : x));
    t.run.guests = computeGuests(t);
    expect(modifiers(t).oreValue).toBe(1);
    expect(digOf(t) / expectedDig(t)).toBeCloseTo(1, 9);
    expect(withSulfur / digOf(t)).toBeCloseTo(avgOre(2) / avgOre(1), 9);
  });
});
