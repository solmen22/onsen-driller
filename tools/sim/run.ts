// CLI: npm run sim [--step 1000] [--hours 20] [--seed 1] [--out reports/balance]
// バランスのレポート（BL-033: 目標表・CSV・グラフを reports/balance/ に）と、PoC からの計測（決定論・刻み幅の差・#23）を出す。
// 判定で失敗にするのは npm run test:balance（ここは終了コード 0）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { advance, cloneState, stateHash } from '../../src/core/index.ts';
import { BOTS } from './bots.ts';
import { buildReport, targetsTable } from './report.ts';
import { relDiff, runBot } from './sim.ts';
import { benchStep, DEFAULT_SEEDS, runSuite } from './suite.ts';
import { judgeTargets } from './targets.ts';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const stepMs = arg('step', 1000);
const hours = arg('hours', 20);
const seed = arg('seed', 1);
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx >= 0 ? (process.argv[outIdx + 1] ?? join('reports', 'balance')) : join('reports', 'balance');
const now = (): number => performance.now();

const seeds = [seed, ...DEFAULT_SEEDS.filter((s) => s !== seed)];
console.log(`# sim: bots=standard,active,idle seeds=${seeds.join(',')} hours=${hours}（2 本目以降のシードは 1 時間） stepMs=${stepMs} node=${process.version}`);
const t0 = now();
const runs = runSuite({ seeds, longHours: hours, shortHours: 1, stepMs, now });
const total = now() - t0;
const long = runs.filter((r) => r.seed === seed);
console.log('| bot | steps | wall ms | bestDepth | prestiges | yunohana | totalCoins | healthy | step µs early | step µs late | hash |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of long) {
  console.log(
    `| ${r.bot} | ${r.steps} | ${r.wallMs.toFixed(0)} | ${r.bestDepth} | ${r.prestiges} | ${r.yunohana} | ${r.totalCoins} | ${r.healthy} | ${r.stepUsEarly.toFixed(2)} | ${r.stepUsLate.toFixed(2)} | ${r.hash} |`,
  );
}
console.log(`TOTAL wall ms (${runs.length} runs): ${total.toFixed(0)}`);
console.log('');
const targets = judgeTargets(runs);
console.log(targetsTable(targets));
console.log('');

// 同じシードで同じハッシュ（標準ボットをもう一度）
const std = long.find((r) => r.bot === 'standard');
const again = runBot(BOTS.standard, { hours, stepMs, seed });
console.log(`determinism: standard hash ${std?.hash} vs rerun ${again.hash} -> ${std?.hash === again.hash ? 'MATCH' : 'MISMATCH'}`);

// 刻み幅の差: 標準ボットが 30 分遊んだ状態から、操作なしで 1 時間進める（0.1 秒・1 秒・10 秒刻み）
const base = runBot(BOTS.standard, { hours: 0.5, stepMs: 100, seed }).state;
const variants = [100, 1000, 10_000].map((ms) => {
  const s = cloneState(base);
  advance(s, 3_600_000, ms);
  return { ms, s };
});
const ref = variants[0]!.s;
for (const v of variants) {
  const dc = relDiff(v.s.stats.totalCoins.toNumber(), ref.stats.totalCoins.toNumber());
  const dd = relDiff(v.s.run.maxDepth, ref.run.maxDepth);
  console.log(
    `timestep ${v.ms}ms (idle 1h from 30min state): totalCoins=${v.s.stats.totalCoins.toString()} maxDepth=${v.s.run.maxDepth} hits=${v.s.stats.hits} diffCoins=${(dc * 100).toFixed(4)}% diffDepth=${(dd * 100).toFixed(4)}% hash=${stateHash(v.s)}`,
  );
}

// step の処理時間（目標表 #23。決定 0006-3）: 20 時間後の状態で中央値 50µs 未満（かつ 1ms 未満）。序盤（1 分後）との比は記録だけ
const earlyState = runBot(BOTS.standard, { hours: 1 / 60, stepMs: 100, seed }).state;
const bench = std ? benchStep(earlyState, std.state, now) : undefined;
if (bench) {
  console.log(`#23 step late median ${bench.lateUs.toFixed(2)} µs -> ${bench.lateUs < 50 ? 'OK' : 'NG'} (target: median < 50 µs, and < 1000 µs)`);
  console.log(`step late/early = ${(bench.lateUs / bench.earlyUs).toFixed(2)} (recorded only; decision 0006-3)`);
}

const files = buildReport(runs, targets, { title: `npm run sim（シード ${seeds.join(',')}）`, stepBench: bench, seeds });
mkdirSync(outDir, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(outDir, name), body);
console.log(`report: ${outDir}（summary.md・targets.csv・series.csv・coins.svg・income.svg）`);
