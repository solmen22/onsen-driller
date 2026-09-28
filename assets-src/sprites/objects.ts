// 道具 2 種・タヌキ・湯船・パーティクル。幾何形状は Grid で描き、細部は画素で打つ
import { Grid, type SpriteDef } from '../lib.ts';

/** スコップ（24×24、下向き。掘る向き） */
function shovel(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(8, 1, 8, 2, 'wood').rect(9, 1, 6, 1, 'woodLight');
  g.rect(11, 3, 2, 11, 'wood').line(11, 3, 11, 13, 'woodLight');
  g.rect(10, 13, 4, 2, 'metalDark');
  g.stamp(6, 15, [
    '..mmmmmmmm..',
    '.mlmmmmmmmm.',
    '.mlmmmmmmmm.',
    '.mlmmmmmmmd.',
    '..lmmmmmmd..',
    '..mmmmmmmd..',
    '...mmmmmd...',
    '....mmdd....',
  ], { m: 'metal', l: 'metalLight', d: 'metalDark' });
  g.outline('ink');
  return g.toSprite('tool-shovel');
}

/** ツルハシ（24×24、斜め。柄の端を軸に振る） */
function pickaxe(): SpriteDef {
  const g = new Grid(24, 24);
  // 柄
  g.line(4, 20, 15, 9, 'wood').line(5, 20, 16, 9, 'woodDark').line(4, 19, 14, 9, 'woodLight');
  // 頭（柄に直交し、外側へ反った金属）
  g.stamp(7, 2, [
    '..lllll.........',
    '.lmmmmmmll......',
    'lmmmmmmmmmml....',
    'mmdd...ddmmmml..',
    'md.......ddmmml.',
    '...........dmmml',
    '............dmml',
    '.............dml',
    '.............dmm',
    '..............dm',
    '..............dm',
    '...............d',
  ], { m: 'metal', l: 'metalLight', d: 'metalDark' });
  g.rect(14, 7, 3, 3, 'metalDark');
  g.outline('ink');
  return g.toSprite('tool-pickaxe');
}

/** タヌキ（24×24、正面・座り） */
function tanuki(): SpriteDef {
  const g = new Grid(24, 24);
  // しっぽ（右後ろ）
  g.ellipse(19.5, 19, 3, 2, 'soilDark').ellipse(20.5, 18.5, 1.5, 1, 'soil');
  // 体
  g.ellipse(11.5, 18, 6.5, 4.8, 'soil');
  g.ellipse(11.5, 18.8, 3.6, 3.2, 'cream');
  // 腕と足
  g.ellipse(6, 17.5, 1.6, 2.2, 'soilDark').ellipse(17, 17.5, 1.6, 2.2, 'soilDark');
  g.ellipse(8, 22, 2.2, 1.1, 'soilDark').ellipse(15, 22, 2.2, 1.1, 'soilDark');
  // 耳
  g.stamp(3, 1, ['.oo.', 'oddo', 'odsso'], { o: 'soilDark', d: 'ink', s: 'soil' });
  g.stamp(16, 1, ['.oo.', 'oddo', 'ossdo'], { o: 'soilDark', d: 'ink', s: 'soil' });
  // 頭
  g.ellipse(11.5, 8.5, 8.2, 6.2, 'soil');
  g.ellipse(11.5, 6, 5, 2.5, 'soilLight');
  // 目のまわりの黒い模様
  g.ellipse(7.5, 9, 2.8, 1.8, 'soilDark').ellipse(15.5, 9, 2.8, 1.8, 'soilDark');
  // 口元
  g.ellipse(11.5, 11.6, 3.6, 2.2, 'cream');
  g.rect(11, 10, 2, 1, 'ink');
  g.set(11, 12, 'soilMid').set(12, 12, 'soilMid');
  // 目（黒目＋光）
  g.rect(7, 8, 2, 2, 'ink').set(7, 8, 'steam');
  g.rect(15, 8, 2, 2, 'ink').set(15, 8, 'steam');
  // ほお
  g.set(5, 11, 'clayLight').set(18, 11, 'clayLight');
  g.outline('ink');
  return g.toSprite('guest-tanuki');
}

/** 湯船（48×24、木の桶・湯面・湯けむり） */
function tub(): SpriteDef {
  const g = new Grid(48, 24);
  // 桶
  g.rect(5, 10, 38, 11, 'wood');
  for (let x = 9; x < 43; x += 6) g.line(x, 11, x, 20, 'woodDark');
  g.rect(5, 13, 38, 1, 'metalDark').rect(5, 18, 38, 1, 'metalDark');
  g.rect(6, 20, 36, 1, 'woodDark').rect(7, 21, 34, 1, 'woodDark');
  // 湯面
  g.ellipse(24, 9.5, 19.5, 2.6, 'water');
  g.line(10, 9, 16, 9, 'waterLight').line(27, 10, 34, 10, 'waterLight').line(20, 8, 23, 8, 'waterFoam');
  // 縁
  g.rect(4, 11, 40, 1, 'woodLight').set(4, 10, 'woodLight').set(43, 10, 'woodLight');
  g.outline('ink');
  // 湯けむり（輪郭を付けず、湯面から離して淡く）
  g.ellipse(14, 3, 3.2, 1.8, 'steamDark').ellipse(14, 2.8, 2.4, 1.2, 'steamMid').ellipse(13.4, 2.5, 1.2, 0.7, 'steam');
  g.ellipse(31, 2.5, 3.6, 2, 'steamDark').ellipse(31, 2.2, 2.8, 1.4, 'steamMid').ellipse(30.2, 1.8, 1.5, 0.8, 'steam');
  g.ellipse(23, 4.2, 1.6, 0.9, 'steamMid');
  return g.toSprite('bath-tub');
}

function particles(): SpriteDef[] {
  const chip: SpriteDef = {
    id: 'p-chip',
    w: 4,
    h: 4,
    key: { s: 'steam', m: 'steamMid', d: 'steamDark' },
    rows: ['.sm.', 'smmd', 'mmdd', '.dd.'],
  };
  const steam = new Grid(8, 8).ellipse(3.5, 4, 3.5, 3, 'steamMid').ellipse(3, 3.5, 2, 1.6, 'steam').toSprite('p-steam');
  const spark: SpriteDef = {
    id: 'p-spark',
    w: 5,
    h: 5,
    key: { g: 'gold', l: 'goldLight' },
    rows: ['..g..', '..l..', 'glllg', '..l..', '..g..'],
  };
  const coin = new Grid(8, 8)
    .ellipse(3.5, 3.5, 3.5, 3.5, 'ochreDark')
    .ellipse(3.5, 3.5, 2.6, 2.6, 'gold')
    .rect(3, 2, 1, 4, 'goldLight')
    .toSprite('p-coin');
  return [chip, steam, spark, coin];
}

export const objects: SpriteDef[] = [shovel(), pickaxe(), tanuki(), tub(), ...particles()];
