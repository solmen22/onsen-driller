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

  it('標準ボット 1 時間: 目標表の出来事の時刻を記録する（源泉は深さの順、#18 の入湯料の割合は 50% 超。範囲の判定は BL-033）', () => {
    const r = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    const m = r.milestones;
    const order = [m.firstUpgrade, m.simple, m.co2, m.salt, m.sulfur];
    expect(order.every((x) => typeof x === 'number')).toBe(true);
    expect([...(order as number[])].sort((x, y) => x - y)).toEqual(order);
    expect(typeof m.slot2).toBe('number');
    expect(typeof m.lv10Guest).toBe('number');
    expect(r.bathShare).toBeGreaterThan(0.5);
    expect(r.bathShare).toBeLessThanOrEqual(1); // 数え方の検査（頭打ちにしていない。レビュー PR #10 N-3）
    expect(typeof m.recommend).toBe('number');
    expect(m.recommend).toBeLessThan(m.prestige ?? Infinity);
  });
});
