// 地下の見た目の選び方（arch §14。BL-036）。Phaser に依存しない純粋な関数
// - 地層タイル: 帯ごとに 4 種の変化形を、列と行のハッシュで選ぶ（同じタイルの繰り返しを減らす。PoC-5 の CEO レビュー）
// - 飾り（小石・根・化石・結晶・溶岩の筋）: 約 12% のマスに重ねる（道具より下が空っぽに見えないように）
// - 先にある鉱石のきらめき・次の源泉の気配: 縦穴（0 列目）のこれから掘るところに出す（次の目標が見える）
import type { OreId } from '../content/ores.ts';
import { SPRINGS, type SpringId } from '../content/springs.ts';
import { STRATA, type StratumId } from '../content/strata.ts';
import { hash32 } from '../core/rng.ts';

export const TILE_VARIANTS = 4;

/** 帯と変化形 → タイルのテクスチャのキー（例 tile-clay-2） */
export function tileFrame(band: number, variant: number): string {
  const b = STRATA[Math.min(STRATA.length - 1, Math.max(0, Math.floor(band)))] ?? STRATA[0];
  return `tile-${b?.id ?? 'topsoil'}-${((Math.floor(variant) % TILE_VARIANTS) + TILE_VARIANTS) % TILE_VARIANTS}`;
}

/** マスの変化形（周回のシード・行・列のハッシュ。同じマスは毎回同じ） */
export const tileVariant = (seed: number, row: number, col: number): number => hash32((seed ^ Math.imul(col, 0x01000193)) >>> 0, row) % TILE_VARIANTS;

const DECOS: Readonly<Record<StratumId, readonly [string, string]>> = {
  topsoil: ['deco-root', 'deco-pebble'],
  clay: ['deco-pebble', 'deco-fossil'],
  sandstone: ['deco-fossil', 'deco-pebble'],
  tuff: ['deco-crystal', 'deco-pebble'],
  granite: ['deco-crystal', 'deco-pebble'],
  basalt: ['deco-lava', 'deco-crystal'],
};
/** 飾りを置くマスの割合（%） */
export const DECO_PERCENT = 12;
/** 次の源泉がこの行数以内に近づいたら、下から泡を立ち上らせる（源泉の気配） */
export const SPRING_BUBBLE_ROWS = 30;

/** マスの飾り（なければ null）。縦穴（0 列目）には置かない */
export function decoAt(seed: number, row: number, col: number, band: number): string | null {
  if (col === 0 || row < 0) return null;
  const h = hash32((seed ^ 0x6465636f ^ Math.imul(col, 0x9e3779b1)) >>> 0, row);
  if (h % 100 >= DECO_PERCENT) return null;
  const pair = DECOS[STRATA[band]?.id ?? 'topsoil'];
  return pair[(h >>> 8) & 1] ?? null;
}

/** 鉱石のきらめきの色（白い宝石の絵にかける色。12 種） */
export const ORE_TINT: Readonly<Record<OreId, number>> = {
  quartz: 0xf4f8fb,
  amber: 0xf2a33a,
  copper: 0xd9784b,
  obsidian: 0x6a6f86,
  silver: 0xc7d0da,
  ammonite: 0xefdcb8,
  jade: 0x5fc79a,
  sulfurCrystal: 0xfff07a,
  gold: 0xf2c14e,
  rockCrystal: 0x9ae0dc,
  ruby: 0xe0485a,
  lavaStone: 0xd9603b,
};

/** まだ見つけていない源泉のうち、いちばん浅いもの（源泉の気配を出す深さ）。なければ null */
export function nextSpringHint(found: (id: SpringId) => boolean): { id: SpringId; depth: number } | null {
  for (const sp of SPRINGS) if (!found(sp.id)) return { id: sp.id, depth: sp.depth };
  return null;
}

/** きらめきの明るさ（時刻 ms と深さで少しずつずらした 0.55〜1 の脈動） */
export const glintAlpha = (timeMs: number, depth: number): number => 0.775 + 0.225 * Math.sin(timeMs / 180 + depth * 1.7);
