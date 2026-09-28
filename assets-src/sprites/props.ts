// 道具 6 種（手掘りやぐら〜伝説のドリルの仮の絵）・ひび 4 段・飾り・鉱石のきらめき・源泉の気配（BL-036。S1 の仮の絵）。
// 幾何形状は Grid で描き、細部は画素で打つ。道具は 24×24 で、先（掘る側）が下。本番の絵は S4 の BL-062・063 で差し替える
import { Grid, type SpriteDef } from '../lib.ts';

/** 手掘りやぐら（上総掘り風）: 木の三脚と横木、吊るした綱、下に鉄の刃先 */
function yagura(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(3, 1, 18, 2, 'wood').rect(4, 1, 16, 1, 'woodLight');
  g.line(5, 3, 10, 15, 'wood').line(18, 3, 13, 15, 'wood').line(6, 3, 11, 15, 'woodDark');
  g.rect(8, 8, 8, 1, 'woodDark');
  g.line(12, 3, 12, 16, 'steamDark');
  g.stamp(9, 16, ['.mmmm.', 'mllmmd', '.mlmd.', '.mmdd.', '..md..', '..dd..'], { m: 'metal', l: 'metalLight', d: 'metalDark' });
  g.outline('ink');
  return g.toSprite('tool-yagura');
}

/** ボーリング機: 箱の機械（赤いランプ）と竿、円錐の刃先 */
function boring(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(5, 1, 14, 7, 'metalDark').rect(6, 2, 12, 5, 'metal').rect(7, 2, 10, 1, 'metalLight');
  g.set(16, 4, 'red').set(15, 4, 'goldLight');
  g.rect(11, 8, 2, 9, 'metalLight').line(11, 8, 11, 16, 'metal');
  g.stamp(8, 16, ['mmmmmmmm', '.mlmmmd.', '.mmmmdd.', '..mmdd..', '..mmd...', '...md...', '...d....'], { m: 'metal', l: 'metalLight', d: 'metalDark' });
  g.outline('ink');
  return g.toSprite('tool-boring');
}

/** 円錐のドリルの刃（上が幅 w、先が下）。らせんの筋を入れる */
function drillBit(g: Grid, top: number, bottom: number, w: number, body: string, stripe: string, light: string): void {
  const cx = 11.5;
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const half = Math.max(0.5, (w / 2) * (1 - t));
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (Math.abs(x - cx) > half + 0.25) continue;
      const band = (x + y * 2) % 5;
      g.set(x, y, band === 0 ? stripe : x < cx - half / 2 ? light : body);
    }
  }
}

/** 大型ドリル: 金属の円錐とつば */
function bigDrill(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(6, 1, 12, 3, 'metalDark').rect(7, 1, 10, 1, 'metal');
  drillBit(g, 4, 22, 12, 'metal', 'metalDark', 'metalLight');
  g.outline('ink');
  return g.toSprite('tool-bigdrill');
}

/** 地熱ドリル: 先が赤く熱い円錐、横に冷却の管（湯の色） */
function geoDrill(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(5, 1, 14, 3, 'metalDark').rect(6, 1, 12, 1, 'metal');
  drillBit(g, 4, 22, 13, 'metal', 'metalDark', 'metalLight');
  for (let y = 15; y <= 22; y++) for (let x = 0; x < 24; x++) if (g.get(x, y) && g.get(x, y) !== 'ink') g.set(x, y, y > 18 ? 'red' : (x + y) % 3 === 0 ? 'gold' : 'clayLight');
  g.line(4, 2, 4, 12, 'water').line(4, 12, 7, 12, 'water').set(4, 2, 'waterLight');
  g.outline('ink');
  return g.toSprite('tool-geodrill');
}

/** 巨大ドリル: 幅の広い暗い円錐に金の輪 */
function giantDrill(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(2, 0, 20, 3, 'metalDark').rect(3, 0, 18, 1, 'gold');
  drillBit(g, 3, 23, 19, 'metalDark', 'ink', 'metal');
  for (const y of [7, 13]) for (let x = 0; x < 24; x++) if (g.get(x, y)) g.set(x, y, 'gold');
  g.outline('ink');
  return g.toSprite('tool-giantdrill');
}

/** 伝説のドリル: 金の円錐、つばに赤い宝石、きらめき */
function legendDrill(): SpriteDef {
  const g = new Grid(24, 24);
  g.rect(3, 0, 18, 3, 'gold').rect(4, 0, 16, 1, 'goldLight').rect(11, 1, 2, 1, 'red');
  drillBit(g, 3, 23, 17, 'gold', 'ochreDark', 'goldLight');
  g.outline('ink');
  g.set(1, 6, 'steam').set(22, 10, 'steam').set(0, 7, 'goldLight').set(23, 11, 'goldLight');
  return g.toSprite('tool-legenddrill');
}

/** ひび（16×16。段が上がるほど線が増える。透明の地に重ねる） */
function cracks(): SpriteDef[] {
  const lines: [number, number, number, number][][] = [
    [
      [7, 6, 9, 9],
      [9, 9, 8, 11],
    ],
    [
      [4, 4, 8, 8],
      [8, 8, 11, 7],
      [8, 8, 8, 12],
    ],
    [
      [2, 3, 8, 8],
      [8, 8, 13, 5],
      [8, 8, 7, 14],
      [11, 10, 14, 12],
    ],
    [
      [1, 2, 8, 8],
      [8, 8, 14, 3],
      [8, 8, 6, 15],
      [10, 9, 15, 12],
      [3, 11, 7, 10],
      [11, 13, 13, 15],
    ],
  ];
  let acc: [number, number, number, number][] = [];
  return lines.map((ls, i) => {
    acc = [...acc, ...ls];
    const g = new Grid(16, 16);
    for (const [x0, y0, x1, y1] of acc) g.line(x0, y0, x1, y1, 'ink');
    return g.toSprite(`crack-${i + 1}`);
  });
}

/** 飾り（16×16、透明の地に重ねる） */
function decos(): SpriteDef[] {
  const pebble = new Grid(16, 16)
    .ellipse(4.5, 11, 2.2, 1.4, 'metalDark')
    .ellipse(4, 10.6, 1.2, 0.6, 'metal')
    .ellipse(11, 5, 1.6, 1.1, 'metalDark')
    .set(10, 4, 'steamDark')
    .toSprite('deco-pebble');
  const root = new Grid(16, 16)
    .line(6, 0, 7, 4, 'woodDark')
    .line(7, 4, 5, 8, 'woodDark')
    .line(5, 8, 6, 12, 'woodDark')
    .line(7, 4, 10, 7, 'woodDark')
    .line(10, 7, 11, 10, 'soilMid')
    .toSprite('deco-root');
  // 化石は石の色（金色だとコインや鉱石に見えるので、灰色の渦にする）
  const fossil = new Grid(16, 16).ellipse(8, 8, 3.5, 3.5, 'metal').ellipse(8, 8, 2.2, 2.2, 'steamDark').ellipse(8.6, 8.4, 1, 1, 'metal');
  fossil.line(8, 5, 11, 8, 'metalDark').line(5, 8, 8, 11, 'metalDark');
  const crystal = new Grid(16, 16).line(6, 12, 6, 6, 'waterFoam').line(7, 12, 7, 5, 'steam').line(8, 12, 9, 7, 'waterLight').line(10, 12, 11, 9, 'waterFoam');
  const lava = new Grid(16, 16).line(0, 9, 5, 7, 'red').line(5, 7, 10, 9, 'gold').line(10, 9, 15, 6, 'red').line(1, 10, 5, 8, 'clayDark').line(11, 10, 15, 7, 'clayDark');
  return [pebble, root, fossil.toSprite('deco-fossil'), crystal.toSprite('deco-crystal'), lava.toSprite('deco-lava')];
}

/** 鉱石のきらめき（白い宝石の集まり。描画で鉱石ごとの色をかける） */
function oreGem(): SpriteDef {
  const g = new Grid(16, 16);
  g.stamp(3, 3, ['..w..', '.wsw.', 'wsssm', '.smm.', '..m..'], { w: 'steam', s: 'steamMid', m: 'steamDark' });
  g.stamp(8, 7, ['..w...', '.wwsm.', 'wsssmm', '.ssmm.', '..mm..'], { w: 'steam', s: 'steamMid', m: 'steamDark' });
  g.set(12, 3, 'steam').set(13, 2, 'steamMid').set(4, 12, 'steam');
  return g.toSprite('ore-gem');
}

/** 源泉の気配（岩の中の湯だまりと泡） */
function springHint(): SpriteDef {
  const g = new Grid(16, 16);
  g.ellipse(8, 10, 6, 3.5, 'waterDeep').ellipse(8, 9.5, 5, 2.6, 'water').ellipse(6.5, 9, 2.2, 1, 'waterLight');
  g.set(9, 5, 'waterFoam').set(11, 3, 'waterFoam').set(6, 4, 'steam').set(10, 1, 'steamMid');
  return g.toSprite('spring-hint');
}

export const props: SpriteDef[] = [yagura(), boring(), bigDrill(), geoDrill(), giantDrill(), legendDrill(), ...cracks(), ...decos(), oreGem(), springHint()];
