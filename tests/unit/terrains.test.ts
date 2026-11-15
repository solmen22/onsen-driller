// BL-024: 地形 3 種（火山のふもと・海辺の追加）と転生での選択（gdd §5-8）。
// CEO 承認（2026-11-15）: n 回目の転生の確認の画面で、解放の回数 n の地形を行き先に選べる／標準ボットは今の地形の次から定義の順に回す／
// 海辺の塩化物泉は ×0.7。解放済みかは保存された一覧か転生の回数で決める（読み込みで補正しない）
import { describe, expect, it } from 'vitest';
import { SPRINGS } from '../../src/content/springs.ts';
import { INITIAL_TERRAIN, TERRAIN_BY_ID, TERRAIN_IDS, TERRAINS, type TerrainId } from '../../src/content/terrains.ts';
import {
  applyGrant,
  blockHp,
  blockValue,
  buyQuote,
  bathIncomePerSec,
  cloneState,
  contentProblems,
  createInitialState,
  dispatch,
  modifiers,
  springDepth,
  springDepthIn,
  springViews,
  step,
  terrainChoices,
  unlockedTerrains,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { botTerrain } from '../../tools/sim/bots.ts';
import { stateWith } from '../support/states.ts';

/** 転生できる状態（この周回の最深 200m）。地形と転生の回数を指定する */
function ready(terrain: TerrainId = INITIAL_TERRAIN, prestiges = 0): GameState {
  const s = stateWith({ seed: 3, depth: 200 });
  s.run.terrain = terrain;
  s.meta.prestiges = prestiges;
  return s;
}

const onTerrain = (terrain: TerrainId, depth = 0): GameState => {
  const s = stateWith({ seed: 5, depth });
  s.run.terrain = terrain;
  return s;
};

describe('BL-024 地形の定義（content/terrains.ts）', () => {
  it('山あい（初期）・火山のふもと（転生 1 回で解放）・海辺（転生 2 回で解放）があり、内容定義の検査に問題がない', () => {
    expect(TERRAINS.map((t) => [t.id, t.unlockPrestiges])).toEqual([
      ['mountain', 0],
      ['volcano', 1],
      ['seaside', 2],
    ]);
    expect(TERRAINS.map((t) => t.nameKey)).toEqual(TERRAIN_IDS.map((id) => `terrain.${id}`));
    expect(contentProblems()).toEqual([]);
  });

  it('源泉の深さ: 火山は硫黄泉・含鉄泉 ×0.7（175m・280m）、海辺は塩化物泉 ×0.7（105m）。ほかは山あいと同じ。浅い順は同じ', () => {
    const table = Object.fromEntries(TERRAIN_IDS.map((t) => [t, SPRINGS.map((sp) => springDepthIn(t, sp.id))]));
    expect(table).toEqual({
      mountain: [30, 80, 150, 250, 400],
      volcano: [30, 80, 150, 175, 280],
      seaside: [30, 80, 105, 250, 400],
    });
    for (const t of TERRAIN_IDS) expect([...table[t]!].sort((a, b) => a - b)).toEqual(table[t]);
  });

  it('効果: 火山は硬さ ×1.3・鉱石の価値 ×1.5、海辺は硬さ ×0.8・入湯料 ×0.8、山あいはなし（modifiers の初期値に掛かる）', () => {
    const m = (t: TerrainId) => {
      const x = modifiers(onTerrain(t));
      return [x.hardness, x.oreValue, x.incomeAll];
    };
    expect(m('mountain')).toEqual([1, 1, 1]);
    expect(m('volcano')).toEqual([1.3, 1.5, 1]);
    expect(m('seaside')).toEqual([0.8, 1, 0.8]);
  });
});

describe('BL-024 地形の効果が式に効く', () => {
  it('ブロックの HP: 火山 ×1.3・海辺 ×0.8（山あいとの比）', () => {
    for (const d of [0, 57, 333]) {
      const base = blockHp(onTerrain('mountain'), d);
      expect(blockHp(onTerrain('volcano'), d).div(base).toNumber()).toBeCloseTo(1.3, 12);
      expect(blockHp(onTerrain('seaside'), d).div(base).toNumber()).toBeCloseTo(0.8, 12);
    }
  });

  it('ブロックの価値: 火山は鉱石だけ ×1.5（ふつうのブロックは同じ）', () => {
    const mo = onTerrain('mountain');
    const vo = onTerrain('volcano');
    expect(blockValue(vo, 120, false).eq(blockValue(mo, 120, false))).toBe(true);
    expect(blockValue(vo, 120, true).div(blockValue(mo, 120, true)).toNumber()).toBeCloseTo(1.5, 12);
  });

  it('入湯料: 海辺は ×0.8（同じ枠・ポンプ）', () => {
    const mk = (t: TerrainId) => {
      const s = stateWith({ seed: 5, depth: 160, pumps: { simple: 12, co2: 5 }, bath: 5 });
      s.run.terrain = t;
      return bathIncomePerSec(s);
    };
    expect(mk('seaside').div(mk('mountain')).toNumber()).toBeCloseTo(0.8, 12);
    expect(mk('volcano').eq(mk('mountain'))).toBe(true);
  });
});

describe('BL-024 源泉の深さを読むところは今の地形の深さ', () => {
  it('火山: 含鉄泉は 280m で見つかり、SpringFound の depth も 280。山あいでは 280m では見つからない', () => {
    for (const t of ['volcano', 'mountain'] as const) {
      const s = onTerrain(t, 279);
      for (const id of ['simple', 'co2', 'salt', 'sulfur'] as const) s.run.springs[id] = { pump: 1 };
      s.run.drill.level = 200;
      s.run.drill.tool = 7;
      const out: GameEvent[] = [];
      while (s.run.depth < 281) {
        out.push(...dispatch(s, { type: 'tap' }).events);
        step(s, 200, out);
      }
      const found = out.filter((e) => e.type === 'SpringFound');
      if (t === 'volcano') {
        expect(found).toEqual([{ type: 'SpringFound', spring: 'iron', depth: 280 }]);
        expect(s.run.springs.iron).toEqual({ pump: 1 });
      } else {
        expect(found).toEqual([]);
        expect(s.run.springs.iron).toBeUndefined();
      }
    }
  });

  it('海辺: 塩化物泉は 105m（山あいの 150m より浅い）', () => {
    const s = onTerrain('seaside', 104);
    s.run.springs = { simple: { pump: 1 }, co2: { pump: 1 } };
    s.run.drill.level = 100;
    s.run.drill.tool = 5;
    const out: GameEvent[] = [];
    while (s.run.depth < 106) {
      out.push(...dispatch(s, { type: 'tap' }).events);
      step(s, 200, out);
    }
    expect(out.filter((e) => e.type === 'SpringFound')).toEqual([{ type: 'SpringFound', spring: 'salt', depth: 105 }]);
  });

  it('表示: 源泉の一覧の深さ・ポンプの見積もりの解放の深さ・springDepth は今の地形のもの', () => {
    const s = onTerrain('volcano', 10);
    expect(springViews(s).map((v) => v.depth)).toEqual([30, 80, 150, 175, 280]);
    expect(buyQuote(s, 'pump:iron', 1)).toMatchObject({ state: 'locked', unlockDepth: 280 });
    expect(buyQuote(s, 'pump:sulfur', 1)).toMatchObject({ state: 'locked', unlockDepth: 175 });
    expect(springDepth(s, 'iron')).toBe(280);
    s.run.terrain = 'seaside';
    expect(buyQuote(s, 'pump:salt', 1)).toMatchObject({ state: 'locked', unlockDepth: 105 });
  });

  it('テスト用フックの深さの付与: 今の地形の深さ以下の源泉を発見済みにする（火山 300m で含鉄泉まで、山あいでは硫黄泉まで）', () => {
    const v = createInitialState(9);
    v.run.terrain = 'volcano';
    applyGrant(v, { depth: 300 });
    expect(Object.keys(v.run.springs).sort()).toEqual(['co2', 'iron', 'salt', 'simple', 'sulfur']);
    const m = createInitialState(9);
    applyGrant(m, { depth: 300 });
    expect(Object.keys(m.run.springs).sort()).toEqual(['co2', 'salt', 'simple', 'sulfur']);
  });
});

describe('BL-024 転生で地形を選ぶ', () => {
  it('1 回目の転生: 火山のふもとを選べる（この転生で解放）。海辺は locked で、状態を変えない', () => {
    const s = ready('mountain', 0);
    const before = cloneState(s);
    expect(dispatch(s, { type: 'prestige', terrain: 'seaside' })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(s).toEqual(before);
    const r = dispatch(s, { type: 'prestige', terrain: 'volcano' });
    expect(r.ok).toBe(true);
    expect(s.run.terrain).toBe('volcano');
    expect(s.meta.prestiges).toBe(1);
    expect(s.meta.terrainsUnlocked).toEqual(['mountain', 'volcano']);
  });

  it('2 回目の転生: 海辺を選べる。解放済みの一覧に書き足す', () => {
    const s = ready('volcano', 1);
    s.meta.terrainsUnlocked = ['mountain', 'volcano'];
    expect(dispatch(s, { type: 'prestige', terrain: 'seaside' }).ok).toBe(true);
    expect(s.run.terrain).toBe('seaside');
    expect(s.meta.terrainsUnlocked).toEqual(['mountain', 'volcano', 'seaside']);
  });

  it('地形を渡さなければ今の地形のまま（解放されていない地形の周回でも転生できる）。知らない地形・型違いは invalid で状態を変えない', () => {
    const s = ready('seaside', 0); // 手で書き換えたセーブ（解放されていない地形の周回）
    const before = cloneState(s);
    for (const bad of ['desert', '', 3, null, 'Volcano'])
      expect(dispatch(s, { type: 'prestige', terrain: bad })).toEqual({ ok: false, reason: 'invalid', events: [] });
    expect(s).toEqual(before);
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.run.terrain).toBe('seaside');
  });

  it('近道の坑道: 新しい周回の地形の深さで途中の源泉を発見済みにする（SpringFound なし）。前の最深 1200m → 300m から', () => {
    const go = (terrain: TerrainId) => {
      const s = ready('mountain', 1);
      s.run.maxDepth = 1200;
      s.meta.yunohana.lifetime = s.meta.yunohana.lifetime.add(1000);
      for (const p of ['sharpBlade', 'nightDig', 'shortcut'] as const) expect(dispatch(s, { type: 'takePerk', perk: p }).ok).toBe(true);
      const r = dispatch(s, { type: 'prestige', terrain });
      expect(r.ok).toBe(true);
      expect(r.events.some((e) => e.type === 'SpringFound')).toBe(false);
      expect(s.run.startDepth).toBe(300);
      return Object.keys(s.run.springs).sort();
    };
    expect(go('volcano')).toEqual(['co2', 'iron', 'salt', 'simple', 'sulfur']);
    expect(go('mountain')).toEqual(['co2', 'salt', 'simple', 'sulfur']);
  });

  it('転生の画面の地形の選択（terrainChoices）: 選べるか・今の地形・あと何回の転生で選べるか・源泉の深さ', () => {
    const s = ready('mountain', 0);
    expect(terrainChoices(s).map((c) => [c.id, c.selectable, c.current, c.prestigesLeft])).toEqual([
      ['mountain', true, true, 0],
      ['volcano', true, false, 0],
      ['seaside', false, false, 1],
    ]);
    expect(terrainChoices(s)[1]?.springDepths).toEqual({ simple: 30, co2: 80, salt: 150, sulfur: 175, iron: 280 });
    expect(terrainChoices(s)[2]?.effects).toBe(TERRAIN_BY_ID.seaside.effects);
    s.meta.prestiges = 1;
    expect(terrainChoices(s).every((c) => c.selectable)).toBe(true);
  });
});

describe('BL-024 解放済みの地形は、保存された一覧か転生の回数で決める（読み込みで補正しない）', () => {
  it('版 2 までのセーブ（転生 2 回・一覧は山あいだけ）: 補正なしで読め、3 種とも解放済み', () => {
    const s = createInitialState(4);
    s.meta.prestiges = 2;
    s.meta.terrainsUnlocked = ['mountain'];
    const r = decodeSave(encodeSave(s, 1, 1_790_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toEqual([]);
    expect(r.state.meta.terrainsUnlocked).toEqual(['mountain']);
    expect(unlockedTerrains(r.state)).toEqual(['mountain', 'volcano', 'seaside']);
  });

  it('保存された一覧にあれば、回数が足りなくても解放済み（今後、回数でない解放の条件を足せる）', () => {
    const s = createInitialState(4);
    s.meta.terrainsUnlocked = ['mountain', 'seaside'];
    expect(unlockedTerrains(s)).toEqual(['mountain', 'seaside']);
  });
});

describe('BL-024 標準ボットの地形（gdd §8-2: 解放された順。CEO 承認 2026-11-15）', () => {
  it('今の地形の次から定義の順に回る: 山あい → 火山 → 海辺 → 山あい。選べるものだけ', () => {
    expect(botTerrain(ready('mountain', 0))).toBe('volcano');
    expect(botTerrain(ready('volcano', 1))).toBe('seaside');
    expect(botTerrain(ready('seaside', 2))).toBe('mountain');
    expect(botTerrain(ready('volcano', 0))).toBe('mountain'); // 海辺はまだ選べない
  });

});
