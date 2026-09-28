// stateHash の検算用の、本体と独立した実装（TS-071-05。traceability.md §5-2 の Q-10 の 1 の規則をそのまま書いたもの）
// - 正規化: オブジェクトのキーを辞書順に並べ替え（入れ子も）、配列は順番どおり、空白なしの JSON（undefined のキーは書かない）
// - checksum: その文字列の FNV-1a（32 ビット。UTF-16 の符号単位ごと）を小文字の 16 進 8 桁にしたもの（"" → 811c9dc5、"a" → e40c292c）
// 本体（src/core/serialize.ts）を import しないのは、同じ式でなぞって誤りを見逃さないため

export function canonicalJsonOracle(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`JSON にできない数: ${v}`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJsonOracle(x))).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonOracle(o[k])}`).join(',')}}`;
  }
  throw new Error(`JSON にできない値: ${typeof v}`);
}

export function fnv1aOracle(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const stateHashOracle = (game: unknown): string => fnv1aOracle(canonicalJsonOracle(game));
