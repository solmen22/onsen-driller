// 道具の進化 7 段（gdd §5-3）。index 0 は初期のスコップ。
export interface ToolDef {
  id: string;
  unlockDepth: number;
  cost: number;
  mult: number;
}

export const TOOLS: readonly ToolDef[] = [
  { id: 'shovel', unlockDepth: 0, cost: 0, mult: 1 },
  { id: 'pickaxe', unlockDepth: 0, cost: 3, mult: 1.5 },
  { id: 'yagura', unlockDepth: 25, cost: 400, mult: 2.5 },
  { id: 'boring', unlockDepth: 70, cost: 2e4, mult: 2.5 },
  { id: 'bigDrill', unlockDepth: 130, cost: 6e5, mult: 2.5 },
  { id: 'geoDrill', unlockDepth: 200, cost: 3e7, mult: 2.5 },
  { id: 'giantDrill', unlockDepth: 290, cost: 2e9, mult: 2.5 },
  { id: 'legendDrill', unlockDepth: 400, cost: 3e11, mult: 2.5 },
];
