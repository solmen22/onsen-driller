// 源泉 5 種（gdd §5-4。地形「山あい」の深さ）。深さに届くと発見し、ポンプ Lv1 が無料で付く（BL-015）。
// 500m の伝説の源泉（エンディング）は BL-023、地形ごとの深さ（depthByTerrain）は S3 の BL-024 で足す。
// 名前は i18n のキー（spring.<id>）。文章は i18n/*.json に置く
export type SpringId = 'simple' | 'co2' | 'salt' | 'sulfur' | 'iron';

export type SpringEffect =
  | { kind: 'incomeAll'; mult: number }
  | { kind: 'drillPower'; mult: number }
  | { kind: 'offlineEff'; add: number }
  | { kind: 'oreValue'; mult: number }
  | { kind: 'hardness'; mult: number };

export interface SpringDef {
  id: SpringId;
  /** 発見の深さ（m。この深さに届いた＝この深さのブロックの手前まで掘った時点で発見） */
  depth: number;
  /** ポンプのコストの初期値 c₀（次の 1 Lv のコスト＝c₀ × r^今の Lv。Lv1 は発見時に無料） */
  pumpC0: number;
  /** ポンプのコストの成長率 r */
  pumpR: number;
  /** 基本湧出/秒（入湯料/秒＝基本湧出 × Lv × マイルストーン × 倍率） */
  flow: number;
  /** 湯船の枠につないでいる間だけ効く効果 */
  effect: SpringEffect;
  /** i18n のキー */
  nameKey: `spring.${SpringId}`;
}

const spring = (id: SpringId, depth: number, pumpC0: number, pumpR: number, flow: number, effect: SpringEffect): SpringDef => ({
  id,
  depth,
  pumpC0,
  pumpR,
  flow,
  effect,
  nameKey: `spring.${id}`,
});

export const SPRINGS: readonly SpringDef[] = [
  spring('simple', 30, 60, 1.11, 1, { kind: 'incomeAll', mult: 1.2 }),
  spring('co2', 80, 3_000, 1.12, 30, { kind: 'drillPower', mult: 1.5 }),
  spring('salt', 150, 120_000, 1.13, 1_200, { kind: 'offlineEff', add: 0.25 }),
  spring('sulfur', 250, 2e7, 1.14, 5e4, { kind: 'oreValue', mult: 2 }),
  spring('iron', 400, 8e9, 1.15, 2.5e6, { kind: 'hardness', mult: 0.8 }),
];

export const SPRING_BY_ID: Readonly<Record<SpringId, SpringDef>> = Object.fromEntries(
  SPRINGS.map((s) => [s.id, s]),
) as Record<SpringId, SpringDef>;
