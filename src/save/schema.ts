// セーブのスキーマ v1（arch §11・Q-10。BL-026）: valibot で形をたどり、読めるものは補正して読む。
// - 拒否（この関数は ok:false を返す）: game がオブジェクトでない、game.run か game.meta がオブジェクトでない（invalidGame）
// - 補正: Decimal（NaN・型違い → 0、負 → 0、Infinity・上限超え → 上限）、整数（切り捨て・0 未満は 0・読めなければ初期値）、
//   レベル（ドリル・自動掘削機・湯船・ポンプ）は PARAMS.levelMax まで、
//   チケット 0〜10、真偽値、知らない ID と重複は捨てる、湯船の枠は湯船のレベルに合う数、枠の知らない・未発見・重複の源泉は空き、
//   擬似乱数の状態が不正なら周回のシードから作り直す、欠けたフィールドは初期値、知らない追加のフィールドは捨てる
// - 直したフィールドは corrected（"run.coins" のようなパス）に入れる（入力と、補正後の保存の形を比べて求める）
import * as v from 'valibot';
import { GUEST_BY_ID, type GuestId } from '../content/guests.ts';
import { ORE_BY_ID, type OreId } from '../content/ores.ts';
import { PARAMS } from '../content/params.ts';
import { SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import { STRATA } from '../content/strata.ts';
import { TERRAIN_IDS, INITIAL_TERRAIN, type TerrainId } from '../content/terrains.ts';
import { TOOLS } from '../content/tools.ts';
import { isUpgradeId, type UpgradeId } from '../content/upgrades.ts';
import {
  computeGuests,
  createInput,
  isValidSfc32,
  normalizeSeed,
  num,
  seedSfc32,
  slotsForBathLevel,
  toSaveGame,
  type GameState,
  type Num,
  type Sfc32State,
  SAVE_SCHEMA_VERSION,
} from '../core/index.ts';

export { SAVE_SCHEMA_VERSION };

// ---- 値の補正（どんな入力でも例外を投げない） ----

/** 数値か数値の文字列を有限の number に。読めなければ null */
function toFinite(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '' && x.length <= 64) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
/** 0 以上の整数（小数は切り捨て、0 未満は 0、上限は安全な整数。読めなければ def） */
const int = (def: number, max = Number.MAX_SAFE_INTEGER) => (x: unknown): number => {
  const n = toFinite(x);
  if (n === null) return def;
  return Math.min(max, Math.max(0, Math.trunc(n)));
};
/** 0 以上の有限の数（ms など。読めなければ def） */
const nonNeg = (def = 0) => (x: unknown): number => {
  const n = toFinite(x);
  return n === null ? def : Math.max(0, n);
};
const bool = (def: boolean) => (x: unknown): boolean => (typeof x === 'boolean' ? x : def);
/** Decimal（num.ts の規則: 負・NaN → 0、Infinity・上限超え → 上限） */
const dec = (x: unknown): Num => num(x);
/** [0, 1) の端数 */
const frac = (x: unknown): number => {
  const n = toFinite(x);
  return n === null || n < 0 || n >= 1 ? 0 : n;
};

const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
/** ID の配列の長さの上限（S1 は形だけで残す改良・木・実績も含む。S2 で ID を定義したら「知っている ID だけ」にする。レビュー S-5） */
export const MAX_ID_LIST = 256;
/** 決まった ID の集合の配列（知らない ID・重複は捨てる。上限を超えた分も捨てる。重複の検査は Set で O(n)。レビュー S-5） */
const idList = <T extends string>(valid: (x: string) => boolean) => (x: unknown): T[] => {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of x) {
    if (out.length >= MAX_ID_LIST) break;
    if (typeof e === 'string' && !seen.has(e) && valid(e)) {
      seen.add(e);
      out.push(e as T);
    }
  }
  return out;
};
const isSpring = (x: string): x is SpringId => Object.hasOwn(SPRING_BY_ID, x);
const isGuest = (x: string): x is GuestId => Object.hasOwn(GUEST_BY_ID, x);
const isOreId = (x: string): x is OreId => Object.hasOwn(ORE_BY_ID, x);
const isTerrain = (x: string): x is TerrainId => (TERRAIN_IDS as readonly string[]).includes(x);
/** S2 以降で定義する ID（改良・木・実績）: S1 は形の正しい文字列だけを残す（arch §6-1） */
const isShapedId = (x: string): boolean => ID_SHAPE.test(x);

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 決まった ID をキーにした数の表（知らないキーは捨てる） */
const countMap = <K extends string>(valid: (x: string) => boolean, value: (x: unknown) => number) => (x: unknown): Partial<Record<K, number>> => {
  const out: Partial<Record<K, number>> = {};
  if (!isRecord(x)) return out;
  for (const k of Object.keys(x).filter(valid).sort()) out[k as K] = value(x[k]); // 知らないキーは並べ替える前に捨てる
  return out;
};

// ---- valibot のスキーマ（欠けたキー・型違いは fallback の初期値、値は transform で補正） ----

/** 値の補正関数を、欠けたキーでも初期値になるスキーマにする */
const field = <T>(fix: (x: unknown) => T) => v.fallback(v.pipe(v.unknown(), v.transform(fix)), () => fix(undefined));
/** 入れ子のオブジェクト（オブジェクトでなければ、中身をすべて初期値にする） */
const section = <E extends v.ObjectEntries>(entries: E) => {
  const schema = v.object(entries);
  return v.fallback(v.pipe(v.unknown(), v.transform((x) => v.parse(schema, isRecord(x) ? x : {}))), () => v.parse(schema, {}));
};

const TOOL_MAX = TOOLS.length - 1;
/** レベルの上限（ドリル・自動掘削機・湯船・ポンプ）。超えたら上限に補正する（レビュー S-4） */
const LEVEL_MAX = PARAMS.levelMax;

const RunSchema = v.object({
  seed: field((x) => normalizeSeed(toFinite(x) ?? 0)),
  terrain: field((x): TerrainId => (typeof x === 'string' && isTerrain(x) ? x : INITIAL_TERRAIN)),
  coins: field(dec),
  depth: field(int(0)),
  maxDepth: field(int(0)),
  blockDmg: field(dec),
  digCarry: field(frac),
  diggerCarry: field(frac),
  interludeMs: field((x) => Math.min(PARAMS.interludeMs, nonNeg()(x))),
  drill: section({ level: field(int(0, LEVEL_MAX)), tool: field(int(0, TOOL_MAX)) }),
  autoDig: section({ level: field(int(0, LEVEL_MAX)), on: field(bool(false)) }),
  springs: field((x) => {
    const out: Partial<Record<SpringId, { pump: number }>> = {};
    if (!isRecord(x)) return out;
    for (const k of Object.keys(x).filter(isSpring).sort()) {
      const e = x[k];
      out[k] = { pump: Math.max(1, int(1, LEVEL_MAX)(isRecord(e) ? e.pump : undefined)) }; // 発見済みの源泉のポンプは Lv1 以上
    }
    return out;
  }),
  bath: section({ level: field(int(0, LEVEL_MAX)), slots: field((x) => (Array.isArray(x) ? (x as unknown[]) : [])) }),
  upgrades: field(idList<UpgradeId>(isUpgradeId)), // 知らない改良の ID は捨てる（TS-026-11。BL-018）
  guests: field(idList<GuestId>(isGuest)),
  boost: section({ remainingMs: field(nonNeg()), readyAtWallMs: field(nonNeg()) }),
  vein: section({
    nextAtMs: field(nonNeg()),
    active: field((x) =>
      isRecord(x) ? { depth: int(0)(x.depth), hits: int(0)(x.hits), expiresAtMs: nonNeg()(x.expiresAtMs) } : null,
    ),
  }),
  // 未受け取りのオフライン収入（BL-058）。オブジェクトでなければ null。ms は 0 以上の有限の数（読めなければ 0）
  pendingOffline: field((x) => (isRecord(x) ? { coins: dec(x.coins), ms: nonNeg()(x.ms) } : null)),
  stratumSeen: field((x) => {
    const seen = new Set<number>([0]); // 帯 1（0）は常に見たことにする
    if (Array.isArray(x)) for (const b of x as unknown[]) if (typeof b === 'number' && Number.isInteger(b) && b >= 0 && b < STRATA.length) seen.add(b);
    return [...seen].sort((a, b) => a - b);
  }),
});

const MetaSchema = v.object({
  yunohana: section({ lifetime: field(dec), spent: field(dec) }),
  perks: field(idList<string>(isShapedId)),
  prestiges: field(int(0)),
  terrainsUnlocked: field((x) => {
    const t = idList<TerrainId>((e) => isTerrain(e))(x);
    return t.includes(INITIAL_TERRAIN) ? t : [INITIAL_TERRAIN, ...t];
  }),
  endingSeen: field(bool(false)),
  tickets: field(int(PARAMS.tickets.initial, PARAMS.tickets.max)),
});

const RestSchema = v.object({
  rng: section({ run: field((x) => (isValidSfc32(x) ? ([...x] as Sfc32State) : null)) }),
  clock: section({ playedMs: field(nonNeg()) }),
  collection: section({
    ores: field(countMap<OreId>(isOreId, int(0))),
    springsSeen: field(idList<SpringId>(isSpring)),
    guestsSeen: field(countMap<GuestId>(isGuest, nonNeg())),
    achievements: field(idList<string>(isShapedId)),
  }),
  stats: section({
    totalCoins: field(dec),
    taps: field(int(0)),
    hits: field(int(0)),
    blocks: field(int(0)),
    bestDepth: field(int(0)),
    offlineMaxMs: field(nonNeg()),
  }),
  tutorial: section({ step: field(int(0)), dismissed: field(bool(false)) }),
});

// ---- 読み込み ----

export type ParseGameResult = { ok: true; state: GameState; corrected: string[] } | { ok: false; reason: 'invalidGame' };

/** 補正の一覧に入れるパスの数の上限（壊れたデータで巨大な配列を作らない） */
const MAX_CORRECTED = 50;

/** 入力 a と補正後 b の違うパスを集める（キーの順番は問わない） */
function diffPaths(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length >= MAX_CORRECTED) return;
  if (Object.is(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(path);
      return;
    }
    for (let i = 0; i < a.length && out.length < MAX_CORRECTED; i++) diffPaths(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (out.length >= MAX_CORRECTED) return;
      diffPaths(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  out.push(path);
}

/**
 * 保存の形の game（信頼しない入力）→ 状態。拒否は { ok:false, reason:'invalidGame' }、それ以外は補正して読む。
 * 例外を投げない。入力のオブジェクトは書き換えない
 */
export function parseGame(raw: unknown): ParseGameResult {
  if (!isRecord(raw) || !isRecord(raw.run) || !isRecord(raw.meta)) return { ok: false, reason: 'invalidGame' };
  try {
    const run = v.parse(RunSchema, raw.run);
    const meta = v.parse(MetaSchema, raw.meta);
    const rest = v.parse(RestSchema, raw);

    // 形を越えた整合: 最深 ≧ 深さ、道具が 1 段目未満なら自動掘りはオフ、枠は湯船のレベルに合う数・発見済みの源泉だけ・重複なし
    run.maxDepth = Math.max(run.maxDepth, run.depth);
    if (run.drill.tool < 1) run.autoDig.on = false;
    const nSlots = slotsForBathLevel(run.bath.level);
    const slots: (SpringId | null)[] = [];
    for (let i = 0; i < nSlots; i++) {
      const e = run.bath.slots[i];
      slots.push(typeof e === 'string' && isSpring(e) && run.springs[e] && !slots.includes(e) ? e : null);
    }
    const stats = { ...rest.stats, bestDepth: Math.max(rest.stats.bestDepth, run.maxDepth) };
    const state: GameState = {
      schema: SAVE_SCHEMA_VERSION,
      rng: { run: rest.rng.run ?? seedSfc32(run.seed) },
      clock: rest.clock,
      run: { ...run, bath: { level: run.bath.level, slots }, guests: [] },
      meta,
      collection: rest.collection,
      stats,
      tutorial: rest.tutorial,
      input: createInput(),
    };
    // お客さんは枠と源泉から決まる（抽選なし）ので、読み込んだ状態から求め直す
    state.run.guests = computeGuests(state);
    const corrected: string[] = [];
    diffPaths(raw, toSaveGame(state), '', corrected);
    return { ok: true, state, corrected };
  } catch {
    // どのスキーマも fallback と transform だけなので、ここには来ない想定（念のため拒否にする）
    return { ok: false, reason: 'invalidGame' };
  }
}
