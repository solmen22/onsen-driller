// バランスの短縮版（PR ごと）。全件は npm run sim（20 時間 × 3 ボット）
import { describe, expect, it } from 'vitest';
import { BOTS } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';

describe('sim (短縮版)', () => {
  it('標準ボット 1 時間: 同じシードで同じハッシュ、数値が健全', () => {
    const a = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    const b = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    expect(a.hash).toBe(b.hash);
    expect(a.healthy).toBe(true);
    expect(a.bestDepth).toBeGreaterThanOrEqual(150);
  });
});
