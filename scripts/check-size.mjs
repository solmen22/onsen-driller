// ビルド検査 check:size（BL-008。arch §16-3・infra §5-3・QA test-strategy §4-4・§4-5）
//
// 使い方:
//   node scripts/check-size.mjs [--dist <dir>] [--headers <file>] [target ...]
//   - --dist    ビルドの親ディレクトリ（既定 ./dist。環境変数 CHECK_DIST でも可）
//   - --headers dist/web/_headers と一致すべき原本（既定 ./deploy/web/_headers）
//   - target    検査するターゲット名（省略時は --dist の下のディレクトリすべて。そのときは本番の 4 種がそろっていることも求める）
// 失敗が 1 つでもあれば終了コード 1。警告だけなら 0。
// 規則の一覧（[規則 ID] で出力する）:
//   dist.missing / index.missing / name.invalid / path.long / file.large / files.count
//   size.initial（初回 gzip 5MB 超）/ size.initial.warn（1.5MB 超・警告）/ size.total（合計 8MB 超）/ size.self（20MB 超）
//   path.absolute（HTML・SVG の src・href・xlink:href・data・srcset・poster と CSS の url()・@import が / で始まる。// も含む）
//   sourcemap（本番ビルドに .map か sourceMappingURL）
//   mix.crazygames / mix.poki / mix.hooks / mix.headers（SDK・テスト用フック・_headers の混入と欠落）
//   headers.diff（dist/web/_headers が deploy/web/_headers と違う）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BUDGET, HOOK, MB, PRODUCTION_TARGETS, SDK, TARGETS, UNKNOWN_TARGET,
  extOf, fmtKB, fmtMB, isExcludedFromInitial, transferSize, walk,
} from './check-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const { values, positionals } = parseArgs({
  options: { dist: { type: 'string' }, headers: { type: 'string' } },
  allowPositionals: true,
});
const distRoot = resolve(values.dist ?? process.env.CHECK_DIST ?? join(root, 'dist'));
const headersSrc = resolve(values.headers ?? join(root, 'deploy', 'web', '_headers'));

const targets = positionals.length
  ? positionals
  : existsSync(distRoot)
    ? readdirSync(distRoot).filter((d) => statSync(join(distRoot, d)).isDirectory()).sort()
    : [];
if (!targets.length) {
  console.error(`check:size: ${distRoot} にビルドがない（先に npm run build:all）`);
  process.exit(1);
}

// ターゲットを指定しないときは、本番の 4 種がそろっていることも求める（build:all から 1 つ抜けても緑にならないように。ないものは dist.missing）
if (!positionals.length) for (const t of PRODUCTION_TARGETS) if (!targets.includes(t)) targets.push(t);

const NAME_OK = /^[a-z0-9.-]+$/; // 1 階層ごと。英小文字・数字・ドット・ハイフンだけ
const HTML_ATTR = /\s(src|href|xlink:href|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const HTML_SRCSET = /\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(["']?)\s*([^"')\s]*)/gi;
const CSS_IMPORT = /@import\s+(["'])\s*([^"']*)/gi;
const isAbsolute = (u) => u.trim().startsWith('/'); // "/x" と "//host/x" の両方

/** HTML・CSS のテキストから、/ で始まる参照を探す */
function findAbsolutePaths(text, isHtml) {
  const hits = [];
  if (isHtml) {
    for (const m of text.matchAll(HTML_ATTR)) {
      const v = m[2] ?? m[3] ?? m[4] ?? '';
      if (isAbsolute(v)) hits.push(m[0].trim());
    }
    for (const m of text.matchAll(HTML_SRCSET)) {
      const v = m[1] ?? m[2] ?? '';
      if (v.split(',').some((c) => isAbsolute(c))) hits.push(m[0].trim());
    }
  }
  // CSS（.css と、HTML の <style>・style 属性）
  for (const m of text.matchAll(CSS_URL)) if (isAbsolute(m[2])) hits.push(m[0].trim());
  for (const m of text.matchAll(CSS_IMPORT)) if (isAbsolute(m[2])) hits.push(m[0].trim());
  return hits;
}

const results = [];
for (const t of targets) {
  const dir = join(distRoot, t);
  const exp = TARGETS[t] ?? UNKNOWN_TARGET;
  const fails = [];
  const warns = [];
  const fail = (rule, msg) => fails.push(`[${rule}] ${msg}`);
  if (!TARGETS[t]) warns.push(`[target.unknown] 想定表にないターゲット（SDK・フック・_headers は「なし」として検査）`);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail('dist.missing', `${dir} がない`);
    results.push({ t, fails, warns });
    continue;
  }

  const files = walk(dir);
  let raw = 0;
  let initial = 0;
  const found = { cg: [], poki: [], hooks: [] };
  for (const rel of files) {
    const buf = readFileSync(join(dir, rel));
    raw += buf.length;
    if (!isExcludedFromInitial(rel)) initial += transferSize(buf, rel);

    // ファイル名（itch.io・Linux は大文字小文字を区別する）
    if (rel !== '_headers' && !rel.split('/').every((seg) => NAME_OK.test(seg)))
      fail('name.invalid', `ファイル名に大文字・空白・記号・ASCII 以外: ${rel}`);
    if (rel.length > BUDGET.pathMax) fail('path.long', `パスが ${BUDGET.pathMax} 文字を超える: ${rel}`);
    if (buf.length > BUDGET.fileMax) fail('file.large', `25 MiB を超えるファイル: ${rel}`);

    // 混入の検査は拡張子によらず全ファイルのバイト列で行う（.js 以外の .html・.json・.css・.map も対象）
    if (buf.includes(SDK.crazygames)) found.cg.push(rel);
    if (buf.includes(SDK.poki)) found.poki.push(rel);
    if (buf.includes(HOOK)) found.hooks.push(rel);

    const ext = extOf(rel);
    if (ext === '.html' || ext === '.htm' || ext === '.svg' || ext === '.css') {
      for (const h of findAbsolutePaths(buf.toString('utf8'), ext !== '.css'))
        fail('path.absolute', `${rel}: ${h}（相対パス ./ にする）`);
    }
    if (exp.production) {
      if (ext === '.map') fail('sourcemap', `本番ビルドにソースマップ: ${rel}`);
      else if ((ext === '.js' || ext === '.css') && buf.includes('sourceMappingURL='))
        fail('sourcemap', `本番ビルドに sourceMappingURL: ${rel}`);
    }
  }

  if (!files.includes('index.html')) fail('index.missing', 'index.html がルートにない');

  const hasHeaders = files.includes('_headers');
  const mix = (rule, label, list, expected) => {
    if (expected && !list.length) fail(rule, `${label} があるはずのビルドにない`);
    if (!expected && list.length) fail(rule, `${label} が混入: ${list.join(', ')}`);
  };
  mix('mix.crazygames', SDK.crazygames, found.cg, exp.cg);
  mix('mix.poki', SDK.poki, found.poki, exp.poki);
  mix('mix.hooks', `${HOOK}（テスト用フック）`, found.hooks, exp.hooks);
  if (exp.headers && !hasHeaders) fail('mix.headers', '_headers がない（web には必ず要る）');
  if (!exp.headers && hasHeaders) fail('mix.headers', '_headers が混入（web 以外に入れない）');
  if (exp.headers && hasHeaders) {
    if (!existsSync(headersSrc)) fail('headers.diff', `原本 ${headersSrc} がない`);
    else if (!readFileSync(join(dir, '_headers')).equals(readFileSync(headersSrc)))
      fail('headers.diff', `_headers が ${headersSrc} と違う（build:web のコピーを確認）`);
  }

  if (files.length > BUDGET.files) fail('files.count', `ファイル数 ${files.length} > ${BUDGET.files}`);
  if (initial > BUDGET.initialGzipFail) fail('size.initial', `初回ダウンロード（gzip 換算）${initial.toLocaleString('en-US')} B > ${BUDGET.initialGzipFail / MB}MB`);
  else if (initial > BUDGET.initialGzipWarn)
    warns.push(`[size.initial.warn] 初回ダウンロード（gzip 換算）${initial.toLocaleString('en-US')} B > 目標 ${BUDGET.initialGzipWarn / MB}MB`);
  if (raw > BUDGET.totalFail) fail('size.total', `合計 ${raw.toLocaleString('en-US')} B > ${BUDGET.totalFail / MB}MB`);
  if (raw > BUDGET.totalSelf) fail('size.self', `合計 ${raw.toLocaleString('en-US')} B > 自主予算 ${BUDGET.totalSelf / MB}MB`);

  results.push({ t, files: files.length, raw, initial, found, hasHeaders, fails, warns });
}

const yn = (v) => (v === undefined ? '-' : v ? 'あり' : 'なし');
console.log(`check:size — dist: ${distRoot}（1 MB = 10^6 B、kB = 10^3 B。初回＝_headers と .map を除く全ファイルの gzip 換算）`);
console.log('| target | files | total kB | initial gzip kB | crazygames SDK | poki SDK | __game | _headers | result |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const res = r.fails.length ? `FAIL（${r.fails.length}）` : r.warns.length ? 'OK（警告あり）' : 'OK';
  console.log(
    `| ${r.t} | ${r.files ?? '-'} | ${r.raw !== undefined ? fmtKB(r.raw) : '-'} | ${r.initial !== undefined ? fmtKB(r.initial) : '-'} | ${yn(r.found && r.found.cg.length > 0)} | ${yn(r.found && r.found.poki.length > 0)} | ${yn(r.found && r.found.hooks.length > 0)} | ${yn(r.hasHeaders)} | ${res} |`,
  );
}
let failed = false;
for (const r of results) {
  for (const w of r.warns) console.log(`WARN ${r.t}: ${w}`);
  for (const f of r.fails) {
    console.error(`FAIL ${r.t}: ${f}`);
    failed = true;
  }
}
const worst = results.filter((r) => r.initial !== undefined).sort((a, b) => b.initial - a.initial)[0];
if (worst) console.log(`最大の初回ダウンロード: ${worst.t} ${fmtMB(worst.initial)}（目標 1.5 MB・上限 5 MB）`);
console.log(failed ? 'check:size: FAIL' : 'check:size: OK');
process.exit(failed ? 1 : 0);
