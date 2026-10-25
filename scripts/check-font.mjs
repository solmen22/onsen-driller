// ビルド検査 check:font（BL-139。PR #62 のレビューの S-1 の再発防止）。npm run check:assets の中で check-assets.mjs の後に動く
// フォントのサブセット（src/generated/fonts/dotgothic16-subset.woff2）に、src/i18n・src/ui の全文字が入っているかを確かめる。
//   - 文字の集め方は scripts/subset-font.mjs と同じ（scripts/font-chars.mjs を共有する）
//   - 生成物の woff2 だけで判定する（wawoff2 で TTF に戻し、cmap を読む）。原本の TTF（gitignore）は要らない
//     → 原本のない作業場所で `npm run font` が止まり、文字を足したのにサブセットを作り直さなかったとき、ここで赤になる
//   - 原本の DotGothic16 にない字（NOT_IN_SOURCE_FONT）は、作り直しても入らないので数えない（端末のフォントで出る）
//
// 使い方: node scripts/check-font.mjs [--root <dir>] [--font <woff2>]
//   - --root  文字を集めるリポジトリの根（既定はこのリポジトリ。自己テスト用）
//   - --font  サブセットの woff2（既定 <root>/src/generated/fonts/dotgothic16-subset.woff2）
// 失敗: 欠けた字がある（字・コードポイント・その字があるファイルを出す） / woff2 がない・読めない・cmap がない
// 警告（終了コード 0）: NOT_IN_SOURCE_FONT の字が、もう集めた文字にない（一覧から消してよい）
// 自己テスト: npm run test:checks（scripts/check-selftest.mjs）
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import wawoff2 from 'wawoff2';
import { collectFontChars } from './font-chars.mjs';

export const FONT_FILE = 'src/generated/fonts/dotgothic16-subset.woff2';

/**
 * 原本の DotGothic16（assets-src/fonts/DotGothic16-Regular.ttf）にない字。サブセットに入らないので数えない。
 * 足すときは、原本の cmap にないことを確かめてから（PR #68 のレビューの「フォント」で確かめた 6 字）。
 */
export const NOT_IN_SOURCE_FONT = new Map([
  ['⛏', 'タブのアイコン（App.tsx）。端末のフォントで出る'],
  ['♨', 'タブのアイコン（App.tsx）。端末のフォントで出る'],
  ['⚙', '設定のアイコン（Hud.tsx）。端末のフォントで出る'],
  ['✿', 'タブのアイコン（App.tsx）。端末のフォントで出る'],
  ['≥', 'コメントの字'],
  ['秭', 'number-format.ts の単位（コメント・表）'],
]);

const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/**
 * TrueType／OpenType のバイト列から cmap の文字（グリフ 0 以外に割り当てられたコードポイント）を読む。
 * 形式 4（BMP）と形式 12（全面）の副表を読み、和集合を返す。
 * @param {Uint8Array} font
 * @returns {Set<number>}
 */
export function readCmap(font) {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const numTables = v.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) if (tag(font, 12 + i * 16) === 'cmap') cmap = v.getUint32(12 + i * 16 + 8);
  if (cmap < 0) throw new Error('cmap の表がない');
  const cps = new Set();
  const seen = new Set();
  const n = v.getUint16(cmap + 2);
  for (let i = 0; i < n; i++) {
    const sub = cmap + v.getUint32(cmap + 4 + i * 8 + 4);
    if (seen.has(sub)) continue;
    seen.add(sub);
    const format = v.getUint16(sub);
    if (format === 4) {
      const segX2 = v.getUint16(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2; s += 2) {
        const end = v.getUint16(ends + s);
        const start = v.getUint16(starts + s);
        const delta = v.getUint16(deltas + s);
        const ro = v.getUint16(ranges + s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g;
          if (ro === 0) g = (c + delta) & 0xffff;
          else {
            g = v.getUint16(ranges + s + ro + (c - start) * 2);
            if (g !== 0) g = (g + delta) & 0xffff;
          }
          if (g !== 0) cps.add(c);
        }
      }
    } else if (format === 12) {
      const groups = v.getUint32(sub + 12);
      for (let k = 0; k < groups; k++) {
        const o = sub + 16 + k * 12;
        const start = v.getUint32(o);
        const end = v.getUint32(o + 4);
        const g0 = v.getUint32(o + 8);
        for (let c = start; c <= end; c++) if (g0 + (c - start) !== 0) cps.add(c);
      }
    }
  }
  return cps;
}

/** woff2 を TTF に戻して cmap を読む */
export async function woff2Cmap(buf) {
  return readCmap(await wawoff2.decompress(buf));
}

const cpLabel = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { root: { type: 'string' }, font: { type: 'string' } } });
  const root = resolve(values.root ?? join(import.meta.dirname, '..'));
  const fontPath = resolve(values.font ?? join(root, FONT_FILE));
  const fails = [];
  const warns = [];
  const { chars, files } = collectFontChars(root);
  let cmap = null;
  if (!existsSync(fontPath)) fails.push(`[font.missing] ${fontPath} がない（npm run font）`);
  else {
    try {
      cmap = await woff2Cmap(readFileSync(fontPath));
    } catch (e) {
      fails.push(`[font.unreadable] ${fontPath} を woff2 として読めない（${e.message}）`);
    }
  }
  if (cmap) {
    const missing = [...chars].filter((ch) => !cmap.has(ch.codePointAt(0)) && !NOT_IN_SOURCE_FONT.has(ch)).sort();
    for (const ch of missing) {
      const where = files.filter((f) => readFileSync(f, 'utf8').includes(ch)).map((f) => relative(root, f).replaceAll('\\', '/'));
      fails.push(`[font.glyph] 「${ch}」（${cpLabel(ch)}）がサブセットにない: ${where.join('・')}`);
    }
    if (missing.length)
      fails.push(`[font.glyph] 欠けた字 ${missing.length} 字: ${missing.join('')} → 原本の TTF を置いて npm run font で作り直す（ASSETS.md の行も更新する）`);
  }
  for (const ch of NOT_IN_SOURCE_FONT.keys())
    if (!chars.has(ch)) warns.push(`[font.allowlist] 「${ch}」（${cpLabel(ch)}）はもう使われていない。NOT_IN_SOURCE_FONT から消してよい`);

  console.log(
    `check:font — ${relative(root, fontPath).replaceAll('\\', '/')}（cmap ${cmap ? cmap.size : '-'} 字）/ 集めた文字 ${chars.size} 字（${files.length} ファイル。原本にない字 ${NOT_IN_SOURCE_FONT.size} 字は数えない）`,
  );
  for (const w of warns) console.log(`WARN ${w}`);
  for (const f of fails) console.error(`FAIL ${f}`);
  console.log(fails.length ? 'check:font: FAIL' : 'check:font: OK');
  return fails.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
