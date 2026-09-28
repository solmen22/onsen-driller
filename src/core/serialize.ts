// 保存する形（SaveGame）への変換・正規化した JSON・stateHash（arch §11。Q-10・Q-16。BL-010・BL-026）
// - 保存する形は JSON にできる値だけ。Decimal は "<仮数>e<指数>" の文字列（num.ts の toStr）
// - input（長押し中か・連打の記録）は保存しない
// - checksum と stateHash は「キーを辞書順に並べた正規化 JSON」の FNV-1a（32 ビット、小文字の 16 進 8 桁）
import type { GuestId } from '../content/guests.ts';
import type { SpringId } from '../content/springs.ts';
import type { TerrainId } from '../content/terrains.ts';
import { num, toStr } from './num.ts';
import type { Sfc32State } from './rng.ts';
import { createInput, type AchId, type GameState, type OreId, type PerkId, type UpgradeId } from './state.ts';

export interface SaveGame {
  schema: number;
  rng: { run: number[] };
  clock: { playedMs: number };
  run: {
    seed: number;
    terrain: TerrainId;
    coins: string;
    depth: number;
    maxDepth: number;
    blockDmg: string;
    digCarry: number;
    diggerCarry: number;
    interludeMs: number;
    drill: { level: number; tool: number };
    autoDig: { level: number; on: boolean };
    springs: Partial<Record<SpringId, { pump: number }>>;
    bath: { level: number; slots: (SpringId | null)[] };
    upgrades: UpgradeId[];
    guests: GuestId[];
    boost: { remainingMs: number; readyAtWallMs: number };
    vein: { nextAtMs: number; active: null | { depth: number; hits: number; expiresAtMs: number } };
    stratumSeen: number[];
  };
  meta: {
    yunohana: { lifetime: string; spent: string };
    perks: PerkId[];
    prestiges: number;
    terrainsUnlocked: TerrainId[];
    endingSeen: boolean;
    tickets: number;
  };
  collection: {
    ores: Partial<Record<OreId, number>>;
    springsSeen: SpringId[];
    guestsSeen: Partial<Record<GuestId, number>>;
    achievements: AchId[];
  };
  stats: { totalCoins: string; taps: number; hits: number; blocks: number; bestDepth: number; offlineMaxMs: number };
  tutorial: { step: number; dismissed: boolean };
}

/** 状態 → 保存する形（新しいオブジェクト。元の状態と共有しない） */
export function toSaveGame(s: GameState): SaveGame {
  const r = s.run;
  const springs: Partial<Record<SpringId, { pump: number }>> = {};
  for (const [id, v] of Object.entries(r.springs)) if (v) springs[id as SpringId] = { pump: v.pump };
  return {
    schema: s.schema,
    rng: { run: [...s.rng.run] },
    clock: { playedMs: s.clock.playedMs },
    run: {
      seed: r.seed,
      terrain: r.terrain,
      coins: toStr(r.coins),
      depth: r.depth,
      maxDepth: r.maxDepth,
      blockDmg: toStr(r.blockDmg),
      digCarry: r.digCarry,
      diggerCarry: r.diggerCarry,
      interludeMs: r.interludeMs,
      drill: { level: r.drill.level, tool: r.drill.tool },
      autoDig: { level: r.autoDig.level, on: r.autoDig.on },
      springs,
      bath: { level: r.bath.level, slots: [...r.bath.slots] },
      upgrades: [...r.upgrades],
      guests: [...r.guests],
      boost: { remainingMs: r.boost.remainingMs, readyAtWallMs: r.boost.readyAtWallMs },
      vein: { nextAtMs: r.vein.nextAtMs, active: r.vein.active ? { ...r.vein.active } : null },
      stratumSeen: [...r.stratumSeen],
    },
    meta: {
      yunohana: { lifetime: toStr(s.meta.yunohana.lifetime), spent: toStr(s.meta.yunohana.spent) },
      perks: [...s.meta.perks],
      prestiges: s.meta.prestiges,
      terrainsUnlocked: [...s.meta.terrainsUnlocked],
      endingSeen: s.meta.endingSeen,
      tickets: s.meta.tickets,
    },
    collection: {
      ores: { ...s.collection.ores },
      springsSeen: [...s.collection.springsSeen],
      guestsSeen: { ...s.collection.guestsSeen },
      achievements: [...s.collection.achievements],
    },
    stats: {
      totalCoins: toStr(s.stats.totalCoins),
      taps: s.stats.taps,
      hits: s.stats.hits,
      blocks: s.stats.blocks,
      bestDepth: s.stats.bestDepth,
      offlineMaxMs: s.stats.offlineMaxMs,
    },
    tutorial: { step: s.tutorial.step, dismissed: s.tutorial.dismissed },
  };
}

/**
 * 保存する形 → 状態（検証しない。自分で作った SaveGame の往復・複製用）。
 * 外から来たデータ（ストレージ・フック）は save/schema.ts の parseGame で検証・補正してから使う
 */
export function fromSaveGameTrusted(g: SaveGame): GameState {
  const clone = JSON.parse(JSON.stringify(g)) as SaveGame;
  return {
    ...clone,
    rng: { run: clone.rng.run as Sfc32State },
    run: { ...clone.run, coins: num(clone.run.coins), blockDmg: num(clone.run.blockDmg) },
    meta: { ...clone.meta, yunohana: { lifetime: num(clone.meta.yunohana.lifetime), spent: num(clone.meta.yunohana.spent) } },
    stats: { ...clone.stats, totalCoins: num(clone.stats.totalCoins) },
    input: createInput(),
  };
}

/** 入れ子の深さの上限（深すぎる入力で落ちないように。Q-10） */
export const MAX_JSON_DEPTH = 64;

/** キーを辞書順に並べた、空白なしの JSON（checksum・stateHash 用）。JSON にできない値・深すぎる入れ子は例外 */
export function canonicalJson(v: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) throw new Error('canonicalJson: too deep');
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x, depth + 1))).join(',')}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k], depth + 1)}`).join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof v}`);
  }
}

/** FNV-1a（32 ビット。UTF-16 の符号単位ごと）。小文字の 16 進 8 桁 */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 保存データの checksum（game オブジェクトから） */
export const checksumOf = (game: unknown): string => fnv1a(canonicalJson(game));

/** 状態のハッシュ（＝保存したときの checksum。__game.stateHash） */
export const stateHash = (s: GameState): string => checksumOf(toSaveGame(s));

/** 状態の複製（入力の一時状態も写す） */
export function cloneState(s: GameState): GameState {
  const c = fromSaveGameTrusted(toSaveGame(s));
  c.input = { hold: s.input.hold, manualLog: [...s.input.manualLog] };
  return c;
}

/** 保存する形の JSON 文字列（互換: PoC の serializeState） */
export const serializeState = (s: GameState): string => JSON.stringify(toSaveGame(s));
/** serializeState の逆（検証しない。互換: PoC の deserializeState。E2E の補助が使う） */
export const deserializeState = (json: string): GameState => fromSaveGameTrusted(JSON.parse(json) as SaveGame);
