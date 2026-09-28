// ビルド検査 check:assets（BL-008。QA test-strategy §4-5・§7-F、gdd §14-3）
// ビルドに含まれる画像・音声・フォントが、素材台帳 ASSETS.md にすべて載っているかを突き合わせる。
//
// 使い方:
//   node scripts/check-assets.mjs [--dist <dir>] [--ledger <file>] [target ...]
//   - --dist    ビルドの親ディレクトリ（既定 ./dist。環境変数 CHECK_DIST でも可）
//   - --ledger  台帳（既定 ./ASSETS.md）
//   - target    検査するターゲット名（省略時は --dist の下のディレクトリすべて）
//
// 台帳の書き方（Q-15 の回答。traceability.md §5）:
//   - 見出しの 1 列目が「素材名」の表を台帳として読む。列は 素材名・区分・入手元・ライセンス・改変の有無・
//     ツール／モデル／プラン・生成日・プロンプトの要旨・人の修正の有無（BL-008。足りない列があれば失敗）
//   - ビルドに出るファイル名（例 atlas.png、dotgothic16-subset.woff2）を、見出しに「ファイル名」を含む列に書く
//     （技術リードの Q-15 回答の形。バッククォートはあってもなくてもよい）か、「素材名」の列にバッククォートで書く。
//     照合キーはファイル名だけ（ディレクトリは見ない。`src/generated/atlas.png` と書いても atlas.png として扱う）。
//     ビルド側は Vite のハッシュ「-xxxxxxxx」を外して比べる。大文字小文字は区別する
//   - 1 つのファイル（アトラスなど）に複数の素材が入る場合は、各行に同じファイル名を書いてよい
// 失敗: 台帳にない素材がビルドにある / 台帳の表がない / 必要な列がない
// 警告（終了コード 0）: 区分が 6 種（AI 生成・コードで描画・CC0・自作と、CEO 承認で追加したフォント（OFL）・コードで生成（効果音など））以外
//   / 台帳にあってビルドにない
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSET_EXT, assetKey, extOf, walk } from './check-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const { values, positionals } = parseArgs({
  options: { dist: { type: 'string' }, ledger: { type: 'string' } },
  allowPositionals: true,
});
const distRoot = resolve(values.dist ?? process.env.CHECK_DIST ?? join(root, 'dist'));
const ledgerPath = resolve(values.ledger ?? join(root, 'ASSETS.md'));

/** 必要な列（見出しにこの語が含まれていればよい） */
const REQUIRED_COLUMNS = ['素材名', '区分', '入手元', 'ライセンス', '改変', 'ツール', '生成日', 'プロンプト', '人の修正'];
/** 区分（空白を除いて比べる）。フォント（OFL）・コードで生成（効果音など）は 2026-09-28 に CEO 承認で追加 */
const CATEGORIES = ['AI生成', 'コードで描画', 'CC0', '自作', 'フォント（OFL）', 'コードで生成（効果音など）'];

const fails = [];
const warns = [];

// ---- 台帳を読む ----
const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line.trim());

const ledgerKeys = new Map(); // key -> 行番号の配列
let header = null;
if (!existsSync(ledgerPath)) fails.push(`[ledger.missing] 台帳 ${ledgerPath} がない`);
else {
  const lines = readFileSync(ledgerPath, 'utf8').split(/\r?\n/);
  let inLedger = false;
  let catCol = -1;
  let fileCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) {
      inLedger = false;
      continue;
    }
    if (!inLedger) {
      const cells = splitRow(line);
      if (cells[0]?.includes('素材') && isSeparator(lines[i + 1] ?? '')) {
        inLedger = true;
        header ??= cells;
        catCol = cells.findIndex((c) => c.includes('区分'));
        fileCol = cells.findIndex((c) => c.includes('ファイル名'));
        i++; // 区切り行を飛ばす
      }
      continue;
    }
    const cells = splitRow(line);
    const names = [...(cells[0] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (fileCol > 0) names.push(...(cells[fileCol] ?? '').replaceAll('`', ' ').split(/[\s,、・;；]+/));
    for (const n of names) {
      const base = posix.basename(n.trim().replaceAll('\\', '/'));
      if (ASSET_EXT.has(extOf(base))) ledgerKeys.set(base, [...(ledgerKeys.get(base) ?? []), i + 1]);
    }
    if (catCol >= 0) {
      const cat = (cells[catCol] ?? '').replace(/\s+/g, '');
      if (!CATEGORIES.includes(cat))
        warns.push(`[ledger.category] ${basename(ledgerPath)}:${i + 1} 区分「${cells[catCol] ?? ''}」が 6 種（AI 生成／コードで描画／CC0／自作／フォント（OFL）／コードで生成（効果音など））以外`);
    }
  }
  if (!header) fails.push(`[ledger.table] ${ledgerPath} に、見出しの 1 列目が「素材名」の表がない`);
  else {
    const missing = REQUIRED_COLUMNS.filter((c) => !header.some((h) => h.includes(c)));
    if (missing.length) fails.push(`[ledger.columns] 台帳の表に必要な列がない: ${missing.join('・')}（いまの見出し: ${header.join('｜')}）`);
  }
}

// ---- ビルドを読む ----
const targets = positionals.length
  ? positionals
  : existsSync(distRoot)
    ? readdirSync(distRoot).filter((d) => statSync(join(distRoot, d)).isDirectory()).sort()
    : [];
if (!targets.length) fails.push(`[dist.missing] ${distRoot} にビルドがない（先に npm run build:all）`);

const rows = [];
const usedKeys = new Set();
for (const t of targets) {
  const dir = join(distRoot, t);
  if (!existsSync(dir)) {
    fails.push(`[dist.missing] ${dir} がない`);
    continue;
  }
  for (const rel of walk(dir)) {
    if (!ASSET_EXT.has(extOf(rel))) continue;
    const key = assetKey(rel);
    usedKeys.add(key);
    let result = 'OK';
    if (!ledgerKeys.has(key)) {
      const near = [...ledgerKeys.keys()].find((k) => k.toLowerCase() === key.toLowerCase());
      result = 'NG';
      fails.push(
        `[asset.unlisted] ${t}/${rel}（キー ${key}）が台帳にない${near ? `。台帳の \`${near}\` とは大文字小文字が違う（区別する）` : ''}`,
      );
    }
    rows.push({ t, rel, key, result });
  }
}

console.log(`check:assets — 台帳: ${ledgerPath}（素材ファイル名 ${ledgerKeys.size} 件）/ dist: ${distRoot}`);
console.log(`対象の拡張子: ${[...ASSET_EXT].join(' ')}`);
console.log('| target | ビルドのファイル | 照合キー | 台帳 |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.t} | ${r.rel} | ${r.key} | ${r.result} |`);
if (!rows.length) console.log('| - | （素材ファイルなし） | - | - |');
for (const k of ledgerKeys.keys()) if (!usedKeys.has(k)) console.log(`参考: 台帳の \`${k}\` は検査したビルドに含まれていない`);
for (const w of warns) console.log(`WARN ${w}`);
for (const f of fails) console.error(`FAIL ${f}`);
console.log(fails.length ? 'check:assets: FAIL' : 'check:assets: OK');
process.exit(fails.length ? 1 : 0);
