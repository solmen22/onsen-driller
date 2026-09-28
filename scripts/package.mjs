// npm run package（BL-008。infra 付録 A-2・runbook §3）
// dist/<target>（本番の 4 種）→ release/<name>-<target>-v<version>.zip と release/SHA256SUMS
//
// 使い方: node scripts/package.mjs [--dist <dir>] [--out <dir>] [target ...]
//   - 既定のターゲットは web・crazygames・itch・poki。e2e 系（テスト用フック入り）は指定しても作らない
//   - 版は package.json の version。環境変数 RELEASE_TAG（release.yml が渡す）があれば v<version> と一致を求める
//   - 先に build:all と check:size を通しておくこと（CI・release.yml はその順で実行する）
// zip のルートに index.html を置く（dist/web/ のような階層を付けない）。SHA256SUMS は sha256sum -c でそのまま検証できる形
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCTION_TARGETS, walk } from './check-lib.mjs';
import { createZip, readZip } from './package-zip.mjs';

const root = resolve(import.meta.dirname, '..');
const { values, positionals } = parseArgs({
  options: { dist: { type: 'string' }, out: { type: 'string' } },
  allowPositionals: true,
});
const distRoot = resolve(values.dist ?? join(root, 'dist'));
const outDir = resolve(values.out ?? join(root, 'release'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${pkg.version}`;

const die = (msg) => {
  console.error(`package: FAIL ${msg}`);
  process.exit(1);
};

if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== tag)
  die(`RELEASE_TAG=${process.env.RELEASE_TAG} と package.json の version（${tag}）が一致しない`);

const targets = positionals.length ? positionals : PRODUCTION_TARGETS;
const notProduction = targets.filter((t) => !PRODUCTION_TARGETS.includes(t));
if (notProduction.length) die(`本番のターゲットではない（zip にしない）: ${notProduction.join(', ')}`);

// 書き出す前に全ターゲットを確かめる（足りなければ何も作らない）
const missing = targets.filter((t) => {
  const d = join(distRoot, t);
  return !existsSync(d) || !statSync(d).isDirectory() || !existsSync(join(d, 'index.html'));
});
if (missing.length) die(`ビルドがないか、ルートに index.html がない: ${missing.join(', ')}（先に npm run build:all）`);

// 前回の出力を消す（古い zip・古い SHA256SUMS の行を混ぜない）
mkdirSync(outDir, { recursive: true });
const prefix = `${pkg.name}-`;
for (const f of readdirSync(outDir)) {
  if (f === 'SHA256SUMS' || (f.startsWith(prefix) && f.endsWith('.zip'))) rmSync(join(outDir, f));
}

const sums = [];
console.log(`package: ${tag} → ${outDir}`);
console.log('| zip | files | bytes | sha256 |');
console.log('|---|---|---|---|');
for (const t of targets) {
  const dir = join(distRoot, t);
  const entries = walk(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
  const zip = createZip(entries);
  const names = readZip(zip).map((e) => e.name); // 書いた zip を読み戻して確かめる
  if (!names.includes('index.html')) die(`${t}: zip のルートに index.html がない`);
  const file = `${pkg.name}-${t}-${tag}.zip`;
  writeFileSync(join(outDir, file), zip);
  const hash = createHash('sha256').update(zip).digest('hex');
  sums.push(`${hash}  ${file}`);
  console.log(`| ${file} | ${entries.length} | ${zip.length.toLocaleString('en-US')} | ${hash.slice(0, 16)}… |`);
}
writeFileSync(join(outDir, 'SHA256SUMS'), `${sums.sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join('\n')}\n`);
console.log(`package: OK（zip ${targets.length} 個＋SHA256SUMS）`);
