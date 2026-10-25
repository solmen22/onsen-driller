// フォントのサブセットに入れる文字の集め方（scripts/subset-font.mjs と scripts/check-font.mjs が共有する。BL-139）
//   ASCII の印字可能文字 ＋ src/i18n/ と src/ui/ の下のすべてのファイルの全文字（U+0020 以上。コメントの文字も含む）
// 依存は node: の組み込みだけ（原本の TTF・subset-font を要らない検査からも読むため）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 文字を集めるディレクトリ（root からの相対） */
export const FONT_CHAR_DIRS = ['src/i18n', 'src/ui'];

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/**
 * サブセットに入れる文字を集める。
 * @param {string} root リポジトリの根
 * @param {string[]} [extras] 追加で文字を集めるファイル（subset-font.mjs の --extra）
 * @returns {{ chars: Set<string>, files: string[] }}
 */
export function collectFontChars(root, extras = []) {
  const chars = new Set();
  for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  const files = [...FONT_CHAR_DIRS.flatMap((d) => walk(resolve(root, d))), ...extras.map((e) => resolve(e))];
  for (const f of files) for (const ch of readFileSync(f, 'utf8')) if (ch.codePointAt(0) >= 0x20) chars.add(ch);
  return { chars, files };
}
