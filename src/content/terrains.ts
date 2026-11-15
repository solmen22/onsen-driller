// 地形 3 種（gdd §5-8。BL-024）。転生のたびに、解放済みの地形から次の周回の地形を選ぶ。
// 地形はデータで表す: 源泉の発見の深さの倍率と、周回の間ずっと効く効果（共通の語彙。core/formulas.ts の modifiers が掛ける）。
// 地層の帯の深さ・鉱石の種類はどの地形でも同じ（配色・背景の差し替えは描画の BL-040）。伝説の源泉（BL-023）はどの地形でも 500m。
// 名前は i18n のキー（terrain.<id>）。文言は転生の画面（BL-045）で足す（湯の華の木と同じ）
import type { Effect } from './effects.ts';
import type { SpringId } from './springs.ts';

export const TERRAIN_IDS = ['mountain', 'volcano', 'seaside'] as const;
export type TerrainId = (typeof TERRAIN_IDS)[number];
export const INITIAL_TERRAIN: TerrainId = 'mountain';

/** 地形の効果（共通の語彙のうち、地形が使う種類） */
export type TerrainEffect = Extract<Effect, { kind: 'hardness' | 'oreValue' | 'incomeAll' }>;

export interface TerrainDef {
  id: TerrainId;
  /**
   * 解放に要る転生の回数（転生した後の meta.prestiges）。n 回目の転生の確認の画面で、その転生の行き先として選べる
   * （火山のふもと＝1 回目の転生の確認の画面から行き先に選べる。CEO 承認 2026-11-15）
   */
  unlockPrestiges: number;
  /**
   * 源泉の発見の深さの倍率（content/springs.ts の山あいの深さ × 倍率を四捨五入した整数 m）。書いていない源泉は ×1。
   * どの地形でも、源泉の並び（浅い順）は content/springs.ts の順と同じにする（content-check で確かめる）
   */
  springDepthMult: Partial<Record<SpringId, number>>;
  /** 周回の間ずっと効く効果（地層の硬さ・鉱石の価値・入湯料） */
  effects: readonly TerrainEffect[];
  /** i18n のキー */
  nameKey: `terrain.${TerrainId}`;
}

export const TERRAINS: readonly TerrainDef[] = [
  // 標準（gdd §5-1 の深さのまま）
  { id: 'mountain', unlockPrestiges: 0, springDepthMult: {}, effects: [], nameKey: 'terrain.mountain' },
  // 硫黄泉と含鉄泉が浅い（250→175m・400→280m）。地層が硬い（×1.3）が、鉱石の価値 ×1.5
  {
    id: 'volcano',
    unlockPrestiges: 1,
    springDepthMult: { sulfur: 0.7, iron: 0.7 },
    effects: [
      { kind: 'hardness', mult: 1.3 },
      { kind: 'oreValue', mult: 1.5 },
    ],
    nameKey: 'terrain.volcano',
  },
  // 塩化物泉が浅い（×0.7 で 150→105m。確認事項 #7: 火山と同じ倍率。CEO 承認 2026-11-15。BL-034 で調整）。地層が柔らかい（×0.8）が、入湯料 ×0.8
  {
    id: 'seaside',
    unlockPrestiges: 2,
    springDepthMult: { salt: 0.7 },
    effects: [
      { kind: 'hardness', mult: 0.8 },
      { kind: 'incomeAll', mult: 0.8 },
    ],
    nameKey: 'terrain.seaside',
  },
];

export const TERRAIN_BY_ID: Readonly<Record<TerrainId, TerrainDef>> = Object.fromEntries(TERRAINS.map((t) => [t.id, t])) as Record<
  TerrainId,
  TerrainDef
>;

export const isTerrainId = (x: unknown): x is TerrainId => typeof x === 'string' && (TERRAIN_IDS as readonly string[]).includes(x);
