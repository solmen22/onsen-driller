// ファイル名の規則（arch §4。Q-14）: 英小文字・数字・ハイフン。拡張子と区切りのドット（.test.ts・.module.css・.d.ts）は可。
// 例外は .tsx のコンポーネント（PascalCase）だけ。検査の範囲は SCOPE のディレクトリの下。
export const SCOPE = ['src/', 'tests/', 'tools/', 'scripts/', 'assets-src/', 'e2e/', 'deploy/', 'docs/'] as const;

/** 決まった名前で置く必要があるもの */
const EXACT_ALLOWED = new Set(['deploy/web/_headers', '.gitkeep']);

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

export const inScope = (path: string): boolean => SCOPE.some((d) => path.startsWith(d));

/** 規則に合わなければ理由を返す（合えば null）。path は / 区切りのリポジトリからの相対パス */
export function fileNameViolation(path: string): string | null {
  if (EXACT_ALLOWED.has(path)) return null;
  const parts = path.split('/');
  const file = parts.pop() ?? '';
  for (const dir of parts) if (!KEBAB.test(dir)) return `ディレクトリ名が規則に合わない: ${dir}`;
  if (file === '.gitkeep') return null;
  if (!/^[\x21-\x7e]+$/.test(file)) return `ASCII 以外・空白を含む: ${file}`;
  const pieces = file.split('.');
  if (pieces.length < 2) return `拡張子がない: ${file}`;
  const ext = pieces[pieces.length - 1] ?? '';
  if (!KEBAB.test(ext)) return `拡張子が規則に合わない: ${file}`;
  const [base = '', ...middle] = pieces.slice(0, -1);
  for (const m of middle) if (!KEBAB.test(m)) return `ドットの間が規則に合わない: ${file}`;
  if (ext === 'tsx' && middle.length === 0 && PASCAL.test(base)) return null;
  if (!KEBAB.test(base)) return `英小文字・数字・ハイフン以外を含む: ${file}`;
  return null;
}
