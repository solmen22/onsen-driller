// セーブの封筒と書き出し文字列（arch §11 の PoC 版。2 枠保存・移行は E5 で実装する）
import LZString from 'lz-string';
import * as v from 'valibot';
import { deserializeState, fnv1a, SAVE_SCHEMA_VERSION, serializeState, type GameState } from '../core/index.ts';

const Envelope = v.object({
  schema: v.pipe(v.number(), v.integer(), v.minValue(1)),
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  savedAt: v.number(),
  appVersion: v.string(),
  checksum: v.pipe(v.string(), v.length(8)),
  game: v.string(),
});
export type SaveEnvelope = v.InferOutput<typeof Envelope>;

export function encodeSave(s: GameState, seq: number, savedAt: number, appVersion: string): string {
  const game = serializeState(s);
  const env: SaveEnvelope = { schema: SAVE_SCHEMA_VERSION, seq, savedAt, appVersion, checksum: fnv1a(game), game };
  return JSON.stringify(env);
}

/** 危険なキーを捨てて読む（__proto__ など） */
const safeParse = (raw: string): unknown =>
  JSON.parse(raw, (k, val: unknown) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : val));

export type DecodeResult = { ok: true; state: GameState; env: SaveEnvelope } | { ok: false; reason: 'corrupt' | 'checksum' | 'newer' };

export function decodeSave(raw: string): DecodeResult {
  let env: SaveEnvelope;
  try {
    const r = v.safeParse(Envelope, safeParse(raw));
    if (!r.success) return { ok: false, reason: 'corrupt' };
    env = r.output;
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (env.schema > SAVE_SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  if (fnv1a(env.game) !== env.checksum) return { ok: false, reason: 'checksum' };
  try {
    return { ok: true, state: deserializeState(env.game), env };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

export const exportString = (s: GameState): string => {
  const game = serializeState(s);
  return `ODR1:${LZString.compressToEncodedURIComponent(game)}.${fnv1a(game)}`;
};

export function importString(str: string): GameState | null {
  const m = /^ODR1:([A-Za-z0-9+\-$]+)\.([0-9a-f]{8})$/.exec(str.trim());
  if (!m?.[1] || !m[2]) return null;
  const game = LZString.decompressFromEncodedURIComponent(m[1]);
  if (!game || fnv1a(game) !== m[2]) return null;
  try {
    return deserializeState(game);
  } catch {
    return null;
  }
}
