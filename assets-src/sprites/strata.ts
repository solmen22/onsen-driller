// 地層タイル 6 帯 × 4 種の変化形（16×16。gdd §14-2。BL-036）。
// 帯 1〜4 は tiles.ts の手で打った画素配列をもとに、帯 5（花崗岩）・6（玄武岩）はここで画素を置いて作る。
// 変化形は「横にずらす・左右を反転・粒を足す」で作る（どれも 1 枚でつながる。決まった擬似乱数なので毎回同じ絵）
import { Grid, type PaletteName, type SpriteDef } from '../lib.ts';
import { tileClay, tileSandstone, tileTopsoil, tileTuff } from './tiles.ts';

const S = 16;

/** 素材の生成だけに使う決まった擬似乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gridOf(def: SpriteDef): Grid {
  const g = new Grid(def.w, def.h);
  def.rows.forEach((row, y) => [...row].forEach((ch, x) => g.set(x, y, ch === '.' ? null : (def.key[ch] ?? null))));
  return g;
}

function copy(src: Grid, map: (x: number, y: number) => [number, number]): Grid {
  const g = new Grid(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const [sx, sy] = map(x, y);
      g.set(x, y, src.get(((sx % S) + S) % S, ((sy % S) + S) % S));
    }
  return g;
}

/** 粒を n 個置く（1 画素か 2 画素の横長） */
function specks(g: Grid, r: () => number, n: number, colors: PaletteName[]): Grid {
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    const c = colors[Math.floor(r() * colors.length)] ?? colors[0];
    if (!c) continue;
    g.set(x, y, c);
    if (r() < 0.4) g.set((x + 1) % S, y, c);
  }
  return g;
}

/** 花崗岩（桃・灰の斑）: 灰色の地に、桃色・白・濃い灰の斑 */
function granite(): Grid {
  const r = rng(0x6a2e);
  const g = new Grid(S, S).rect(0, 0, S, S, 'steamDark');
  specks(g, r, 40, ['metal', 'metal', 'steamMid']);
  // 桃色の長石の斑（2×2 前後のかたまり）
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * S);
    const y = Math.floor(r() * S);
    g.set(x, y, 'clayLight').set((x + 1) % S, y, 'clayLight').set(x, (y + 1) % S, r() < 0.5 ? 'clayLight' : 'cream');
  }
  specks(g, r, 10, ['metalDark', 'ink']);
  return g;
}

/** 玄武岩（黒・赤の筋）: 暗い地に、赤い筋が斜めに走る */
function basalt(): Grid {
  const r = rng(0xba5a);
  const g = new Grid(S, S).rect(0, 0, S, S, 'metalDark');
  specks(g, r, 45, ['ink', 'ink', 'soilDark']);
  // 赤い筋（横に長く、1 行ずつずれる。端でつながる）
  for (const [y0, len] of [
    [3, 7],
    [10, 9],
  ] as const) {
    const x0 = Math.floor(r() * S);
    for (let i = 0; i < len; i++) {
      const x = (x0 + i) % S;
      const y = (y0 + Math.floor(i / 3)) % S;
      g.set(x, y, i % 4 === 0 ? 'clayDark' : 'red');
    }
  }
  specks(g, r, 6, ['metal']);
  return g;
}

const BASES: [id: string, base: () => Grid, speck: PaletteName[]][] = [
  ['topsoil', () => gridOf(tileTopsoil), ['soilDark', 'soilLight', 'sand']],
  ['clay', () => gridOf(tileClay), ['clayDark', 'clayLight']],
  ['sandstone', () => gridOf(tileSandstone), ['ochreDark', 'ochreLight']],
  ['tuff', () => gridOf(tileTuff), ['tuffDark', 'tuffLight']],
  ['granite', granite, ['metal', 'clayLight', 'cream']],
  ['basalt', basalt, ['ink', 'red', 'metal']],
];

/** 変化形 k（0 は元のまま、1 は横に 5 ずらして粒、2 は左右反転して粒、3 は 11 ずらして反転・粒を多め） */
function variant(base: Grid, k: number, colors: PaletteName[], seed: number): Grid {
  const r = rng(seed * 31 + k);
  if (k === 0) return base;
  if (k === 1) return specks(copy(base, (x, y) => [x + 5, y]), r, 6, colors);
  if (k === 2) return specks(copy(base, (x, y) => [S - 1 - x, y]), r, 6, colors);
  return specks(copy(base, (x, y) => [S - 1 - x + 11, y + 3]), r, 10, colors);
}

export const strataTiles: SpriteDef[] = BASES.flatMap(([id, make, colors], i) => {
  const base = make();
  return [0, 1, 2, 3].map((k) => ({ ...variant(base, k, colors, i + 1).toSprite(`tile-${id}-${k}`), tile: true }));
});
