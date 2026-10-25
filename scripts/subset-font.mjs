// 使用文字 → DotGothic16 のサブセット woff2（arch §13・§16 の `font`）
// 使い方: node scripts/subset-font.mjs [--extra <text-file> ...] [--out <path>]
//   既定の文字: ASCII 印字可能文字 ＋ src/i18n/*.json と src/ui/ のすべての文字
//   --extra: 追加で文字を集めるファイル（PoC-4 の上限見積もりでは gdd.md を使う）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import subsetFont from 'subset-font';
import { collectFontChars } from './font-chars.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'assets-src/fonts/DotGothic16-Regular.ttf');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(root, outIdx >= 0 ? args[outIdx + 1] : 'src/generated/fonts/dotgothic16-subset.woff2');
const extras = args.flatMap((a, i) => (a === '--extra' ? [args[i + 1]] : []));

// 文字の集め方は check:font（scripts/check-font.mjs）と共有する（BL-139）
const { chars, files } = collectFontChars(root, extras);
const text = [...chars].sort().join('');

const cjk = [...chars].filter((c) => c.codePointAt(0) >= 0x3000).length;
const ttf = readFileSync(src);
const woff2 = await subsetFont(ttf, text, { targetFormat: 'woff2' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, woff2);
console.log(
  `subset-font: chars ${chars.size} (CJK/kana ${cjk}) from ${files.length} files -> ${out}\n` +
    `  source ttf ${ttf.length} bytes -> woff2 ${woff2.length} bytes (gzip ${gzipSync(woff2).length})`,
);
