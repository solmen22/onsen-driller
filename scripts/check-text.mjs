// 文言の自動検査 check:text（BL-077。QA §7-G。語のリストの正本は org/30_quality/qa-lead/2026-09-29_check-text-words.md）
// 使い方: npm run check:text（検出 0 件なら 0、1 件以上なら 1 で終わる。設定の誤り〔許可リストの形など〕は 2）
// - 対象: src/i18n/*.json の値だけ（キーは見ない）・src/content/**・assets-src/**・index.html・ASSETS.md・docs/store/**（ファイル全体）、
//   git ls-files の全ファイルの名前（区分 P・W・N の英字の規則だけ）
// - 照合: sub は NFKC・小文字・空白を除いて部分一致、word はキャメルケースの区切り・ダイアクリティカルマークの除去・語の境界つき
//   （語の中の空白は [\s\-_.]*、末尾の s・es も当てる）。規則ごとの例外（except）は、正規化した行で範囲をすべて求めてから伏せる
// - 許可リスト（scripts/text-allowlist.json）: ファイル＋場所（JSON はキー、ほかは行の抜粋）＋規則 ID＋語で 1 件ずつ外す。
//   reason・approvedBy・date が必須。docs/store/・index.html では H・P・C の許可を受け付けない（QA の文書 §3 の原則 4・5）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 書式の文字（ゼロ幅スペース・ソフトハイフンなど Unicode の Cf）は先に消す（語の途中に入れて検出をすり抜けさせない。PR #51 のレビューの S-1）
const dropFormat = (s) => s.replace(/\p{Cf}/gu, '');
export const normSub = (s) => dropFormat(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export const normWord = (s) =>
  dropFormat(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .toLowerCase();
const wordRe = (w) => new RegExp(`(?<![a-z0-9])${normWord(w).trim().split(/\s+/).map(esc).join('[\\s\\-_.]*')}(?:s|es)?(?![a-z0-9])`, 'g');

/** 規則を照合用に前処理する（正規表現は 1 回だけ作る） */
export function compileRules(rules) {
  return rules.map((r) => {
    if (r.type === 'sub') {
      return { ...r, find: r.words.map((w) => ({ word: w, n: normSub(w) })), ex: (r.except ?? []).map((e) => normSub(e)) };
    }
    return { ...r, find: r.words.map((w) => ({ word: w, re: wordRe(w) })), exRe: (r.except ?? []).map((e) => wordRe(e)) };
  });
}

/** 範囲 [a, b) を '\u0000' で伏せる */
const mask = (s, ranges) => {
  if (ranges.length === 0) return s;
  // 範囲は indexOf・matchAll の位置（UTF-16 の単位）なので、配列も UTF-16 の単位で作る
  // （コードポイントの配列にすると、絵文字などのサロゲートペアの後ろで位置がずれる。PR #51 のレビューの M-1）
  const chars = s.split('');
  for (const [a, b] of ranges) for (let i = a; i < b; i++) chars[i] = '\u0000';
  return chars.join('');
};

/** 文字列（1 行）を照合する。fileName: true なら区分 P・W・N の英字の規則だけ。返り値は [{ rule, word }] */
export function checkText(text, compiled, opts = {}) {
  const hits = [];
  const sub = normSub(text);
  const word = normWord(text);
  for (const r of compiled) {
    if (opts.fileName && !(r.type === 'word' && /^[PWN]/.test(r.id))) continue;
    if (r.type === 'sub') {
      // 例外の範囲は元の正規化済みの行ですべて求めてから伏せる（例外どうしの重なりを壊さない）
      const ranges = [];
      for (const e of r.ex) {
        if (e === '') continue;
        for (let i = sub.indexOf(e); i >= 0; i = sub.indexOf(e, i + 1)) ranges.push([i, i + e.length]);
      }
      const line = mask(sub, ranges);
      for (const f of r.find) if (f.n !== '' && line.includes(f.n)) hits.push({ rule: r.id, word: f.word });
    } else {
      const ranges = [];
      for (const re of r.exRe) for (const m of word.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
      const line = mask(word, ranges);
      for (const f of r.find) {
        f.re.lastIndex = 0;
        if (f.re.test(line)) hits.push({ rule: r.id, word: f.word });
      }
    }
  }
  return hits;
}

const STRICT = /^[HPC]/; // 説明文・index.html では許可しない区分（原則 5）
const isStrictFile = (file) => file === 'index.html' || file.startsWith('docs/store/');

/** 許可リストの形を確かめる（誤りの一覧を返す） */
export function allowlistProblems(list) {
  const p = [];
  if (!Array.isArray(list)) return ['許可リストは配列にする'];
  list.forEach((a, i) => {
    const at = `許可リストの ${i + 1} 件目`;
    if (!a || typeof a !== 'object') return void p.push(`${at}: オブジェクトでない`);
    for (const k of ['file', 'rule', 'word', 'reason', 'approvedBy', 'date']) if (typeof a[k] !== 'string' || a[k].trim() === '') p.push(`${at}: ${k} がない`);
    const where = (typeof a.key === 'string' && a.key !== '') + (typeof a.line === 'string' && a.line.trim() !== '');
    if (where !== 1) p.push(`${at}: key（JSON）か line（行の抜粋）のどちらか 1 つが要る（ファイル全体の除外は作れない）`);
    if (typeof a.file === 'string' && isStrictFile(a.file) && typeof a.rule === 'string' && STRICT.test(a.rule)) p.push(`${at}: ${a.file} では ${a.rule} の許可を出せない（原則 5）`);
  });
  return p;
}

/** 検出 1 件が許可リストで外れるか */
export function isAllowed(list, hit) {
  return list.some(
    (a) =>
      a.file === hit.file &&
      a.rule === hit.rule &&
      a.word === hit.word &&
      (hit.key !== undefined ? a.key === hit.key : typeof a.line === 'string' && a.line.trim() !== '' && hit.text.includes(a.line.trim())),
  );
}

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|txt|csv|ya?ml|html|svg|css)$/i;
const SKIP = [/^scripts\/text-words\.json$/, /^scripts\/text-allowlist\.json$/, /^tests\//, /^e2e\//, /^LICENSES\//, /^node_modules\//, /^dist\//, /^release\//];

/** 中身を検査するファイルか */
export function isTarget(file) {
  if (SKIP.some((re) => re.test(file))) return false;
  if (/^src\/i18n\/[^/]+\.json$/.test(file)) return true;
  if (file === 'index.html' || file === 'ASSETS.md') return true;
  if (/^(src\/content|assets-src|docs\/store)\//.test(file)) return TEXT_EXT.test(file);
  return false;
}

/** 1 ファイルの検出（i18n の JSON は値だけ。ほかは行ごと） */
export function checkFile(file, body, compiled) {
  const out = [];
  if (/^src\/i18n\/[^/]+\.json$/.test(file)) {
    const obj = JSON.parse(body);
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'string') continue;
      for (const h of checkText(value, compiled)) out.push({ file, key, text: value, ...h });
    }
    return out;
  }
  body.split(/\r?\n/).forEach((line, i) => {
    for (const h of checkText(line, compiled)) out.push({ file, line: i + 1, text: line, ...h });
  });
  return out;
}

function main() {
  const words = JSON.parse(readFileSync(resolve(root, 'scripts/text-words.json'), 'utf8'));
  const compiled = compileRules(words.rules);
  const allowPath = resolve(root, 'scripts/text-allowlist.json');
  const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : [];
  const bad = allowlistProblems(allow);
  if (bad.length > 0) {
    for (const b of bad) console.error(`check:text: ${b}`);
    process.exit(2);
  }
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const file of files) {
    for (const h of checkText(file, compiled, { fileName: true })) hits.push({ file, name: true, text: file, ...h });
    if (!isTarget(file) || !existsSync(resolve(root, file))) continue;
    hits.push(...checkFile(file, readFileSync(resolve(root, file), 'utf8'), compiled));
  }
  const shown = hits.filter((h) => !isAllowed(allow, h));
  for (const h of shown) {
    const where = h.name ? `${h.file}（ファイル名）` : h.key !== undefined ? `${h.file}:${h.key}` : `${h.file}:${h.line}`;
    console.log(`${where}: [${h.rule} ${h.word}] ${h.text.trim().slice(0, 80)}`);
  }
  const allowed = hits.length - shown.length;
  if (shown.length > 0) {
    console.log(`check:text: ${shown.length} 件（許可リストで外した ${allowed} 件）。誤検出なら scripts/text-allowlist.json に理由を書いて足す（QA の承認が要る）`);
    process.exit(1);
  }
  console.log(`check:text: OK（${files.length} ファイルの名前と、対象のファイルの中身。語のリスト v${words.version}・${words.updated}。許可リストで外した ${allowed} 件）`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
