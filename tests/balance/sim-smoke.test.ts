// バランスの短縮版（PR ごとの `npm run test`）。全件は `npm run test:balance`（ボット × シード 1〜8。BL-033）
import { describe, expect, it } from 'vitest';
import { BOTS } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';

/**
 * 標準ボット・シード 1・1 時間・1 秒刻みの最終状態のハッシュ（BL-031。PR #13 のレビューの連絡 4）。
 * core・content・ボットのどこかを変えて結果が変わると、ここが赤になる。数値やボットを意図して変えたときは、
 * この値を更新し、更新の理由と `npm run sim` のレポートの差を PR の説明に書く
 * 更新の記録: f0bcf894 → 7b752600（main の #34〔BL-058 のご褒美の core〕を取り込んだため。状態に温泉チケット・ラッキー鉱脈が入り、
 * 標準ボットでも初来訪のチケットと鉱脈の予約がハッシュに入る。最深 352 → 353m・累計コイン +3%。目標表の判定の値は変わらない）
 * → 23632dc8（ボットの収入の見積もり totalRate に鉱石の価値の倍率〔硫黄泉〕を入れたため。硫黄泉をつないだ後の買い物の順が変わる。
 * 最深 353m のまま・累計コイン 2.770e11 → 2.706e11〔−2.3%〕。目標表の判定は変わらない）
 * → 359e86c9（BL-018 の改良〔12 項目〕と、その数値〔改良のコスト ×10・地層の硬さの伸び g_h 1.066→1.072。CEO 決定 0010〕。
 * 最深 353m → 383m・累計コイン 2.706e11 → 7.549e12。改良だけ〔係数なし〕だと 96d75921・471m・1.263e14。目標表は #8 が範囲内に戻る）
 * → 1a46e86b（BL-021: セーブの版 2 で meta.lastPrestigeGain〔前回の転生で得た湯の華〕を足した。状態の形が変わっただけで、進み方は同じ
 *   〔版と欄を除いて数えると 359e86c9 のまま〕）
 * → e412ab66（BL-022: 周回に run.startDepth〔近道の坑道の始めの深さ〕を足した。状態の形だけで進み方は同じ〔欄を除くと 1a46e86b のまま〕。
 *   標準ボットは木を取らない〔木を取るボットは BL-034〕）
 * → e79c15bf（ボットが転生のたびに湯の華の木を安い順に取る。gdd §8-2・CEO 決定 0011。1 時間で転生 2 → 3 回・
 *   最深 383m → 427m・湯の華の累計 75 → 143・累計コイン 7.549e12 → 1.595e14。目標表は #11 を判定に戻した〔26.0%。BL-034 までの受け入れ〕）
 */
const STANDARD_1H_SEED1_HASH = 'e79c15bf';

describe('TS-031-10 sim (短縮版)', () => {
  it('TS-031-06 標準ボット 1 時間: 同じシードで同じハッシュ、固定値と一致、数値が健全', () => {
    const a = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    const b = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(STANDARD_1H_SEED1_HASH);
    expect(a.healthy).toBe(true);
    expect(a.bestDepth).toBeGreaterThanOrEqual(150);
  });

  it('標準ボット 1 時間: 目標表の出来事の時刻を記録する（源泉は深さの順、#18 の入湯料の割合は 50% 超・100% 以下）', () => {
    const r = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed: 1 });
    const m = r.milestones;
    const order = [m.firstUpgrade, m.simple, m.co2, m.salt, m.sulfur];
    expect(order.every((x) => typeof x === 'number')).toBe(true);
    expect([...(order as number[])].sort((x, y) => x - y)).toEqual(order);
    expect(typeof m.slot2).toBe('number');
    expect(typeof m.lv10Guest).toBe('number');
    expect(r.bathShare).toBeGreaterThan(0.5);
    expect(r.bathShare).toBeLessThanOrEqual(1); // 数え方の検査（頭打ちにしていない。レビュー PR #10 N-3）
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('転生の推奨（#10）は 1 周目で記録し、最初の転生より後にならない（seed %i。同じ時刻もある。PR #13 のレビュー S-1）', (seed) => {
    const m = runBot(BOTS.standard, { hours: 0.5, stepMs: 1000, seed }).milestones;
    expect(typeof m.recommend).toBe('number');
    expect(m.recommend).toBeLessThanOrEqual(m.prestige ?? Infinity);
  });

  it('TS-031-05 標準ボット 20 時間を 1 秒刻みで 2 回流すと、結果（ハッシュ・最深・転生の回数）が同じ（BL-031 の受け入れ基準 3）', () => {
    const a = runBot(BOTS.standard, { hours: 20, stepMs: 1000, seed: 1 });
    const b = runBot(BOTS.standard, { hours: 20, stepMs: 1000, seed: 1 });
    expect([a.hash, a.bestDepth, a.prestiges]).toEqual([b.hash, b.bestDepth, b.prestiges]);
    expect(a.healthy).toBe(true);
  }, 120_000);
});
