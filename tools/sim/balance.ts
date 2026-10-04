// CLI: npm run test:balance（BL-033・BL-090）。ボット × シードを流し、目標表で判定し、reports/balance/ にレポートを書く。
// 範囲外（受け入れていない）か、#23（step の中央値 50µs 未満）を満たさないか、完全な詰み（10 分以上。BL-032）があれば終了コード 1。
// 引数: --seeds 1,2,…（既定 1〜8）・--long 20（最初のシードの時間）・--short 1（残りのシード）・--out reports/balance
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildReport, targetsTable } from './report.ts';
import { benchStep, DEFAULT_SEEDS, runSuite } from './suite.ts';
import { judgeTargets } from './targets.ts';
import { runBot } from './sim.ts';
import { BOTS } from './bots.ts';

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const num = (name: string, def: number): number => {
  const v = Number(argOf(name));
  return Number.isFinite(v) && v > 0 ? v : def;
};
const seeds = (argOf('seeds') ?? '')
  .split(',')
  .filter((x) => x.trim() !== '')
  .map(Number)
  .filter((n) => Number.isSafeInteger(n));
const opts = {
  seeds: seeds.length > 0 ? seeds : DEFAULT_SEEDS,
  longHours: num('long', 20),
  shortHours: num('short', 1),
  now: (): number => performance.now(),
};
const outDir = argOf('out') ?? join('reports', 'balance');

const t0 = performance.now();
const runs = runSuite(opts);
const targets = judgeTargets(runs);
// #23: 序盤（標準ボット 1 分）と 20 時間後（最初のシードの標準ボットの終わり）の状態で step を測る
const late = runs.find((r) => r.bot === 'standard' && r.seed === opts.seeds[0]);
const early = runBot(BOTS.standard, { hours: 1 / 60, stepMs: 100, seed: opts.seeds[0] ?? 1 }).state;
const stepBench = late ? benchStep(early, late.state, () => performance.now()) : undefined;
const files = buildReport(runs, targets, { title: `npm run test:balance（シード ${opts.seeds.join(',')}・${opts.longHours}h／${opts.shortHours}h）`, stepBench, seeds: opts.seeds });
mkdirSync(outDir, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(join(outDir, name), body);

console.log(targetsTable(targets));
const fails = targets.filter((t) => t.verdict === 'fail').map((t) => `#${t.def.no}`);
const benchFail = stepBench !== undefined && !(stepBench.lateUs < 50);
if (stepBench) console.log(`#23 step: late median ${stepBench.lateUs.toFixed(2)} µs, early ${stepBench.earlyUs.toFixed(2)} µs -> ${benchFail ? 'NG' : 'OK'} (target < 50 µs)`);
// BL-032 の受け入れ基準 4: 完全な詰み（買えるものがなく、手動を含む収入も 0）が 10 分以上続いた実行がない（全ボット・全シード）
const stuck = runs.filter((r) => r.maxStuckMs >= 10 * 60_000).map((r) => `${r.bot}/s${r.seed}`);
console.log(`stuck (>= 10 min, all runs): ${stuck.length === 0 ? 'none' : stuck.join(', ')} -> ${stuck.length === 0 ? 'OK' : 'NG'}`);
console.log(`runs=${runs.length} wall=${((performance.now() - t0) / 1000).toFixed(1)}s report=${outDir}`);
if (fails.length > 0 || benchFail) {
  console.error(`test:balance: 範囲外 ${[...fails, ...(benchFail ? ['#23'] : [])].join('・')}（受け入れる場合は tools/sim/targets.ts の ACCEPTED に理由と承認を書く）`);
  process.exit(1);
}
if (stuck.length > 0) {
  console.error(`test:balance: 完全な詰み（10 分以上）${stuck.join(', ')}（BL-032 の受け入れ基準 4）`);
  process.exit(1);
}
console.log('test:balance: OK');
