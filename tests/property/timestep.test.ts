// 刻み幅によらないこと（arch §8-3）: 同じ初期状態から 1 時間進めたとき、0.1 秒刻みと 1 秒刻みの差が 1% 以内
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advance,
  BAND_STARTS,
  createInitialState,
  isHealthy,
  refreshGuests,
  slotsForBathLevel,
  type GameState,
} from '../../src/core/index.ts';
import type { SpringId } from '../../src/content/springs.ts';

const SPRING_IDS: SpringId[] = ['simple', 'co2', 'salt', 'sulfur', 'iron'];

function makeState(seed: number, drill: number, auto: number, bath: number, pumps: number[], depth: number, tool: number): GameState {
  const s = createInitialState(seed);
  const r = s.run;
  r.drill.level = drill;
  r.drill.tool = tool;
  r.autoDig.level = auto;
  r.autoDig.on = true;
  r.depth = depth;
  r.maxDepth = depth;
  pumps.forEach((lv, i) => {
    const id = SPRING_IDS[i];
    if (id && lv > 0) r.springs[id] = { pump: lv };
  });
  r.bath.level = bath;
  const n = slotsForBathLevel(bath);
  const found = Object.keys(r.springs) as SpringId[];
  r.bath.slots = Array.from({ length: n }, (_, i) => found[i] ?? null);
  r.stratumSeen = [0, 1, 2, 3, 4, 5].filter((b) => BAND_STARTS[b]! <= depth);
  refreshGuests(s, []);
  return s;
}

const rel = (a: number, b: number): number => (Math.max(a, b) === 0 ? 0 : Math.abs(a - b) / Math.max(a, b));

describe('刻み幅', () => {
  it('0.1 秒刻みと 1 秒刻みで 1 時間後の差が 1% 以内（操作なし）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 }),
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 35 }),
        fc.array(fc.integer({ min: 0, max: 80 }), { minLength: 5, maxLength: 5 }),
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 0, max: 7 }),
        (seed, drill, auto, bath, pumps, depth, tool) => {
          const a = makeState(seed, drill, auto, bath, pumps, depth, tool);
          const b = makeState(seed, drill, auto, bath, pumps, depth, tool);
          advance(a, 3_600_000, 100);
          advance(b, 3_600_000, 1_000);
          expect(isHealthy(a.stats.totalCoins) && isHealthy(b.stats.totalCoins)).toBe(true);
          expect(rel(a.stats.totalCoins.toNumber(), b.stats.totalCoins.toNumber())).toBeLessThanOrEqual(0.01);
          expect(Math.abs(a.run.maxDepth - b.run.maxDepth)).toBeLessThanOrEqual(1);
          // 帯の境目では「そのステップの残りの打撃」を捨て、幕間 1.5 秒の始まりもステップの終わりにそろうので、
          // 境目を越えた回数 × 1 ステップぶんまで打数がずれうる（arch §8-3 の 1% 以内に入る）
          expect(rel(a.stats.hits, b.stats.hits)).toBeLessThanOrEqual(0.01);
        },
      ),
      { numRuns: 20, seed: 20260928 },
    );
  });
});
