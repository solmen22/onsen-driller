// ビルド検査（arch §16-3・DevOps infra.md §5-3・QA test-strategy §4-5）
// 使い方: node scripts/check-size.mjs [dist のターゲット名 ...]（省略時は dist/ にあるものすべて）
// 失敗が 1 つでもあれば終了コード 1
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const distRoot = resolve(root, 'dist');
const KB = 1024;
const MB = 1024 * 1024;
const BUDGET = {
  initialGzipFail: 5 * MB, // Poki の目安
  initialGzipTarget: 1.5 * MB,
  totalRawPoki: 8 * MB, // Poki の目安（合計）
  totalRawSelf: 20 * MB, // DevOps の自主予算
  files: 300, // DevOps の自主予算
};
const SDK = { crazygames: 'sdk.crazygames.com', poki: 'game-cdn.poki.com' };
const expectations = {
  web: { cg: false, poki: false, hooks: false, headers: true },
  itch: { cg: false, poki: false, hooks: false, headers: false },
  crazygames: { cg: true, poki: false, hooks: false, headers: false },
  poki: { cg: false, poki: true, hooks: false, headers: false },
  e2e: { cg: false, poki: false, hooks: true, headers: false },
  'e2e-crazygames': { cg: true, poki: false, hooks: true, headers: false },
  'e2e-poki': { cg: false, poki: true, hooks: true, headers: false },
};
const TEXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.txt', '.map', '']);

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : existsSync(distRoot)
    ? readdirSync(distRoot).filter((d) => statSync(join(distRoot, d)).isDirectory())
    : [];
if (!targets.length) {
  console.error('check-size: dist/ にビルドがない');
  process.exit(1);
}

let failed = false;
const rows = [];
for (const t of targets) {
  const dir = join(distRoot, t);
  const exp = expectations[t];
  const fails = [];
  const warns = [];
  if (!existsSync(dir)) {
    fails.push('ビルドがない');
    rows.push({ t, fails, warns });
    failed = true;
    continue;
  }
  const files = walk(dir);
  let raw = 0;
  let gz = 0;
  let hasCg = false;
  let hasPoki = false;
  let hasHooks = false;
  for (const f of files) {
    const buf = readFileSync(f);
    raw += buf.length;
    const ext = extname(f).toLowerCase();
    gz += TEXT.has(ext) ? gzipSync(buf, { level: 9 }).length : buf.length; // png・woff2 は圧縮済み
    const rel = relative(dir, f).replaceAll('\\', '/');
    if (!/^[a-z0-9._/-]+$/.test(rel) && rel !== '_headers') fails.push(`ファイル名に大文字・記号・ASCII 以外: ${rel}`);
    if (rel.length > 200) fails.push(`パスが長い: ${rel}`);
    if (buf.length > 25 * MB) fails.push(`25MiB を超えるファイル: ${rel}`);
    if (TEXT.has(ext)) {
      const s = buf.toString('utf8');
      if (s.includes(SDK.crazygames)) hasCg = true;
      if (s.includes(SDK.poki)) hasPoki = true;
      if (s.includes('__game')) hasHooks = true;
    }
  }
  const index = join(dir, 'index.html');
  if (!existsSync(index)) fails.push('index.html がルートにない');
  else {
    const html = readFileSync(index, 'utf8');
    if (/\s(src|href)="\/(?!\/)/.test(html)) fails.push('index.html に絶対パス（src="/…"・href="/…"）がある');
  }
  const hasHeaders = existsSync(join(dir, '_headers'));
  if (exp) {
    if (hasCg !== exp.cg) fails.push(`${SDK.crazygames} の有無が想定と違う（${hasCg}）`);
    if (hasPoki !== exp.poki) fails.push(`${SDK.poki} の有無が想定と違う（${hasPoki}）`);
    if (hasHooks !== exp.hooks) fails.push(`__game（テスト用フック）の有無が想定と違う（${hasHooks}）`);
    if (hasHeaders !== exp.headers) fails.push(`_headers の有無が想定と違う（${hasHeaders}）`);
  } else warns.push('想定表にないターゲット（SDK・フックの検査なし）');
  if (files.length > BUDGET.files) fails.push(`ファイル数 ${files.length} > ${BUDGET.files}`);
  if (gz > BUDGET.initialGzipFail) fails.push(`初回ダウンロード（gzip 換算）${(gz / MB).toFixed(2)}MB > 5MB`);
  else if (gz > BUDGET.initialGzipTarget) warns.push(`初回ダウンロード（gzip 換算）${(gz / MB).toFixed(2)}MB > 目標 1.5MB`);
  if (raw > BUDGET.totalRawPoki) fails.push(`合計 ${(raw / MB).toFixed(2)}MB > 8MB`);
  if (raw > BUDGET.totalRawSelf) fails.push(`合計 ${(raw / MB).toFixed(2)}MB > 20MB`);
  if (fails.length) failed = true;
  rows.push({ t, files: files.length, raw, gz, hasCg, hasPoki, hasHooks, hasHeaders, fails, warns });
}

console.log('| target | files | raw KB | gzip KB | crazygames SDK | poki SDK | __game | _headers | result |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const res = r.fails.length ? `FAIL: ${r.fails.join(' / ')}` : r.warns.length ? `OK（注意: ${r.warns.join(' / ')}）` : 'OK';
  console.log(
    `| ${r.t} | ${r.files ?? '-'} | ${r.raw ? (r.raw / KB).toFixed(1) : '-'} | ${r.gz ? (r.gz / KB).toFixed(1) : '-'} | ${r.hasCg ?? '-'} | ${r.hasPoki ?? '-'} | ${r.hasHooks ?? '-'} | ${r.hasHeaders ?? '-'} | ${res} |`,
  );
}
process.exit(failed ? 1 : 0);
