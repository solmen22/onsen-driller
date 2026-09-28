// 源泉 5 種（gdd §5-4。地形「山あい」の深さ）
export type SpringId = 'simple' | 'co2' | 'salt' | 'sulfur' | 'iron';

export type SpringEffect =
  | { kind: 'incomeAll'; mult: number }
  | { kind: 'drillPower'; mult: number }
  | { kind: 'offlineEff'; add: number }
  | { kind: 'oreValue'; mult: number }
  | { kind: 'hardness'; mult: number };

export interface SpringDef {
  id: SpringId;
  depth: number;
  pumpC0: number;
  pumpR: number;
  flow: number;
  effect: SpringEffect;
}

export const SPRINGS: readonly SpringDef[] = [
  { id: 'simple', depth: 30, pumpC0: 60, pumpR: 1.11, flow: 1, effect: { kind: 'incomeAll', mult: 1.2 } },
  { id: 'co2', depth: 80, pumpC0: 3_000, pumpR: 1.12, flow: 30, effect: { kind: 'drillPower', mult: 1.5 } },
  { id: 'salt', depth: 150, pumpC0: 120_000, pumpR: 1.13, flow: 1_200, effect: { kind: 'offlineEff', add: 0.25 } },
  { id: 'sulfur', depth: 250, pumpC0: 2e7, pumpR: 1.14, flow: 5e4, effect: { kind: 'oreValue', mult: 2 } },
  { id: 'iron', depth: 400, pumpC0: 8e9, pumpR: 1.15, flow: 2.5e6, effect: { kind: 'hardness', mult: 0.8 } },
];

export const SPRING_BY_ID: Readonly<Record<SpringId, SpringDef>> = Object.fromEntries(
  SPRINGS.map((s) => [s.id, s]),
) as Record<SpringId, SpringDef>;
