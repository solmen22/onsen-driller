// セーブの封筒と読み込みの検証（arch §11・Q-10。BL-026）
// 封筒: { schema, seq, savedAt, appVersion, checksum, game }。game はオブジェクト（文字列に包まない）。
// checksum ＝ canonicalJson(game)（キーを辞書順に並べた空白なしの JSON）の FNV-1a（小文字の 16 進 8 桁）。
// 読み込みの順番: 大きさ → 入れ子の深さ → JSON（危険なキーを捨てる）→ **新しい版** → 封筒の形 → checksum → game の検証・補正。
// 新しい版（schema > SAVE_SCHEMA_VERSION）は封筒の形・checksum より**先**に見分ける。将来の版が封筒のキーや checksum の計算を
// 変えても「壊れた枠」と誤って上書きしないため（レビュー M-1。arch §11 の約束: 封筒は JSON のオブジェクトで、先頭のキーは整数の schema）。
// 大きすぎる・深すぎる・JSON として読めない（途中で切れた）文字列も、先頭が "schema":N（N が今の版より大きい）なら newer にする。
// どの段階でも例外を呼び出し側に投げず、{ ok:false, reason } で返す
import LZString from 'lz-string';
import { checksumOf, MAX_JSON_DEPTH, toSaveGame, type GameState, type SaveGame } from '../core/index.ts';
import { decompressUriBounded } from './lz-bounded.ts';
import { parseGame, SAVE_SCHEMA_VERSION } from './schema.ts';

export interface SaveEnvelope {
  schema: number;
  /** 通し番号（0 以上の安全な整数）。2 枠保存で新しいほうを選ぶ（BL-027） */
  seq: number;
  /** 保存した壁時計（UTC の ms）。オフラインの経過は S3 でこれを使う */
  savedAt: number;
  appVersion: string;
  checksum: string;
  game: SaveGame;
}

/** 読み込みを拒否する理由（Q-10） */
/** migrateFailed: 古い版のセーブの移行のコードが失敗した（データの破損ではない）。slots は newer と同じく読み取り専用にする（BL-028） */
export type DecodeFail = 'notJson' | 'tooLarge' | 'shape' | 'newer' | 'checksum' | 'invalidGame' | 'migrateFailed';

export type DecodeResult =
  | { ok: true; state: GameState; env: SaveEnvelope; corrected: string[] }
  | { ok: false; reason: DecodeFail };

/** 保存データの文字数の上限（これを超えたら読まない） */
export const MAX_SAVE_CHARS = 1_000_000;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 封筒を作る（checksum は game の正規化 JSON から） */
export function makeEnvelope(s: GameState, seq: number, savedAt: number, appVersion: string): SaveEnvelope {
  const game = toSaveGame(s);
  return { schema: SAVE_SCHEMA_VERSION, seq, savedAt, appVersion, checksum: checksumOf(game), game };
}

/** 保存する文字列（封筒の JSON） */
export const encodeSave = (s: GameState, seq: number, savedAt: number, appVersion: string): string =>
  JSON.stringify(makeEnvelope(s, seq, savedAt, appVersion));

/**
 * 文字列の外側の [ { の入れ子の深さ（JSON.parse の前に、深すぎる入力を安く弾く）。
 * 文字列の中の括弧とエスケープは数えない
 */
export function jsonNestingDepth(raw: string, limit = Number.POSITIVE_INFINITY): number {
  let depth = 0;
  let max = 0;
  let inStr = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (inStr) {
      if (c === 0x5c) i++; // \ の次の 1 文字を飛ばす
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x5b || c === 0x7b) {
      depth++;
      if (depth > max) {
        max = depth;
        if (max > limit) return max;
      }
    } else if (c === 0x5d || c === 0x7d) depth--;
  }
  return max;
}

/** JSON を読む（`__proto__`・`constructor`・`prototype` のキーはどの深さでも捨てる）。読めなければ undefined */
export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw, (k, val: unknown) => (DANGEROUS_KEYS.has(k) ? undefined : val)) as unknown;
  } catch {
    return undefined;
  }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const ENVELOPE_KEYS = ['schema', 'seq', 'savedAt', 'appVersion', 'checksum', 'game'] as const;

/** schema: 1 以上の整数（数値の文字列 "1" も読む）。読めなければ null */
function schemaOf(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*\d+\s*$/.test(x) ? Number(x) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** 新しい版か（schema が読めて、今の版より大きい） */
const isNewer = (schema: unknown): boolean => {
  const n = schemaOf(schema);
  return n !== null && n > SAVE_SCHEMA_VERSION;
};

/** 生の文字列の先頭の "schema":N（封筒の先頭のキー。JSON として読めない・大きすぎる枠を見分けるだけに使う） */
const RAW_SCHEMA = /^\s*\{\s*"schema"\s*:\s*"?(\d{1,9})"?\s*(?:[,}]|$)/;
const rawIsNewer = (raw: string): boolean => isNewer(RAW_SCHEMA.exec(raw.slice(0, 64))?.[1]);

/** 封筒の JSON（信頼しない文字列）を読む。例外を投げない */
export function decodeSave(raw: unknown): DecodeResult {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'notJson' };
  if (raw.length > MAX_SAVE_CHARS) return { ok: false, reason: rawIsNewer(raw) ? 'newer' : 'tooLarge' };
  if (jsonNestingDepth(raw, MAX_JSON_DEPTH + 1) > MAX_JSON_DEPTH) return { ok: false, reason: rawIsNewer(raw) ? 'newer' : 'shape' };
  const parsed = safeJsonParse(raw);
  if (parsed === undefined) return { ok: false, reason: rawIsNewer(raw) ? 'newer' : 'notJson' };
  return decodeEnvelope(parsed);
}

/** 読んだ JSON の値から封筒を検証する（新しい版 → 形 → checksum → game） */
export function decodeEnvelope(parsed: unknown): DecodeResult {
  if (!isRecord(parsed)) return { ok: false, reason: 'shape' };
  // 新しい版は、ほかの検査をせずに newer（形・checksum が今の版と違っても上書きしない。M-1）
  if (isNewer(parsed.schema)) return { ok: false, reason: 'newer' };
  if (ENVELOPE_KEYS.some((k) => !(k in parsed))) return { ok: false, reason: 'shape' };
  const schema = schemaOf(parsed.schema);
  const seq = parsed.seq;
  if (schema === null || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return { ok: false, reason: 'shape' };
  if (typeof parsed.checksum !== 'string') return { ok: false, reason: 'shape' };
  let sum: string;
  try {
    sum = checksumOf(parsed.game);
  } catch {
    return { ok: false, reason: 'shape' }; // JSON にできない値・深すぎる入れ子
  }
  if (sum !== parsed.checksum.toLowerCase()) return { ok: false, reason: 'checksum' };
  const g = parseGame(parsed.game);
  if (!g.ok) return { ok: false, reason: g.reason };
  const savedAt = typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) && parsed.savedAt >= 0 ? parsed.savedAt : 0;
  const appVersion = typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown';
  const corrected = [...g.corrected];
  if (savedAt !== parsed.savedAt) corrected.push('savedAt');
  if (appVersion !== parsed.appVersion) corrected.push('appVersion');
  if (schema !== parsed.schema) corrected.push('schema');
  return { ok: true, state: g.state, env: { schema, seq, savedAt, appVersion, checksum: sum, game: toSaveGame(g.state) }, corrected };
}

/**
 * テスト用フックの setState（Q-16）: セーブの読み込みと同じ検証（危険なキーの除去 → 形 → 補正）を通す。
 * 拒否に当たるもの（オブジェクトでない・run や meta がない）は例外を投げる（テストの書き間違いに気づけるように）
 */
export function parseGameForHook(input: unknown): GameState {
  let clean: unknown;
  try {
    // 危険なキーを捨てるため、JSON を 1 度通す（Decimal のクラスなどは文字列になる）
    clean = safeJsonParse(JSON.stringify(input) ?? 'undefined');
  } catch {
    clean = undefined;
  }
  const g = parseGame(clean);
  if (!g.ok) throw new TypeError('setState: game must be an object with run and meta');
  return g.state;
}

// ---- 書き出し・読み込み（S3 の BL-029 で画面に出す。形式は arch §11・Q-24） ----
// 書き出し文字列: `ODR1:` ＋ lz-string の compressToEncodedURIComponent(JSON.stringify(game)) ＋ `.` ＋ checksum（小文字の 16 進 8 桁）
// 読み込みはユーザーの入力なので、どんな入力でも例外を投げず { ok:false, reason } で拒否する（レビュー S-6）。
// 検査の順番: 型・長さ → 接頭辞（ODR2: 以上は newer）→ 形 → 展開（上限つき）→ 入れ子 → JSON → 新しい版（checksum より先）→ checksum → game

/** 書き出し文字列の形式の版（接頭辞 ODR<版>:） */
const EXPORT_FORMAT_VERSION = 1;
const EXPORT_PREFIX = `ODR${EXPORT_FORMAT_VERSION}:`;
/** 読み込む書き出し文字列の長さの上限（前後の空白を除いた長さ。ちょうどは通る。Q-24） */
export const MAX_IMPORT_CHARS = 300_000;

/** 書き出し文字列を拒否する理由（Q-24）。format は書き出し文字列の形でないもの */
export type ImportFail = 'format' | 'tooLarge' | 'notJson' | 'shape' | 'newer' | 'checksum' | 'invalidGame' | 'migrateFailed';
export type ImportResult = { ok: true; state: GameState; corrected: string[] } | { ok: false; reason: ImportFail };

export function exportString(s: GameState): string {
  const env = makeEnvelope(s, 0, 0, '');
  return `${EXPORT_PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify(env.game))}.${env.checksum}`;
}

const importFail = (reason: ImportFail): ImportResult => ({ ok: false, reason });
const EXPORT_HEAD = /^ODR(\d{1,9}):/;
const EXPORT_BODY = /^ODR1:([A-Za-z0-9+\-$]+)\.([0-9a-f]{8})$/;

/**
 * 書き出し文字列を読む（純粋な関数。ストレージに触らない）。失敗しても今のセーブを上書きする材料にしない。
 * 例外を投げない（型の違う引数・想定外の例外も { ok:false, reason } にする）
 */
export function importString(input: unknown): ImportResult {
  try {
    return importUnchecked(input);
  } catch {
    return importFail('notJson');
  }
}

function importUnchecked(input: unknown): ImportResult {
  if (typeof input !== 'string') return importFail('format');
  if (input.length > MAX_IMPORT_CHARS * 2) return importFail('tooLarge'); // 前後の空白を除く前に、極端に長いものを弾く
  const str = input.trim();
  if (str.length > MAX_IMPORT_CHARS) return importFail('tooLarge');
  const head = EXPORT_HEAD.exec(str);
  if (!head?.[1]) return importFail('format');
  if (Number(head[1]) > EXPORT_FORMAT_VERSION) return importFail('newer'); // 新しい版の書き出しの形式（ODR2: など）
  const m = EXPORT_BODY.exec(str);
  if (!m?.[1] || !m[2]) return importFail('format');
  // 展開しながら長さを数え、セーブの上限（100 万文字）を超えたら止める（膨らむ入力で固まらない）
  const d = decompressUriBounded(m[1], MAX_SAVE_CHARS);
  if (!d.ok) return importFail(d.reason === 'tooLarge' ? 'tooLarge' : 'notJson');
  const json = d.text;
  if (json.length === 0) return importFail('notJson');
  if (jsonNestingDepth(json, MAX_JSON_DEPTH + 1) > MAX_JSON_DEPTH) return importFail('shape');
  const game = safeJsonParse(json);
  if (game === undefined) return importFail('notJson');
  // 新しい版は checksum より先に見る（知らない ID を捨てた状態で読んで、今のセーブを上書きする材料にしない。Q-24）
  if (isRecord(game) && isNewer(game.schema)) return importFail('newer');
  let sum: string;
  try {
    sum = checksumOf(game);
  } catch {
    return importFail('shape');
  }
  if (sum !== m[2]) return importFail('checksum');
  const g = parseGame(game);
  if (!g.ok) return importFail(g.reason); // migrateFailed は今のセーブを上書きしない（ほかの失敗と同じ）
  return { ok: true, state: g.state, corrected: g.corrected };
}
