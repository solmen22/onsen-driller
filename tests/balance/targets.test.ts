// BL-033: 目標表 24 項目の定義と判定（複数シードの中央値・保留・受け入れ）と、`npm run test` の短縮版の判定
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../tools/sim/report.ts';
import type { SimResult } from '../../tools/sim/sim.ts';
import { DEFAULT_SEEDS, runSuite } from '../../tools/sim/suite.ts';
import { ACCEPTED, inRange, judgeTargets, median, TARGETS, type Accepted } from '../../tools/sim/targets.ts';

const MIN = 60_000;
/** テスト用の受け入れ（#8。幅 12:00〜20:00） */
const acc8: Accepted = { no: 8, reason: 'テストの理由です（十分に長い）', approvedBy: '技術リード', until: 'BL-034', bounds: { min: 12 * MIN, max: 20 * MIN } };

/** 判定に要るところだけを持つ実行の結果（判定の関数のテスト用） */
function fake(bot: string, seed: number, over: Partial<SimResult> = {}): SimResult {
  return {
    bot,
    seed,
    stepMs: 1000,
    hours: 1,
    steps: 3600,
    wallMs: 0,
    hash: '0',
    bestDepth: 0,
    prestiges: 0,
    yunohana: '0',
    totalCoins: '0',
    coins: '0',
    healthy: true,
    stepUsEarly: 0,
    stepUsLate: 0,
    milestones: {},
    newElementGapMs: 0,
    buyGapMs: [0, 0],
    secondRunRatio: null,
    depthAt60: null,
    bathShare: Number.NaN,
    samples: [],
    state: undefined as never,
    ...over,
  };
}

describe('BL-033 目標表の定義（gdd §8-3）', () => {
  it('24 項目が #1〜#24 の順にある', () => {
    expect(TARGETS.map((t) => t.no)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('範囲は受け入れ基準のとおり（#2 5〜15 秒 … #10 25:00〜40:00、#17 250m 以上、#18 50% 超）', () => {
    const r = (no: number): [number | undefined, number | undefined, number | undefined] => {
      const t = TARGETS.find((x) => x.no === no);
      return [t?.min, t?.max, t?.gt];
    };
    expect(r(2)).toEqual([5_000, 15_000, undefined]);
    expect(r(3)).toEqual([30_000, 60_000, undefined]);
    expect(r(4)).toEqual([2 * MIN, 5 * MIN, undefined]);
    expect(r(5)).toEqual([4 * MIN, 8 * MIN, undefined]);
    expect(r(6)).toEqual([4 * MIN, 8 * MIN, undefined]);
    expect(r(7)).toEqual([7 * MIN, 12 * MIN, undefined]);
    expect(r(8)).toEqual([14 * MIN, 20 * MIN, undefined]);
    expect(r(9)).toEqual([undefined, 3 * MIN, undefined]);
    expect(r(10)).toEqual([25 * MIN, 40 * MIN, undefined]);
    expect(r(11)).toEqual([0.35, 0.5, undefined]);
    expect(r(12)).toEqual([50 * MIN, 90 * MIN, undefined]);
    expect(r(13)).toEqual([180 * MIN, 300 * MIN, undefined]);
    expect(r(14)).toEqual([undefined, 60_000, undefined]);
    expect(r(15)).toEqual([undefined, 120_000, undefined]);
    expect(r(17)).toEqual([250, undefined, undefined]);
    expect(r(18)).toEqual([undefined, undefined, 0.5]);
  });

  it('#1 は E2E、#23 は性能の計測（外部）。まだ入っていない要素に依存する項目は保留（理由つき）', () => {
    const kind = (no: number): string | undefined => TARGETS.find((x) => x.no === no)?.kind;
    expect([kind(1), kind(23)]).toEqual(['external', 'external']);
    for (const no of [9, 11, 12, 13, 14, 15, 16, 19, 20, 21, 24]) {
      expect(kind(no)).toBe('pending');
      expect(TARGETS.find((x) => x.no === no)?.pending).toMatch(/BL-\d{3}/);
    }
    for (const no of [2, 3, 4, 5, 6, 7, 8, 10, 17, 18, 22]) expect(kind(no)).toBe('judge');
  });

  it('受け入れ（ACCEPTED）には理由・承認・期限・幅がある（BL-122）', () => {
    for (const a of ACCEPTED) {
      expect(a.reason.length).toBeGreaterThan(10);
      expect(a.bounds.min).toBeLessThan(a.bounds.max);
      expect(a.approvedBy).toMatch(/技術リード/);
      expect(a.until).toMatch(/BL-\d{3}/);
      expect(TARGETS.find((t) => t.no === a.no)?.kind).toBe('judge');
    }
  });
});

describe('BL-033 判定の規則', () => {
  it('中央値（偶数個は真ん中の 2 つの平均）・範囲（両端を含む・「超」は含まない）', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    const t2 = TARGETS.find((t) => t.no === 2);
    const t18 = TARGETS.find((t) => t.no === 18);
    if (!t2 || !t18) throw new Error('定義がない');
    expect([4_999, 5_000, 15_000, 15_001].map((v) => inRange(t2, v))).toEqual([false, true, true, false]);
    expect([0.5, 0.5001].map((v) => inRange(t18, v))).toEqual([false, true]);
  });

  it('シードごとの値の中央値で判定する: 1 本だけ範囲外でも中央値が範囲内なら合格、中央値が範囲外なら失敗', () => {
    const at = (vals: number[]): SimResult[] => vals.map((v, i) => fake('standard', i + 1, { milestones: { firstUpgrade: v } }));
    const t = (runs: SimResult[]) => judgeTargets(runs, []).find((x) => x.def.no === 2);
    expect(t(at([16_000, 14_000, 14_000]))?.verdict).toBe('pass');
    expect(t(at([16_000, 16_000, 14_000]))?.verdict).toBe('fail');
    expect(t(at([16_000, 16_000, 14_000]))?.judged).toBe(16_000);
  });

  it('出来事が半分より多いシードで起きていなければ失敗（起きていない＝範囲外）', () => {
    const runs = [fake('standard', 1, { milestones: { simple: 40_000 } }), fake('standard', 2), fake('standard', 3)];
    expect(judgeTargets(runs, []).find((x) => x.def.no === 3)?.verdict).toBe('fail');
  });

  it('範囲外でも、保留の項目は失敗にしない。受け入れた項目は幅の中なら「受け入れ」になる', () => {
    const runs = [fake('standard', 1, { newElementGapMs: 10 * MIN, milestones: { sulfur: 13 * MIN } })];
    const res = judgeTargets(runs, [acc8]);
    expect(res.find((x) => x.def.no === 9)?.verdict).toBe('pending');
    expect(res.find((x) => x.def.no === 8)?.verdict).toBe('accepted');
    expect(judgeTargets(runs, []).find((x) => x.def.no === 8)?.verdict).toBe('fail');
  });

  it('BL-122 S-1: 受け入れた項目でも、幅の外なら失敗', () => {
    const t8 = (sulfur: number) => judgeTargets([fake('standard', 1, { milestones: { sulfur } })], [acc8]).find((x) => x.def.no === 8);
    expect([11.9 * MIN, 12 * MIN, 13 * MIN].map((v) => t8(v)?.verdict)).toEqual(['fail', 'accepted', 'accepted']);
    expect(t8(8 * MIN)?.accepted?.no).toBe(8); // レポートで「受け入れの幅の外」と書き分ける
  });

  it('BL-122 S-1: 受け入れた項目でも、値がなければ失敗（出来事が起きない）', () => {
    const runs = [fake('standard', 1), fake('standard', 2)];
    const r8 = judgeTargets(runs, [acc8]).find((x) => x.def.no === 8);
    expect(r8?.verdict).toBe('fail');
    // 実行が短く、値がない（その時刻まで流していない）場合も、受け入れにはしない
    const short = judgeTargets([fake('standard', 1, { hours: 0.1 })], [acc8]).find((x) => x.def.no === 8);
    expect([short?.judged, short?.verdict]).toEqual([null, 'fail']);
  });

  it('BL-122: 受け入れた項目が範囲内に戻ったら合格のまま知らせる（stale）', () => {
    const r8 = judgeTargets([fake('standard', 1, { milestones: { sulfur: 15 * MIN } })], [acc8]).find((x) => x.def.no === 8);
    expect([r8?.verdict, r8?.stale]).toEqual(['pass', true]);
    const runs = [fake('standard', 1, { milestones: { sulfur: 15 * MIN } }), fake('idle', 1, { depthAt60: 300 })];
    const files = buildReport(runs, judgeTargets(runs, [acc8]), { seeds: [1] });
    expect(files['summary.md']).toMatch(/範囲内に戻った受け入れ（ACCEPTED から消す）/);
    expect(files['summary.md']).toMatch(/- #8: 判定に使った値 15:00/);
  });

  it('BL-122 S-2: 時刻の項目で、実行の長さまでに起きなかったシードは「範囲より遅い」として中央値に入れる（8 本中 4 本が未達なら失敗）', () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fake('standard', seed, { milestones: seed <= 4 ? { sulfur: 15 * MIN } : {} }));
    const r8 = judgeTargets(runs, []).find((x) => x.def.no === 8);
    expect([r8?.judged, r8?.verdict]).toEqual([Number.POSITIVE_INFINITY, 'fail']);
    expect(r8?.values.filter((x) => x.value === Number.POSITIVE_INFINITY)).toHaveLength(4);
    expect(judgeTargets(runs, [acc8]).find((x) => x.def.no === 8)?.verdict).toBe('fail'); // 受け入れても未達は失敗
    // 8 本中 3 本の未達なら中央値は起きた側（範囲内なら合格）
    const five = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fake('standard', seed, { milestones: seed <= 5 ? { sulfur: 15 * MIN } : {} }));
    expect(judgeTargets(five, []).find((x) => x.def.no === 8)?.verdict).toBe('pass');
  });

  it('BL-122 S-2: 実行が上限より短くて起きなかったシードと、時刻でない項目の値がない実行は、今のとおり中央値から除く', () => {
    // #3（上限 60 秒）: 36 秒の実行で起きなかったシードは除く
    const runs = [fake('standard', 1, { milestones: { simple: 40_000 } }), fake('standard', 2, { milestones: { simple: 40_000 } }), fake('standard', 3, { hours: 0.01 })];
    const r3 = judgeTargets(runs, []).find((x) => x.def.no === 3);
    expect([r3?.judged, r3?.verdict]).toEqual([40_000, 'pass']);
    // #17（60 分の深さ）: 値がない実行は除く
    const idle = [fake('idle', 1, { depthAt60: 300 }), fake('idle', 2, { depthAt60: 300 }), fake('idle', 3)];
    expect(judgeTargets(idle, []).find((x) => x.def.no === 17)?.judged).toBe(300);
  });

  it('#22 はすべての実行（全ボット・全シード）が健全なときだけ合格', () => {
    const ok = judgeTargets([fake('standard', 1), fake('idle', 1)], []).find((x) => x.def.no === 22);
    const ng = judgeTargets([fake('standard', 1), fake('idle', 1, { healthy: false })], []).find((x) => x.def.no === 22);
    expect([ok?.verdict, ng?.verdict]).toEqual(['pass', 'fail']);
  });
});

describe('BL-033 npm run test の短縮版（標準・放置 × シード 1〜8 × 1 時間）', () => {
  const runs = runSuite({ bots: ['standard', 'idle'], seeds: DEFAULT_SEEDS, longHours: 1, shortHours: 1 });
  const res = judgeTargets(runs);

  it('判定する項目（#2〜#8・#10・#17・#18・#22）に失敗がない（受け入れた項目は ACCEPTED の理由つき）', () => {
    const fails = res.filter((r) => r.verdict === 'fail').map((r) => `#${r.def.no} ${String(r.judged)}`);
    expect(fails).toEqual([]);
    const judged = res.filter((r) => r.def.kind === 'judge').map((r) => r.def.no);
    expect(judged).toEqual([2, 3, 4, 5, 6, 7, 8, 10, 17, 18, 22]);
  });

  it('レポートの Markdown・CSV・グラフができる（シードごとの値と判定に使った値が出る）', () => {
    const files = buildReport(runs, res, { seeds: DEFAULT_SEEDS });
    expect(files['summary.md']).toMatch(/判定に使った値（中央値）/);
    expect(files['summary.md']).toMatch(/s8 /);
    expect(files['targets.csv'].split('\n')[0]).toBe('no,label,goal,verdict,judged,seed1,seed2,seed3,seed4,seed5,seed6,seed7,seed8');
    expect(files['series.csv'].split('\n').length).toBeGreaterThan(60);
    expect(files['coins.svg']).toMatch(/^<svg /);
    expect(files['income.svg']).toMatch(/<polyline /);
  });
}, 120_000);
