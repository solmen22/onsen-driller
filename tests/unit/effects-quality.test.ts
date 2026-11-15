// BL-037: 演出の量（src/view/effects.ts）・画質の自動調整（src/view/quality.ts）・動きを減らすの決め方（src/app/settings.ts）
import { describe, expect, it } from 'vitest';
import { resolveReduceMotion } from '../../src/app/settings.ts';
import { breakShards, EFFECTS, effectBudget, hitShards, scaled, shardsMax } from '../../src/view/effects.ts';
import { p95, QUALITY, QualityGovernor } from '../../src/view/quality.ts';

/** ms ミリ秒ぶん、1 フレーム dt のフレームを流す。倍率が変わった回数を返す */
function run(q: QualityGovernor, ms: number, dt: number): number {
  let changes = 0;
  for (let t = 0; t < ms; t += dt) if (q.push(dt)) changes++;
  return changes;
}

describe('画質の自動調整（quality.ts）', () => {
  it('95 パーセンタイル', () => {
    expect(p95([])).toBe(0);
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(96);
    expect(p95([5])).toBe(5);
  });

  it('95 パーセンタイルが 20ms を超える区切り（1 秒）が 3 つ続いたら、パーティクルの倍率を半分にする', () => {
    const q = new QualityGovernor('auto');
    expect(run(q, 2 * QUALITY.windowMs, 25)).toBe(0);
    expect(q.scale).toBe(1);
    expect(run(q, QUALITY.windowMs, 25)).toBe(1);
    expect(q.scale).toBe(0.5);
  });

  it('ちょうど 20ms は重くない。95 パーセンタイルより上の少しの重いフレーム（5% 未満）では下げない', () => {
    const q = new QualityGovernor('auto');
    expect(run(q, 10 * QUALITY.windowMs, 20)).toBe(0);
    for (let w = 0; w < 10; w++) {
      for (let i = 0; i < 58; i++) q.push(16);
      q.push(100); // 59 フレーム中 1 つ（約 1.7%）
      q.push(16);
    }
    expect(q.scale).toBe(1);
  });

  it('重い区切りが途中で途切れたら数え直す（2 つ重い → 1 つ軽い → 2 つ重い では下げない）', () => {
    const q = new QualityGovernor('auto');
    run(q, 2 * QUALITY.windowMs, 25);
    run(q, QUALITY.windowMs, 16);
    run(q, 2 * QUALITY.windowMs, 25);
    expect(q.scale).toBe(1);
    run(q, QUALITY.windowMs, 25);
    expect(q.scale).toBe(0.5);
  });

  it('重いままなら、さらに 3 秒ごとに半分（0.25 まで）。上げ戻しはしない', () => {
    const q = new QualityGovernor('auto');
    run(q, 20 * QUALITY.windowMs, 25);
    expect(q.scale).toBe(QUALITY.minScale);
    expect(q.drops).toBe(2);
    run(q, 20 * QUALITY.windowMs, 8);
    expect(q.scale).toBe(QUALITY.minScale);
  });

  it('設定 high は下げない。low は 0.5 から始まり、重ければ 0.25 まで', () => {
    const hi = new QualityGovernor('high');
    run(hi, 20 * QUALITY.windowMs, 40);
    expect(hi.scale).toBe(1);
    const lo = new QualityGovernor('low');
    expect(lo.scale).toBe(0.5);
    run(lo, 3 * QUALITY.windowMs, 40);
    expect(lo.scale).toBe(0.25);
  });

  it('NaN・負・Infinity のフレーム時間は無視する（例外なし）', () => {
    const q = new QualityGovernor('auto');
    for (const v of [NaN, -5, Infinity]) expect(q.push(v)).toBe(false);
    expect(q.scale).toBe(1);
  });
});

describe('演出の量（effects.ts）', () => {
  it('動きを減らす: 揺れ 0・フラッシュなし・パーティクル半分。画質の倍率も掛ける', () => {
    expect(effectBudget(false, 1)).toEqual({ scale: 1, shake: true, flash: true });
    expect(effectBudget(true, 1)).toEqual({ scale: 0.5, shake: false, flash: false });
    expect(effectBudget(true, 0.5)).toEqual({ scale: 0.25, shake: false, flash: false });
    expect(effectBudget(false, NaN).scale).toBe(1);
  });

  it('破片の同時の上限は 200（倍率を掛ける）。揺れは 0.5 秒以内', () => {
    expect(shardsMax(1)).toBe(200);
    expect(shardsMax(0.5)).toBe(100);
    expect(EFFECTS.shakeMs).toBeLessThanOrEqual(500);
  });

  it('打撃の破片は 3＋2n（12 まで）、破壊の破片は 1 フレームの上限つき（1,000 個壊れても 48。TS-036-10 の固まらない側）', () => {
    expect(hitShards(1, 1)).toBe(5);
    expect(hitShards(100, 1)).toBe(12);
    expect(hitShards(1, 0.5)).toBe(3);
    expect(breakShards(0, 1)).toBe(0);
    expect(breakShards(1, 1)).toBe(6);
    expect(breakShards(1000, 1)).toBe(EFFECTS.breakShardsPerFrame);
    expect(breakShards(1000, 0.5)).toBe(EFFECTS.breakShardsPerFrame / 2);
    expect(scaled(1, 0.25), '0 より大きい数は少なくとも 1').toBe(1);
  });
});

describe('動きを減らすの決め方（settings.ts）', () => {
  it('on は常に、off は常にしない、auto は OS の prefers-reduced-motion', () => {
    expect([resolveReduceMotion('on', false), resolveReduceMotion('off', true), resolveReduceMotion('auto', true), resolveReduceMotion('auto', false)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});
