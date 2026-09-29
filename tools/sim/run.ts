// CLI: node tools/sim/run.ts [--step 1000] [--hours 20] [--seed 1]
// PoC-2 の計測: ボット 3 種 × 20 時間の所要時間、刻み幅の差、同じシードで同じハッシュ
import { performance } from 'node:perf_hooks';
import { advance, cloneState, stateHash } from '../../src/core/index.ts';
import { BOTS } from './bots.ts';
import { fmtClock, judge, MILESTONES } from './milestones.ts';
import { relDiff, runBot } from './sim.ts';

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const stepMs = arg('step', 1000);
const hours = arg('hours', 20);
const seed = arg('seed', 1);
const now = (): number => performance.now();

console.log(`# sim: bots=3 hours=${hours} stepMs=${stepMs} seed=${seed} node=${process.version}`);
const t0 = now();
const results = [BOTS.active, BOTS.standard, BOTS.idle].map((b) => runBot(b, { hours, stepMs, seed, now }));
const total = now() - t0;
console.log('| bot | steps | wall ms | bestDepth | prestiges | yunohana | totalCoins | healthy | step µs early | step µs late | hash |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(
    `| ${r.bot} | ${r.steps} | ${r.wallMs.toFixed(0)} | ${r.bestDepth} | ${r.prestiges} | ${r.yunohana} | ${r.totalCoins} | ${r.healthy} | ${r.stepUsEarly.toFixed(2)} | ${r.stepUsLate.toFixed(2)} | ${r.hash} |`,
  );
}
console.log(`TOTAL wall ms (3 bots): ${total.toFixed(0)}`);

// 目標表（gdd §8-3）の出来事が初めて起きた時刻（ロジックの時間）。判定は標準ボット（BL-033 で CI の判定にする。ここは表示だけ）
console.log('');
console.log(`| # | 出来事 | 目標の範囲 | ${results.map((r) => r.bot).join(' | ')} | 標準の判定 |`);
console.log(`|---|---|---|${results.map(() => '---|').join('')}---|`);
const standard = results.find((r) => r.bot === 'standard');
for (const m of MILESTONES) {
  const range = m.rangeSec ? `${fmtClock(m.rangeSec[0] * 1000)}〜${fmtClock(m.rangeSec[1] * 1000)}` : '—';
  console.log(`| ${m.no || '—'} | ${m.label} | ${range} | ${results.map((r) => fmtClock(r.milestones[m.id])).join(' | ')} | ${judge(m, standard?.milestones[m.id])} |`);
}
const share = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const shareOk = standard && Number.isFinite(standard.bathShare) ? (standard.bathShare > 0.5 ? '○' : '×') : '—';
console.log(`| 18 | 5〜60 分の収入のうち入湯料の割合 | 50% 超 | ${results.map((r) => share(r.bathShare)).join(' | ')} | ${shareOk} |`);
console.log('');

// 同じシードで同じハッシュ（標準ボットをもう一度）
const again = runBot(BOTS.standard, { hours, stepMs, seed });
console.log(`determinism: standard hash ${results[1]?.hash} vs rerun ${again.hash} -> ${results[1]?.hash === again.hash ? 'MATCH' : 'MISMATCH'}`);

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

// 刻み幅の差（ボットあり）: 標準ボット 1 時間を 0.1 秒刻みと 1 秒刻みで
const b100 = runBot(BOTS.standard, { hours: 1, stepMs: 100, seed });
const b1000 = runBot(BOTS.standard, { hours: 1, stepMs: 1000, seed });
console.log(
  `timestep with bot (standard 1h): 100ms totalCoins=${b100.totalCoins} depth=${b100.bestDepth} / 1000ms totalCoins=${b1000.totalCoins} depth=${b1000.bestDepth} diffCoins=${(relDiff(Number(b100.totalCoins), Number(b1000.totalCoins)) * 100).toFixed(4)}% diffDepth=${(relDiff(b100.bestDepth, b1000.bestDepth) * 100).toFixed(4)}%`,
);

// step の処理時間（目標表 #23。決定 0006-3）: 20 時間後の状態で中央値 50µs 未満（かつ 1ms 未満）。序盤（1 分後）との比は記録だけ。
// ウォームアップは別の複製で行い、各 20,000 回を交互に 5 回測って中央値をとる
type St = ReturnType<typeof runBot>['state'];
const ev: Parameters<typeof advance>[3] = [];
const timeSteps = (src: St, n: number): number => {
  const s = cloneState(src);
  const t = now();
  for (let i = 0; i < n; i++) {
    advance(s, 100, 100, ev);
    ev.length = 0;
  }
  return ((now() - t) * 1000) / n;
};
const earlyState = runBot(BOTS.standard, { hours: 1 / 60, stepMs: 100, seed }).state;
const lateState = results[1]!.state;
timeSteps(earlyState, 50_000);
timeSteps(lateState, 50_000);
const e: number[] = [];
const l: number[] = [];
for (let k = 0; k < 5; k++) {
  e.push(timeSteps(earlyState, 20_000));
  l.push(timeSteps(lateState, 20_000));
}
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
console.log(`step bench early (standard, 1 min): median ${med(e).toFixed(2)} µs/step [${e.map((x) => x.toFixed(2)).join(', ')}]`);
console.log(`step bench late (standard, ${hours} h): median ${med(l).toFixed(2)} µs/step [${l.map((x) => x.toFixed(2)).join(', ')}]`);
console.log(`#23 step late median ${med(l).toFixed(2)} µs -> ${med(l) < 50 ? 'OK' : 'NG'} (target: median < 50 µs, and < 1000 µs)`);
console.log(`step late/early = ${(med(l) / med(e)).toFixed(2)} (recorded only; decision 0006-3)`);
