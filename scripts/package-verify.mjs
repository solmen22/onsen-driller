// npm run package:verify（BL-008。sha256sum -c SHA256SUMS の代わりに Windows でも使える）
// SHA256SUMS の各行のハッシュを検算し、各 zip が壊れていない（CRC）こと、ルートに index.html があること、
// _headers が web の zip にだけあることを確かめる。本番の 4 種（package.json の name・version から作る名前）がそろい、
// SHA256SUMS に載っていない zip が出力先にないことも確かめる。
//
// 使い方: node scripts/package-verify.mjs [--out <dir>]（既定 ./release）
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCTION_TARGETS } from './check-lib.mjs';
import { readZip } from './package-zip.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const outDir = resolve(values.out ?? join(root, 'release'));
const sumsPath = join(outDir, 'SHA256SUMS');
if (!existsSync(sumsPath)) {
  console.error(`package:verify: FAIL ${sumsPath} がない（先に npm run package）`);
  process.exit(1);
}

let failed = false;
const lines = readFileSync(sumsPath, 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
  if (!m) {
    console.error(`NG: SHA256SUMS の行の形が違う: ${line}`);
    failed = true;
    continue;
  }
  const [, want, file] = m;
  const path = join(outDir, file);
  if (!existsSync(path)) {
    console.error(`NG: ${file} がない`);
    failed = true;
    continue;
  }
  const buf = readFileSync(path);
  const problems = [];
  if (createHash('sha256').update(buf).digest('hex') !== want) problems.push('ハッシュが一致しない');
  try {
    const names = readZip(buf).map((e) => e.name);
    if (!names.includes('index.html')) problems.push('ルートに index.html がない');
    const isWeb = /-web-v\d/.test(file);
    if (isWeb !== names.includes('_headers')) problems.push(isWeb ? '_headers がない' : '_headers が入っている');
  } catch (e) {
    problems.push(`zip が壊れている（${e.message}）`);
  }
  if (problems.length) {
    console.error(`NG: ${file}: ${problems.join(' / ')}`);
    failed = true;
  } else console.log(`OK: ${file}`);
}

// 本番の 4 種がそろい、SHA256SUMS に載っていない zip が紛れていないこと（コードレビュー PR #1 の Nit）
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const listed = new Set(lines.map((l) => l.split(/ {2}/)[1]));
const expected = PRODUCTION_TARGETS.map((t) => `${pkg.name}-${t}-v${pkg.version}.zip`);
for (const f of expected)
  if (!listed.has(f)) {
    console.error(`NG: 本番の ${f} が SHA256SUMS にない`);
    failed = true;
  }
for (const f of readdirSync(outDir).filter((n) => n.endsWith('.zip')).sort())
  if (!listed.has(f)) {
    console.error(`NG: ${f} は SHA256SUMS に載っていない（古い zip か、紛れ込んだ zip）`);
    failed = true;
  }
console.log(failed ? 'package:verify: FAIL' : `package:verify: OK（${lines.length} 件）`);
process.exit(failed ? 1 : 0);
