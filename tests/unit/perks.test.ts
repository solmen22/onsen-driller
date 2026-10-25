// BL-022: 湯の華の木 12 ノード（gdd §5-8 の表）・取る・振り直し・周回の始めの効果・効果の式。
// TS-ID はテスト設計者のシナリオ（未作成。BL-022）が出たら付ける
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { PERK_BY_ID, PERKS, type PerkId } from '../../src/content/perks.ts';
import {
  bathIncomePerSec,
  buyQuote,
  cloneState,
  contentProblems,
  dispatch,
  drillPower,
  autoDiggerHitsPerSec,
  isOre,
  modifiers,
  num,
  offlineCapMs,
  offlineEfficiency,
  perkTreeView,
  prestigeView,
  runStartPreview,
  stateHash,
  yunohanaAvailable,
  yunohanaGain,
  type GameState,
} from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

const HOUR = 3_600_000;

/** 湯の華の累計 lifetime・木 perks（使った分はコストの合計）の状態 */
const withTree = (perks: PerkId[], lifetime = 258, spec: Parameters<typeof stateWith>[0] = {}): GameState => {
  const s = stateWith(spec);
  s.meta.yunohana.lifetime = num(lifetime);
  s.meta.perks = PERKS.filter((p) => perks.includes(p.id)).map((p) => p.id);
  s.meta.yunohana.spent = num(s.meta.perks.reduce((a, id) => a + PERK_BY_ID[id].cost, 0));
  return s;
};

describe('BL-022 木の定義（gdd §5-8 の表）', () => {
  it('3 系統 12 ノード、コストの合計 258、前提は表のとおり（「A か B」はどちらか一方）', () => {
    expect(PERKS).toHaveLength(12);
    expect(PERKS.reduce((a, p) => a + p.cost, 0)).toBe(258);
    const row = (id: PerkId): [string, number, readonly string[]] => [PERK_BY_ID[id].branch, PERK_BY_ID[id].cost, PERK_BY_ID[id].requiresAny];
    expect(PERKS.map((p) => p.id).map(row)).toEqual([
      ['dig', 5, []],
      ['dig', 10, ['sharpBlade']],
      ['dig', 15, ['sharpBlade']],
      ['dig', 40, ['nightDig', 'heirloomPick']],
      ['inn', 5, []],
      ['inn', 15, ['yumori']],
      ['inn', 20, ['yumori']],
      ['inn', 60, ['carpenter']],
      ['guest', 3, []],
      ['guest', 10, ['travelFunds']],
      ['guest', 25, ['travelFunds']],
      ['guest', 50, ['loupe', 'regulars']],
    ]);
    expect(contentProblems()).toEqual([]);
  });
});

describe('BL-022 ノードを取る（takePerk）', () => {
  it('前提のないノードは取れる。使える湯の華から払い、累計は減らない（全生産の倍率も同じ）。PerkTaken を出す', () => {
    const s = withTree([], 20);
    const mult = prestigeView(s).multNow.toNumber();
    const r = dispatch(s, { type: 'takePerk', perk: 'sharpBlade' });
    expect(r).toEqual({ ok: true, events: [{ type: 'PerkTaken', perk: 'sharpBlade', cost: 5 }] });
    expect([s.meta.perks, s.meta.yunohana.lifetime.toNumber(), s.meta.yunohana.spent.toNumber(), yunohanaAvailable(s).toNumber()]).toEqual([['sharpBlade'], 20, 5, 15]);
    expect(prestigeView(s).multNow.toNumber()).toBe(mult);
  });

  it('前提を満たさない（locked）・湯の華が足りない（insufficient）・取った（maxed）・知らない ID（invalid）は取れず、状態は変わらない', () => {
    const s = withTree(['sharpBlade'], 14);
    const before = stateHash(s);
    expect(dispatch(s, { type: 'takePerk', perk: 'shortcut' }).reason).toBe('locked');
    expect(dispatch(s, { type: 'takePerk', perk: 'heirloomPick' }).reason).toBe('insufficient'); // 使える 9 < 15
    expect(dispatch(s, { type: 'takePerk', perk: 'sharpBlade' }).reason).toBe('maxed');
    for (const bad of ['grip', '__proto__', 1, null, undefined]) expect(dispatch(s, { type: 'takePerk', perk: bad }).reason).toBe('invalid');
    expect(stateHash(s)).toBe(before);
  });

  it('「A か B」: 近道の坑道は、夜なべ掘りか形見のツルハシのどちらか一方で取れる。湯の華の目利きはルーペか常連さんのどちらかで取れる', () => {
    for (const via of ['nightDig', 'heirloomPick'] as const) {
      const s = withTree(['sharpBlade', via], 200);
      expect(dispatch(s, { type: 'takePerk', perk: 'shortcut' }).ok, via).toBe(true);
    }
    for (const via of ['loupe', 'regulars'] as const) {
      const s = withTree(['travelFunds', via], 200);
      expect(dispatch(s, { type: 'takePerk', perk: 'connoisseur' }).ok, via).toBe(true);
    }
  });

  it('perkTreeView: 取った・取れる・湯の華が足りない・前提なしの状態と、使える湯の華を返す（UI は式を持たない）', () => {
    const v = perkTreeView(withTree(['sharpBlade'], 18))!;
    const st = Object.fromEntries(v.nodes.map((n) => [n.id, n.state]));
    expect(st).toMatchObject({ sharpBlade: 'owned', nightDig: 'available', heirloomPick: 'insufficient', shortcut: 'locked', yumori: 'available', famousSpring: 'locked' });
    expect([v.available.toNumber(), v.spent.toNumber()]).toEqual([13, 5]);
    // いつ効くか: 周回の始めの効果だけのノードは「次の周回から」
    const from = Object.fromEntries(v.nodes.map((n) => [n.id, n.appliesFrom]));
    expect(Object.entries(from).filter(([, f]) => f === 'nextRun').map(([id]) => id)).toEqual(['heirloomPick', 'shortcut', 'travelFunds']);
  });

  it('perkTreeView(s, plan): 振り直しの途中の木を、転生した後の累計を予算にして見る。正しくない plan は null', () => {
    const s = withTree(['sharpBlade', 'nightDig'], 15, { depth: 300 }); // 得る 36 → 予算 51
    const v = perkTreeView(s, ['yumori', 'carpenter'])!;
    expect([v.spent.toNumber(), v.available.toNumber()]).toEqual([20, 31]);
    const st = Object.fromEntries(v.nodes.map((n) => [n.id, n.state]));
    expect(st).toMatchObject({ sharpBlade: 'available', nightDig: 'locked', yumori: 'owned', carpenter: 'owned', banto: 'available', famousSpring: 'insufficient' });
    expect(perkTreeView(s, ['nightDig'])).toBeNull();
    expect(perkTreeView(s, ['yumori', 'carpenter', 'famousSpring'])).toBeNull(); // 80 > 51
  });
});

describe('BL-022 転生で木を振り直す（無料。使った分が全部戻る）', () => {
  it('perks を渡すと、転生で得る分を足した累計の範囲で選び直す。使った分は選んだノードの合計。累計は減らない', () => {
    const s = withTree(['sharpBlade', 'nightDig'], 15, { depth: 300 }); // 36 を得る → 累計 51
    const r = dispatch(s, { type: 'prestige', perks: ['yumori', 'carpenter', 'banto'] });
    expect(r.ok).toBe(true);
    expect([s.meta.perks, s.meta.yunohana.spent.toNumber(), s.meta.yunohana.lifetime.toNumber()]).toEqual([['yumori', 'carpenter', 'banto'], 40, 51]);
  });

  it('空の木に振り直せる（全部戻る）。perks を渡さなければ今の木のまま', () => {
    const a = withTree(['sharpBlade', 'nightDig'], 15, { depth: 300 });
    dispatch(a, { type: 'prestige', perks: [] });
    expect([a.meta.perks, a.meta.yunohana.spent.toNumber()]).toEqual([[], 0]);
    const b = withTree(['sharpBlade', 'nightDig'], 15, { depth: 300 });
    dispatch(b, { type: 'prestige' });
    expect([b.meta.perks, b.meta.yunohana.spent.toNumber()]).toEqual([['sharpBlade', 'nightDig'], 15]);
  });

  it('正しくない木（知らない ID・重複・前提なし・湯の華が足りない・配列でない）なら invalid で、転生もしない（状態は 1 ビットも変わらない）', () => {
    for (const bad of [['grip'], ['sharpBlade', 'sharpBlade'], ['nightDig'], ['yumori', 'carpenter', 'famousSpring'], 'sharpBlade', [1]]) {
      const s = withTree([], 0, { depth: 300 }); // 得る 36。famousSpring まで 80 は足りない
      const before = stateHash(s);
      expect(dispatch(s, { type: 'prestige', perks: bad }), JSON.stringify(bad)).toEqual({ ok: false, reason: 'invalid', events: [] });
      expect(stateHash(s)).toBe(before);
    }
  });

  it('並びは定義の順に直す（渡した順によらない）', () => {
    const s = withTree([], 100, { depth: 300 });
    dispatch(s, { type: 'prestige', perks: ['regulars', 'travelFunds', 'yumori'] });
    expect(s.meta.perks).toEqual(['yumori', 'travelFunds', 'regulars']);
  });
});

describe('BL-022 周回の始めの効果（転生の直後）', () => {
  it('旅の支度金: 500 コインから。形見のツルハシ: 道具は手掘りやぐら（index 2）から、自動掘りのスイッチも使える', () => {
    const s = withTree(['sharpBlade', 'heirloomPick', 'travelFunds'], 100, { depth: 200 });
    dispatch(s, { type: 'prestige' });
    expect([s.run.coins.toNumber(), s.run.drill.tool, s.run.depth]).toEqual([500, 2, 0]);
    expect(dispatch(s, { type: 'setAutoDig', on: true }).ok).toBe(true);
  });

  it('近道の坑道: 深さ＝前の周回の最深 × 25%（切り捨て）。途中の源泉は発見済み（ポンプ Lv1・枠）、途中の帯は幕間なしで入ったことにする', () => {
    const s = withTree(['sharpBlade', 'nightDig', 'shortcut'], 100, { depth: 650 });
    const r = dispatch(s, { type: 'prestige' });
    expect(r.ok).toBe(true);
    expect([s.run.depth, s.run.maxDepth, s.run.startDepth]).toEqual([162, 162, 162]);
    expect(Object.keys(s.run.springs).sort()).toEqual(['co2', 'salt', 'simple']); // 30・80・150m
    expect(s.run.springs.salt).toEqual({ pump: 1 });
    expect(s.run.bath.slots).toEqual(['simple']); // 湯船 Lv0 は 1 枠
    expect(s.run.stratumSeen).toEqual([0, 1, 2, 3]);
    expect(s.run.interludeMs).toBe(0);
    expect(r.events.some((e) => e.type === 'SpringFound' || e.type === 'StratumEntered')).toBe(false);
  });

  it('前の周回の最深 160m → 40m から（切り捨て）。近道がなければ 0m から', () => {
    const t = withTree(['sharpBlade', 'nightDig', 'shortcut'], 100, { depth: 161 });
    dispatch(t, { type: 'prestige' });
    expect(t.run.startDepth).toBe(40); // 161 × 0.25 = 40.25
    const u = withTree(['sharpBlade', 'nightDig'], 100, { depth: 161 });
    dispatch(u, { type: 'prestige' });
    expect([u.run.startDepth, u.run.depth]).toEqual([0, 0]);
  });
});

describe('BL-022 次の周回の始めの見込み（確認の画面）と実際が同じ', () => {
  it('木の組み合わせ・前の最深をいろいろ変えても、runStartPreview（振り直した木でも）と転生した後の周回の始めが一致する', () => {
    const sets: PerkId[][] = [[], ['travelFunds'], ['sharpBlade', 'heirloomPick'], ['sharpBlade', 'nightDig', 'shortcut'], ['sharpBlade', 'heirloomPick', 'shortcut', 'travelFunds']];
    for (const depth of [150, 161, 399, 650, 2000])
      for (const now of sets)
        for (const plan of [undefined, ...sets]) {
          const s = withTree(now, 300, { depth });
          s.collection.guestsSeen = { tanuki: 1, monkey: 1, capybara: 1, fox: 1, cat: 1, redPanda: 1 };
          const pv = runStartPreview(s, plan ?? s.meta.perks);
          const r = dispatch(s, plan === undefined ? { type: 'prestige' } : { type: 'prestige', perks: plan });
          expect(r.ok).toBe(true);
          expect([s.run.startDepth, s.run.coins.toNumber(), s.run.drill.tool], `${depth} ${now.join()} → ${plan?.join() ?? '-'}`).toEqual([pv.depth, pv.coins, pv.tool]);
        }
  });
});

describe('BL-022・TS-021-20・21（近道あり）二重の転生を防ぐ', () => {
  it('前の最深 800m → 200m から始まる周回でも、同じステップの 2 回目の転生は locked。始めの深さより 1m 掘るまで転生できない', () => {
    const s = withTree(['sharpBlade', 'nightDig', 'shortcut'], 100, { depth: 800, tool: 1 });
    s.meta.tickets = 0;
    s.collection.guestsSeen = { tanuki: 1 }; // 近道で源泉が見つかってタヌキが来ても、初来訪のチケットは入らない（ここでは転生の分だけ数える）
    const r1 = dispatch(s, { type: 'prestige' });
    const r2 = dispatch(s, { type: 'prestige' });
    expect(r1.ok).toBe(true);
    expect(r2).toEqual({ ok: false, reason: 'locked', events: [] });
    expect([s.meta.prestiges, s.meta.tickets]).toEqual([1, 2]);
    expect([s.run.startDepth, s.run.maxDepth]).toEqual([200, 200]);
    const v = prestigeView(s);
    expect([v.canPrestige, v.metersToUnlock, v.gain.toNumber(), v.nextGainDepth, v.metersToNextGain]).toEqual([false, 1, 0, 201, 1]);
    // 1m 掘り進めると、周回の最深 201m で転生できる（floor((201/50)²) = 16）
    s.run.depth = 201;
    s.run.maxDepth = 201;
    expect(yunohanaGain(s).toNumber()).toBe(16);
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
  });
});

describe('BL-022 TS-021-15（周回の始めに収入がある）転生のチケットのあふれはコインにしない（N-1）', () => {
  it('近道で源泉が発見済み・旅の支度金ありの始まりでも、チケット 10 枚の転生でコインは支度金の 500 ちょうど・累計のコインは変わらない', () => {
    const s = withTree(['sharpBlade', 'nightDig', 'shortcut', 'travelFunds'], 100, { depth: 800 });
    s.meta.tickets = 10;
    s.collection.guestsSeen = { tanuki: 1 }; // 初来訪のチケット（今までの規則でコインになる）を混ぜない
    const total = s.stats.totalCoins.toString();
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(bathIncomePerSec(s).gt(0)).toBe(true); // 新しい周回の始めから収入がある
    expect(s.run.coins.toNumber()).toBe(500);
    expect(s.stats.totalCoins.toString()).toBe(total);
    expect(s.meta.tickets).toBe(10);
  });
});

describe('BL-022 転生のチケットが先（確認の画面で伝えた枚数を守る）', () => {
  it('チケット 9 枚で、近道で見つけた源泉にタヌキが初めて来ても、転生の +1 が先に入り、初来訪の分があふれる', () => {
    const s = withTree(['sharpBlade', 'nightDig', 'shortcut'], 100, { depth: 800 });
    s.meta.tickets = 9;
    expect(prestigeView(s).ticketsAdded).toBe(1);
    const r = dispatch(s, { type: 'prestige' });
    const tickets = r.events.filter((e) => e.type === 'TicketGained');
    expect(tickets.map((e) => e.type === 'TicketGained' && [e.source, e.n])).toEqual([
      ['prestige', 1],
      ['guestFirstVisit', 0],
    ]);
    expect(s.meta.tickets).toBe(10);
  });
});

describe('BL-022 効果の式', () => {
  const base = (spec: Parameters<typeof stateWith>[0] = {}): GameState => withTree([], 0, { depth: 120, drill: 10, tool: 2, digger: 5, bath: 5, pumps: { simple: 10, co2: 10 }, ...spec });
  const with_ = (perks: PerkId[]): GameState => {
    const s = cloneState(base());
    s.meta.perks = PERKS.filter((p) => perks.includes(p.id)).map((p) => p.id);
    return s;
  };

  it('研いだ刃 ドリル威力 ×2・夜なべ掘り 自動掘削 ×2・湯守の心得 入湯料 ×2・名湯の評判 さらに ×4（重なって ×8）', () => {
    const b = base();
    expect(drillPower(with_(['sharpBlade'])).div(drillPower(b)).toNumber()).toBeCloseTo(2, 10);
    expect(autoDiggerHitsPerSec(with_(['sharpBlade', 'nightDig'])) / autoDiggerHitsPerSec(b)).toBeCloseTo(2, 10);
    expect(bathIncomePerSec(with_(['yumori'])).div(bathIncomePerSec(b)).toNumber()).toBeCloseTo(2, 10);
    expect(bathIncomePerSec(with_(['yumori', 'carpenter', 'famousSpring'])).div(bathIncomePerSec(b)).toNumber()).toBeCloseTo(8, 10);
  });

  it('大工の顔なじみ: ポンプと湯船のコスト ×0.9（×1・×10 とも）。ドリルのコストは変わらない', () => {
    const b = base();
    const c = with_(['yumori', 'carpenter']);
    for (const item of ['bath', 'pump:simple', 'pump:co2'] as const)
      for (const q of [1, 10] as const) expect(buyQuote(c, item, q).cost.div(buyQuote(b, item, q).cost).toNumber(), `${item} ×${q}`).toBeCloseTo(0.9, 10);
    expect(buyQuote(c, 'drill', 1).cost.toString()).toBe(buyQuote(b, 'drill', 1).cost.toString());
  });

  it('留守番の番頭: オフライン効率 50% → 100%（塩化物泉と重なっても 100%）、上限 8 → 12 時間', () => {
    expect([offlineEfficiency(base()), offlineCapMs(base())]).toEqual([0.5, 8 * HOUR]);
    const s = with_(['yumori', 'banto']);
    expect([offlineEfficiency(s), offlineCapMs(s)]).toEqual([1, 12 * HOUR]);
  });

  it('目利きのルーペ: 鉱石の出現 6% → 10%（5m 以降の 2 万ブロックの割合）。0〜4m は鉱石にしないまま', () => {
    const count = (s: GameState): number => {
      let n = 0;
      for (let d = 5; d < 20_005; d++) if (isOre(s, d)) n++;
      return n / 20_000;
    };
    expect(count(base())).toBeCloseTo(0.06, 2);
    const s = with_(['travelFunds', 'loupe']);
    expect(count(s)).toBeCloseTo(0.1, 2);
    for (let d = 0; d < PARAMS.block.oreFreeDepth; d++) expect(isOre(s, d)).toBe(false);
  });

  it('常連さん: お客さんの効果の上乗せの部分 ×1.5（タヌキの入湯料 ×1.5 → ×1.75）', () => {
    const b = base();
    expect(b.run.guests).toContain('tanuki');
    expect(modifiers(with_(['travelFunds', 'regulars'])).incomeAll / modifiers(b).incomeAll).toBeCloseTo(1.75 / 1.5, 10);
  });

  it('湯の華の目利き（Q-47 (h)）: 最終＝floor(基本 × 1.5)。表示は基本と上乗せに分け、足し算が合う。前回の獲得は最終の量で記録する', () => {
    const s = withTree(['travelFunds', 'loupe', 'connoisseur'], 100, { depth: 300 }); // 基本 36 → 54
    const v = prestigeView(s);
    expect([v.gain.toNumber(), v.gainBase, v.gainBonus]).toEqual([54, 36, 18]);
    const t = withTree(['travelFunds', 'loupe', 'connoisseur'], 100, { depth: 159 }); // 基本 10 → 15
    expect([prestigeView(t).gainBase, prestigeView(t).gainBonus]).toEqual([10, 5]);
    const odd = withTree(['travelFunds', 'loupe', 'connoisseur'], 100, { depth: 158 }); // 基本 9 → floor(13.5) = 13
    expect([prestigeView(odd).gain.toNumber(), prestigeView(odd).gainBase, prestigeView(odd).gainBonus]).toEqual([13, 9, 4]);
    dispatch(s, { type: 'prestige' });
    expect([s.meta.lastPrestigeGain.toNumber(), s.meta.yunohana.lifetime.toNumber()]).toEqual([54, 154]);
  });

  it('「あと 〇m で +1」は基本の量で数える（目利きがあっても基本が 1 増えれば最終も 1 以上増える）', () => {
    const s = withTree(['travelFunds', 'loupe', 'connoisseur'], 100, { depth: 158 });
    const v = prestigeView(s);
    expect([v.nextGainDepth, v.metersToNextGain]).toEqual([159, 1]);
    s.run.maxDepth = 159;
    expect(yunohanaGain(s).toNumber()).toBeGreaterThan(v.gain.toNumber());
  });
});
