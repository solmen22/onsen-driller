// テスト用の状態の作り方（core のテストで共通に使う）
import { createInitialState, num, refreshGuests, slotsForBathLevel, type GameState } from '../../src/core/index.ts';
import type { SpringId } from '../../src/content/springs.ts';

export interface StateSpec {
  seed?: number;
  coins?: number | string;
  depth?: number;
  maxDepth?: number;
  drill?: number;
  tool?: number;
  digger?: number;
  autoOn?: boolean;
  hold?: boolean;
  bath?: number;
  pumps?: Partial<Record<SpringId, number>>;
}

export const SPRING_IDS: SpringId[] = ['simple', 'co2', 'salt', 'sulfur', 'iron'];

/** 指定した値を入れた状態（幕間を出さないよう、深さまでの帯は見たことにする） */
export function stateWith(spec: StateSpec = {}): GameState {
  const s = createInitialState(spec.seed ?? 1);
  const r = s.run;
  if (spec.coins !== undefined) r.coins = num(spec.coins);
  if (spec.depth !== undefined) {
    r.depth = spec.depth;
    r.maxDepth = Math.max(spec.depth, spec.maxDepth ?? 0);
  }
  if (spec.maxDepth !== undefined) r.maxDepth = Math.max(r.depth, spec.maxDepth);
  if (spec.drill !== undefined) r.drill.level = spec.drill;
  if (spec.tool !== undefined) r.drill.tool = spec.tool;
  if (spec.digger !== undefined) r.autoDig.level = spec.digger;
  if (spec.autoOn !== undefined) r.autoDig.on = spec.autoOn;
  if (spec.hold !== undefined) s.input.hold = spec.hold;
  for (const [id, lv] of Object.entries(spec.pumps ?? {})) if (lv && lv > 0) r.springs[id as SpringId] = { pump: lv };
  if (spec.bath !== undefined) {
    r.bath.level = spec.bath;
    const found = Object.keys(r.springs) as SpringId[];
    r.bath.slots = Array.from({ length: slotsForBathLevel(spec.bath) }, (_, i) => found[i] ?? null);
  }
  r.stratumSeen = [0, 1, 2, 3, 4, 5].filter((b) => [0, 30, 80, 150, 250, 400][b]! <= r.maxDepth);
  refreshGuests(s, []);
  return s;
}
