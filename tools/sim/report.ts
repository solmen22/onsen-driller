// バランスのレポート（BL-033）: Markdown の表・CSV・時間 × 所持金・生産量のグラフ（SVG）を文字列で作る。
// ファイルに書くのは CLI（run.ts・balance.ts）。ここは決定論の範囲（時刻・乱数・DOM を使わない）
import type { SimResult } from './sim.ts';
import { fmtValue, VERDICT_MARK, type TargetResult } from './targets.ts';

export interface ReportExtras {
  /** レポートの見出しに出す説明（コミット・コマンドなど。CLI が渡す） */
  title?: string;
  /** #23: 20 時間後の状態の step の中央値（µs）と序盤の値 */
  stepBench?: { earlyUs: number; lateUs: number };
  /** 判定のシード */
  seeds: readonly number[];
}

export type ReportFileName = 'summary.md' | 'targets.csv' | 'series.csv' | 'coins.svg' | 'income.svg';
export type ReportFiles = Record<ReportFileName, string>;

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csvRow = (cells: (string | number | null)[]): string => cells.map(csvCell).join(',');

function targetsMarkdown(targets: readonly TargetResult[]): string {
  const lines = ['| # | 出来事 | 目標 | 判定に使った値（中央値） | シードごとの値 | 判定 |', '|---|---|---|---|---|---|'];
  for (const t of targets) {
    const per =
      t.def.no === 22
        ? `${t.values.filter((x) => x.value === 1).length}/${t.values.length} 本が健全（全ボット・全シード）`
        : t.values.length > 0
          ? t.values.map((x) => `s${x.seed} ${fmtValue(t.def.unit, x.value)}`).join('・')
          : '—';
    const note = t.def.kind === 'pending' ? `保留（${t.def.pending ?? ''}）` : t.def.kind === 'external' ? `外部（${t.def.external ?? ''}）` : VERDICT_MARK[t.verdict];
    lines.push(`| ${t.def.no} | ${t.def.label} | ${t.def.goal} | ${fmtValue(t.def.unit, t.judged)} | ${per} | ${note} |`);
  }
  return lines.join('\n');
}

function runsMarkdown(runs: readonly SimResult[]): string {
  const lines = ['| ボット | シード | 時間 | 最深 | 転生 | 湯の華 | 健全 | ハッシュ | 実時間 ms |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of runs) lines.push(`| ${r.bot} | ${r.seed} | ${r.hours}h | ${r.bestDepth}m | ${r.prestiges} | ${r.yunohana} | ${r.healthy ? '○' : '×'} | ${r.hash} | ${Math.round(r.wallMs)} |`);
  return lines.join('\n');
}

// ---- グラフ（SVG）: 3 本までの折れ線。縦軸は対数（1 本の軸）。色は分類の 1〜3 番（順番は固定。ボットに付く） ----
const SERIES_COLORS: Readonly<Record<string, string>> = { standard: '#2a78d6', active: '#eb6834', idle: '#1baf7a' };
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const GRID = '#e4e3dd';

interface Series {
  id: string;
  points: { x: number; y: number }[];
}

function lineChart(title: string, yLabel: string, series: readonly Series[]): string {
  const W = 760;
  const H = 380;
  const m = { l: 64, r: 110, t: 48, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const xMax = Math.max(1, Math.ceil(Math.max(0, ...xs) - 1e-9));
  const ys = series.flatMap((s) => s.points.map((p) => Math.log10(Math.max(1, p.y))));
  const yMax = Math.max(1, Math.ceil(Math.max(0, ...ys)));
  const px = (x: number): number => m.l + (x / xMax) * pw;
  const py = (y: number): number => m.t + ph - (Math.log10(Math.max(1, y)) / yMax) * ph;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`);
  out.push(`<title>${title}</title>`);
  out.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  out.push(`<text x="${m.l}" y="22" font-size="14" font-weight="600" fill="${INK}">${title}</text>`);
  // 縦軸（10 のべき乗。数が多いときは間引く）
  const stepY = Math.max(1, Math.ceil(yMax / 8));
  for (let e = 0; e <= yMax; e += stepY) {
    const y = m.t + ph - (e / yMax) * ph;
    out.push(`<line x1="${m.l}" y1="${y.toFixed(1)}" x2="${m.l + pw}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`);
    out.push(`<text x="${m.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="${INK_2}">1e${e}</text>`);
  }
  // 横軸（時間）
  const stepX = xMax > 10 ? Math.ceil(xMax / 10) : 1;
  for (let x = 0; x <= xMax + 1e-9; x += stepX) {
    const X = px(x);
    out.push(`<line x1="${X.toFixed(1)}" y1="${m.t + ph}" x2="${X.toFixed(1)}" y2="${m.t + ph + 4}" stroke="${INK_2}" stroke-width="1"/>`);
    out.push(`<text x="${X.toFixed(1)}" y="${m.t + ph + 18}" text-anchor="middle" fill="${INK_2}">${x}</text>`);
  }
  out.push(`<line x1="${m.l}" y1="${m.t + ph}" x2="${m.l + pw}" y2="${m.t + ph}" stroke="${INK_2}" stroke-width="1"/>`);
  out.push(`<text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle" fill="${INK_2}">プレイ時間（時間）</text>`);
  out.push(`<text x="16" y="${m.t + ph / 2}" text-anchor="middle" fill="${INK_2}" transform="rotate(-90 16 ${m.t + ph / 2})">${yLabel}（対数）</text>`);
  // 凡例（上）と線
  series.forEach((s, i) => {
    const color = SERIES_COLORS[s.id] ?? INK_2;
    const lx = m.l + 150 + i * 110;
    out.push(`<line x1="${lx}" y1="18" x2="${lx + 18}" y2="18" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
    out.push(`<text x="${lx + 24}" y="22" fill="${INK}">${s.id}</text>`);
    const pts = s.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
    out.push(`<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"><title>${s.id}</title></polyline>`);
  });
  // 線の終わりの直接の名前（上から順に並べ、14px 以上離して重ならないようにする）
  const ends = series
    .map((s) => ({ id: s.id, last: s.points[s.points.length - 1] }))
    .filter((e): e is { id: string; last: { x: number; y: number } } => e.last !== undefined)
    .map((e) => ({ id: e.id, x: px(e.last.x) + 6, y: py(e.last.y) + 4 }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1];
    const cur = ends[i];
    if (prev && cur && cur.y - prev.y < 14) cur.y = prev.y + 14;
  }
  for (const e of ends) out.push(`<text x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}" fill="${INK}">${e.id}</text>`);
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

/** レポートのファイル一式（ファイル名 → 中身）。グラフと series.csv は各ボットの最初のシード（長い実行） */
export function buildReport(runs: readonly SimResult[], targets: readonly TargetResult[], extras: ReportExtras): ReportFiles {
  const firstSeed = extras.seeds[0];
  const long = runs.filter((r) => r.seed === firstSeed);
  const fails = targets.filter((t) => t.verdict === 'fail');
  const accepted = targets.filter((t) => t.verdict === 'accepted');
  const md: string[] = [];
  md.push(`# バランスのレポート${extras.title ? ` — ${extras.title}` : ''}`);
  md.push('');
  md.push(`- 判定: **${fails.length === 0 ? '合格' : `不合格（${fails.map((t) => `#${t.def.no}`).join('・')}）`}**。受け入れ ${accepted.length} 件、保留 ${targets.filter((t) => t.verdict === 'pending').length} 件`);
  md.push(`- 方法: シード ${extras.seeds.join('・')} で流し、シードごとの値の中央値で判定（docs/balance.md）。最初のシードは長く流す（全体の健全性・転生・#12・#13）`);
  if (extras.stepBench) {
    const ok = extras.stepBench.lateUs < 50;
    md.push(`- #23 step の処理時間: 20 時間後の状態で中央値 **${extras.stepBench.lateUs.toFixed(2)}µs**（${ok ? '○' : '×'} 目標 50µs 未満）、序盤 ${extras.stepBench.earlyUs.toFixed(2)}µs（比は記録だけ）`);
  }
  md.push('');
  md.push('## 目標表（gdd §8-3）');
  md.push('');
  md.push(targetsMarkdown(targets));
  if (accepted.length > 0) {
    md.push('');
    md.push('## 範囲外を受け入れた項目（gdd §8-6）');
    md.push('');
    for (const t of accepted) md.push(`- #${t.def.no}: ${t.accepted?.reason ?? ''}（承認: ${t.accepted?.approvedBy ?? ''}。期限: ${t.accepted?.until ?? ''}）`);
  }
  md.push('');
  md.push('## 実行');
  md.push('');
  md.push(runsMarkdown(runs));
  md.push('');
  md.push('グラフ: `coins.svg`（所持金）・`income.svg`（毎秒の収入）。表: `targets.csv`・`series.csv`');
  md.push('');

  const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
  const tcsv = [csvRow(['no', 'label', 'goal', 'verdict', 'judged', ...seeds.map((s) => `seed${s}`)])];
  for (const t of targets) {
    const bySeed = new Map(t.values.map((x) => [x.seed, x.value]));
    tcsv.push(csvRow([t.def.no, t.def.label, t.def.goal, t.verdict, t.judged, ...seeds.map((s) => bySeed.get(s) ?? null)]));
  }
  const scsv = [csvRow(['bot', 'seed', 't_min', 'coins', 'income_per_sec', 'depth', 'max_depth'])];
  for (const r of long) for (const p of r.samples) scsv.push(csvRow([r.bot, r.seed, p.tMs / 60_000, p.coins, p.incomePerSec, p.depth, p.maxDepth]));

  const toHours = (r: SimResult, pick: (p: SimResult['samples'][number]) => number): Series => ({
    id: r.bot,
    points: r.samples.map((p) => ({ x: p.tMs / 3_600_000, y: pick(p) })),
  });
  return {
    'summary.md': `${md.join('\n')}`,
    'targets.csv': `${tcsv.join('\n')}\n`,
    'series.csv': `${scsv.join('\n')}\n`,
    'coins.svg': lineChart('所持金（シード ' + String(firstSeed) + '）', 'コイン', long.map((r) => toHours(r, (p) => p.coins))),
    'income.svg': lineChart('毎秒の収入（シード ' + String(firstSeed) + '）', 'コイン/秒', long.map((r) => toHours(r, (p) => p.incomePerSec))),
  };
}

/** 端末に出す短い表（目標表だけ） */
export const targetsTable = (targets: readonly TargetResult[]): string => targetsMarkdown(targets);
