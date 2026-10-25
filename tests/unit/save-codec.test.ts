// BL-026: セーブの codec とスキーマ v1（TS-026-01〜18。Q-10）
import fc from 'fast-check';
import { fcRuns } from '../helpers/fc-runs.ts';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import {
  advance,
  applyGrant,
  createInitialState,
  dispatch,
  num,
  NUM_MAX,
  stateHash,
  step,
  toSaveGame,
  type GameState,
} from '../../src/core/index.ts';
import {
  decodeSave,
  encodeSave,
  exportString,
  importString,
  MAX_IMPORT_CHARS,
  MAX_SAVE_CHARS,
  parseGameForHook,
  type ImportResult,
} from '../../src/save/codec.ts';
import { decompressUriBounded } from '../../src/save/lz-bounded.ts';
import { MAX_ID_LIST, parseGame, SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { measureOnce } from '../support/cpu-time.ts';
import { stateWith } from '../support/states.ts';

const APP = '0.0.1';

/** テストの中で独立に書いた FNV-1a（32 ビット・UTF-16 の符号単位ごと）と、キーを並べ替えた JSON */
function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

interface Env {
  schema: unknown;
  seq: unknown;
  savedAt: unknown;
  appVersion: unknown;
  checksum: string;
  game: Record<string, unknown> & { run: Record<string, unknown>; meta: Record<string, unknown> };
}
const envOf = (s: GameState, seq = 1, savedAt = 1_700_000_000_000): Env => JSON.parse(encodeSave(s, seq, savedAt, APP)) as Env;
/** 値を書き換えて checksum を付け直す（「値だけ不正」なデータ） */
function resign(e: Env): string {
  e.checksum = fnv(canon(e.game));
  return JSON.stringify(e);
}
const load = (raw: string): GameState => {
  const r = decodeSave(raw);
  if (!r.ok) throw new Error(`decode failed: ${r.reason}`);
  return r.state;
};

describe('TS-026-01 任意の GameState の往復（property）', () => {
  it('load(save(state)) で全フィールドが一致し、補正がない', () => {
    fc.assert(
      fc.property(gameStateArb, (s) => {
        const r = decodeSave(encodeSave(s, 3, 12345, APP));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.corrected).toEqual([]);
        expect(toSaveGame(r.state)).toEqual(toSaveGame(s));
        expect(stateHash(r.state)).toBe(stateHash(s));
        expect(r.state.run.coins.eq(s.run.coins) && r.state.run.coins.mantissa === s.run.coins.mantissa).toBe(true);
        expect(r.state.input).toEqual({ hold: false, manualLog: [] });
      }),
      fcRuns(200, 2601),
    );
  });
});

describe('TS-026-02 Decimal は文字列、回数・レベル・深さは数値', () => {
  it('コイン 1.23e45 → "1.23e45"', () => {
    const s = stateWith({ coins: '1.23e45', depth: 12, drill: 3 });
    const e = envOf(s);
    expect(e.game.run.coins).toBe('1.23e45');
    expect(e.game.run.blockDmg).toBe('0');
    expect(typeof e.game.run.depth).toBe('number');
    expect(e.game.run.drill).toEqual({ level: 3, tool: 0 });
  });
});

describe('TS-026-03・04 封筒と checksum', () => {
  it('キーは 6 つ、schema は今の版・savedAt は注入した時刻・appVersion は版', () => {
    const e = envOf(createInitialState(1), 7, 1_234_567);
    expect(Object.keys(e).sort()).toEqual(['appVersion', 'checksum', 'game', 'savedAt', 'schema', 'seq']);
    expect([e.schema, e.seq, e.savedAt, e.appVersion]).toEqual([SAVE_SCHEMA_VERSION, 7, 1_234_567, APP]);
    expect(typeof e.game).toBe('object');
  });
  it('checksum は正規化した game の FNV-1a（小文字 16 進 8 桁）。既知の値も一致', () => {
    expect([fnv(''), fnv('a')]).toEqual(['811c9dc5', 'e40c292c']);
    const e = envOf(stateWith({ coins: 99, depth: 40 }));
    expect(e.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(e.checksum).toBe(fnv(canon(e.game)));
  });
  it('TS-026-05 game の中のキーの順番を入れ替えても読める', () => {
    const e = envOf(stateWith({ coins: 5, depth: 3 }));
    const shuffle = (o: unknown): unknown => {
      if (Array.isArray(o)) return o.map(shuffle);
      if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, shuffle(v)]));
      return o;
    };
    e.game = shuffle(e.game) as Env['game'];
    expect(decodeSave(JSON.stringify(e)).ok).toBe(true);
  });
});

describe('TS-026-06・07 壊れたデータは拒否（例外を投げず理由で返す）', () => {
  it('game の 1 文字を書き換えた（checksum はそのまま）→ checksum', () => {
    const raw = encodeSave(stateWith({ coins: 123 }), 1, 1, APP);
    const bad = raw.replace('"coins":"1.23e2"', '"coins":"1.24e2"');
    expect(bad).not.toBe(raw);
    expect(decodeSave(bad)).toEqual({ ok: false, reason: 'checksum' });
  });
  it('途中で切れた・空・null・[]・123・abc・数値以外', () => {
    const raw = encodeSave(createInitialState(1), 1, 1, APP);
    const cases: [unknown, string][] = [
      [raw.slice(0, raw.length / 2), 'notJson'],
      [raw.slice(0, -1), 'notJson'],
      ['', 'notJson'],
      ['null', 'shape'],
      ['[]', 'shape'],
      ['123', 'shape'],
      ['abc', 'notJson'],
      [42, 'notJson'],
      [null, 'notJson'],
    ];
    for (const [input, reason] of cases) {
      let r: ReturnType<typeof decodeSave> | undefined;
      expect(() => (r = decodeSave(input))).not.toThrow();
      expect(r, String(input).slice(0, 20)).toEqual({ ok: false, reason });
    }
  });
});

describe('TS-026-08 __proto__・constructor・prototype のキーを捨てる（プロトタイプ汚染なし）', () => {
  it('トップ・game・run・run.springs のキー: 捨てた後の game は元と同じなので、checksum が合って読める', () => {
    const s = stateWith({ pumps: { simple: 2 }, bath: 0 });
    const raw = encodeSave(s, 1, 1, APP)
      .replace('{"schema"', '{"__proto__":{"polluted":1},"schema"')
      .replace('"game":{', '"game":{"constructor":{"prototype":{"polluted":1}},')
      .replace('"springs":{', '"springs":{"__proto__":{"polluted":1},')
      .replace('"run":{', '"run":{"prototype":{"polluted":1},');
    const r = decodeSave(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.state.run.springs, '__proto__')).toBe(false);
    expect(stateHash(r.state)).toBe(stateHash(s));
    expect(JSON.stringify(toSaveGame(r.state))).not.toMatch(/__proto__|constructor|prototype|polluted/);
  });
  it('配列の要素の中: 要素が {} になって game が変わるので checksum で拒否（汚染もない）', () => {
    const s = stateWith({ pumps: { simple: 2 }, bath: 0 });
    const raw = encodeSave(s, 1, 1, APP).replace('"slots":["simple"', '"slots":[{"__proto__":{"polluted":1}},"simple"');
    expect(decodeSave(raw)).toEqual({ ok: false, reason: 'checksum' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('TS-026-09・10 値だけ不正（checksum は付け直す）→ 補正して読む（Q-10）', () => {
  it('負のコイン・負の深さ・チケット 99 と −1・レベル 3.7・上限超えのコイン', () => {
    const e = envOf(createInitialState(1));
    Object.assign(e.game.run, { coins: '-5', depth: -3, drill: { level: 3.7, tool: 0 } });
    e.game.meta.tickets = 99;
    const a = decodeSave(resign(e));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.state.run.coins.eq(0)).toBe(true);
    expect(a.state.run.depth).toBe(0);
    expect(a.state.run.drill.level).toBe(3);
    expect(a.state.meta.tickets).toBe(10);
    expect(a.corrected).toEqual(expect.arrayContaining(['run.coins', 'run.depth', 'run.drill.level', 'meta.tickets']));
    const f = envOf(createInitialState(1));
    f.game.meta.tickets = -1;
    f.game.run.coins = '1e9000000000000001';
    const b = load(resign(f));
    expect(b.meta.tickets).toBe(0);
    expect(b.run.coins.eq(NUM_MAX)).toBe(true);
  });
  it('"NaN"・"abc" は 0、"Infinity" は上限、数値の 123 は 123、文字列の "5" は 5', () => {
    const read = (coins: unknown, level: unknown = 0): GameState => {
      const e = envOf(createInitialState(1));
      Object.assign(e.game.run, { coins, drill: { level, tool: 0 } });
      return load(resign(e));
    };
    expect(read('NaN').run.coins.eq(0)).toBe(true);
    expect(read('abc').run.coins.eq(0)).toBe(true);
    expect(read('Infinity').run.coins.eq(NUM_MAX)).toBe(true);
    expect(read(123).run.coins.eq(123)).toBe(true);
    expect(read('1.23e+45').run.coins.eq(num('1.23e45'))).toBe(true);
    expect(read(0, '5').run.drill.level).toBe(5);
  });
  it('TS-026-11 知らない源泉 ID・枠 100 個・知らない追加のフィールド・欠けた区画', () => {
    const e = envOf(stateWith({ pumps: { simple: 1 }, bath: 0 }));
    Object.assign(e.game.run, { bath: { level: 0, slots: Array.from({ length: 100 }, () => 'foo') }, extra: 1, guests: ['tanuki', 'dragon'] });
    delete e.game.tutorial;
    e.game.hacked = true;
    const s = load(resign(e));
    expect(s.run.bath.slots).toEqual([null]);
    expect(s.tutorial).toEqual({ step: 0, dismissed: false });
    expect(s.run.guests).toEqual([]); // 枠が空なのでタヌキも来ていない（条件から求め直す）
    expect(JSON.stringify(toSaveGame(s))).not.toMatch(/extra|hacked|dragon/);
  });
  it('枠の未発見の源泉・重複は空き、湯船のレベルに合う数に足す', () => {
    const e = envOf(stateWith({ pumps: { simple: 1 }, bath: 0 }));
    Object.assign(e.game.run, { bath: { level: 5, slots: ['simple', 'simple', 'iron'] } });
    const s = load(resign(e));
    expect(s.run.bath.slots).toEqual(['simple', null]);
  });
});

describe('TS-026-12・13 拒否（game・run・meta・schema）', () => {
  it('game がオブジェクトでない・run がない → invalidGame', () => {
    for (const game of ['text', [1, 2], null]) {
      const e = envOf(createInitialState(1));
      (e as { game: unknown }).game = game;
      expect(decodeSave(resign(e))).toEqual({ ok: false, reason: 'invalidGame' });
    }
    const e = envOf(createInitialState(1));
    delete (e.game as Record<string, unknown>).run;
    expect(decodeSave(resign(e))).toEqual({ ok: false, reason: 'invalidGame' });
  });
  it('schema がない・0 は shape、"2" は 2 として読む、1（古い版）も読む、3（新しい版）は newer', () => {
    const withSchema = (schema: unknown): ReturnType<typeof decodeSave> => {
      const e = envOf(createInitialState(1)) as Env & { schema?: unknown };
      if (schema === undefined) delete e.schema;
      else e.schema = schema;
      return decodeSave(JSON.stringify(e));
    };
    expect(withSchema(undefined)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema(0)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema(1.5)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema('2').ok).toBe(true);
    expect(withSchema(1).ok).toBe(true);
    expect(withSchema(3)).toEqual({ ok: false, reason: 'newer' });
  });
  it('封筒のキーの欠落・seq が負や小数 → shape。savedAt・appVersion の型違いは補正', () => {
    const e = envOf(createInitialState(1)) as Env & { seq?: unknown };
    e.seq = -1;
    expect(decodeSave(JSON.stringify(e))).toEqual({ ok: false, reason: 'shape' });
    e.seq = 2.5;
    expect(decodeSave(JSON.stringify(e))).toEqual({ ok: false, reason: 'shape' });
    const f = envOf(createInitialState(1));
    f.savedAt = 'yesterday';
    f.appVersion = 7;
    const r = decodeSave(JSON.stringify(f));
    expect(r.ok && [r.env.savedAt, r.env.appVersion]).toEqual([0, 'unknown']);
  });
});

describe('TS-026-20 新しい版（今の版＋1）は封筒の形・checksum より先に newer と判定する（レビュー M-1）', () => {
  /** 新しい版の封筒（中身は正しい今の版の game。今の版の書き方で作ってから schema だけ変える） */
  const newerEnv = (): Env & Record<string, unknown> => {
    const e = envOf(stateWith({ coins: 50, depth: 20 }), 9) as Env & Record<string, unknown>;
    e.schema = SAVE_SCHEMA_VERSION + 1;
    return e;
  };
  it('① checksum 違い ② checksum なし・数値 ③ seq なし・"3"・−1 ④ savedAt・appVersion なし ⑤ game なし・文字列・配列・null ⑥ 知らないキー ⑦ run なし → どれも newer', () => {
    const variants: [string, (e: Env & Record<string, unknown>) => void][] = [
      ['① checksum が別の 8 桁', (e) => (e.checksum = 'ffffffff')],
      ['① checksum の形式が変わった', (e) => (e.checksum = 'sha256:abcdef')],
      ['② checksum のキーを消す', (e) => delete (e as Record<string, unknown>).checksum],
      ['② checksum が数値', (e) => (e.checksum = 12345 as unknown as string)],
      ['③ seq を消す', (e) => delete e.seq],
      ['③ seq が文字列 "3"', (e) => (e.seq = '3')],
      ['③ seq が −1', (e) => (e.seq = -1)],
      ['④ savedAt・appVersion を消す', (e) => (delete e.savedAt, delete e.appVersion)],
      ['⑤ game を消す', (e) => delete (e as Record<string, unknown>).game],
      ['⑤ game が文字列（二重に包む形式）', (e) => ((e as { game: unknown }).game = '{"run":{}}')],
      ['⑤ game が配列', (e) => ((e as { game: unknown }).game = [1, 2])],
      ['⑤ game が null', (e) => ((e as { game: unknown }).game = null)],
      ['⑥ 知らないキー（checksumV2・slots）', (e) => ((e.checksumV2 = 'x'), (e.slots = []))],
      ['⑦ game から run を消す（checksum は付け直す）', (e) => (delete (e.game as Record<string, unknown>).run, (e.checksum = fnv(canon(e.game))))],
    ];
    for (const [name, change] of variants) {
      const e = newerEnv();
      change(e);
      let r: ReturnType<typeof decodeSave> | undefined;
      expect(() => (r = decodeSave(JSON.stringify(e))), name).not.toThrow();
      expect(r, name).toEqual({ ok: false, reason: 'newer' });
    }
    expect(decodeSave('{"schema":3}')).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave('{"schema":3,"envelope":{"v":1}}')).toEqual({ ok: false, reason: 'newer' });
  });
});

describe('TS-026-21 schema の境界（新しい版・今の版・版として読めない）と、読めない形の新しい版（Q-22）', () => {
  const withSchema = (schema: unknown, change?: (e: Env & Record<string, unknown>) => void): ReturnType<typeof decodeSave> => {
    const e = envOf(stateWith({ coins: 50 }), 4) as Env & Record<string, unknown>;
    if (schema === undefined) delete e.schema;
    else e.schema = schema;
    change?.(e);
    return decodeSave(JSON.stringify(e));
  };
  const breakSum = (e: Env): void => {
    e.checksum = '00000000';
  };
  it('3・"3"・999・MAX_SAFE_INTEGER → ほかが正しくても崩れていても newer', () => {
    for (const v of [3, '3', 999, Number.MAX_SAFE_INTEGER]) {
      expect(withSchema(v), String(v)).toEqual({ ok: false, reason: 'newer' });
      expect(withSchema(v, breakSum), `${v} + checksum`).toEqual({ ok: false, reason: 'newer' });
    }
  });
  it('2（今の版）は従来どおり検査する: checksum 違い → checksum、seq なし → shape', () => {
    expect(withSchema(2, breakSum)).toEqual({ ok: false, reason: 'checksum' });
    expect(withSchema(2, (e) => delete e.seq)).toEqual({ ok: false, reason: 'shape' });
  });
  it('0・−1・1.5・"abc"・null・キーなし → shape。封筒がオブジェクトでない → shape', () => {
    for (const v of [0, -1, 1.5, 'abc', null, undefined]) expect(withSchema(v), String(v)).toEqual({ ok: false, reason: 'shape' });
    for (const raw of ['[1,2]', '42', 'null']) expect(decodeSave(raw), raw).toEqual({ ok: false, reason: 'shape' });
  });
  it('Q-22: 途中で切れた・100 万文字超・入れ子 65 段の 新しい版（schema 3）のセーブも newer（先頭の "schema":3 を拾う）', () => {
    const raw = encodeSave(stateWith({ coins: 50 }), 9, 1, APP).replace('{"schema":2', '{"schema":3');
    expect(raw.startsWith('{"schema":3,')).toBe(true);
    expect(decodeSave(raw.slice(0, raw.length / 2))).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave('{"schema":3')).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave('{ "schema" : "3" ,')).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave(`{"schema":3,"pad":"${'x'.repeat(1_100_000)}"}`)).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave(`{"schema":3,"deep":${'['.repeat(65)}${']'.repeat(65)}}`)).toEqual({ ok: false, reason: 'newer' });
  });
  it('今の版（schema 2）・古い版（schema 1）・先頭が schema でないものの壊れた文字列は今までどおり（newer にしない）', () => {
    const raw = encodeSave(stateWith({ coins: 50 }), 1, 1, APP);
    expect(decodeSave(raw.slice(0, raw.length / 2))).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave('{"seq":1,"schema":3')).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave('{"schema":1,"seq":')).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave(`{"schema":1,"pad":"${'x'.repeat(1_100_000)}"}`)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(decodeSave(`{"schema":1,"deep":${'['.repeat(65)}${']'.repeat(65)}}`)).toEqual({ ok: false, reason: 'shape' });
  });
});

describe('TS-026-14 巨大・深すぎる入力で落ちず、すぐ拒否する', () => {
  it('5MB の文字列 → tooLarge、深さ 10,000 の入れ子 → shape、どちらも 1 秒以内', () => {
    const big = 'x'.repeat(5_000_000);
    const nested = `${'['.repeat(10_000)}${']'.repeat(10_000)}`;
    const deep = `{"schema":1,"seq":1,"savedAt":0,"appVersion":"x","checksum":"00000000","game":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}}`;
    // 判定はこのスレッドの CPU 時間（BL-118。CPU が測れなければ実時間）
    const { value: out, timing: t } = measureOnce('TS-026-14', () => [big, nested, deep].map((input) => decodeSave(input)));
    expect(out).toEqual([
      { ok: false, reason: 'tooLarge' },
      { ok: false, reason: 'shape' },
      { ok: false, reason: 'shape' },
    ]);
    expect(t.ms, `${t.method} で判定`).toBeLessThan(1000);
  });
});

describe('TS-026-15 序盤の保存データの大きさ（記録）', () => {
  it('ツルハシ・ドリル Lv10・深さ 30m', () => {
    const s = createInitialState(1);
    applyGrant(s, { coins: '1e3', depth: 30 });
    dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
    dispatch(s, { type: 'buy', item: 'drill', qty: 10 });
    const bytes = encodeSave(s, 1, 1, APP).length;
    console.log(`[TS-026-15] early save: ${bytes} bytes`);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(200_000);
  });
});

describe('TS-026-16 SAVE_SCHEMA_VERSION と新しいゲーム', () => {
  it('save/schema.ts が 2 を公開し、新しいゲームは補正なしで通る', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(2);
    const r = parseGame(toSaveGame(createInitialState(9)));
    expect(r.ok && r.corrected).toEqual([]);
  });
});

describe('TS-026-17 保存をはさんでも決定論が保たれる', () => {
  it('擬似乱数・ブースト・鉱脈の時刻のある状態を保存 → 読み込み → 10 分 ＝ 保存しないで 10 分', () => {
    const make = (): GameState => {
      const s = stateWith({ seed: 17, tool: 2, drill: 30, digger: 5, autoOn: true, depth: 40 });
      s.run.boost = { remainingMs: 1234.5, readyAtWallMs: 1_700_000_123_456 };
      s.run.vein = { nextAtMs: 300_000, active: { depth: 45, hits: 3, expiresAtMs: 1_700_000_200_000 } };
      advance(s, 12_345);
      return s;
    };
    const a = make();
    const b = load(encodeSave(make(), 1, 1, APP));
    advance(a, 600_000);
    advance(b, 600_000);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe('TS-026-18 擬似乱数の状態が不正 → 周回のシードから作り直す（例外なし）', () => {
  it('[0,0,0,0]・小数・4 要素でない', () => {
    for (const rng of [[0, 0, 0, 0], [1.5, 2, 3, 4], [1, 2, 3], 'x']) {
      const e = envOf(createInitialState(3));
      e.game.rng = { run: rng };
      const s = load(resign(e));
      expect(s.rng.run).toHaveLength(4);
      expect(s.rng.run.some((x) => x !== 0)).toBe(true);
    }
  });
});

describe('parseGameForHook（フックの setState。Q-16）', () => {
  it('拒否（オブジェクトでない・run や meta がない）は例外', () => {
    for (const bad of [null, 'x', 1, [], {}, { run: {} }, { meta: {} }]) expect(() => parseGameForHook(bad)).toThrow();
  });
  it('補正で直るものは直して入れ、危険なキーは捨てる', () => {
    const g = toSaveGame(stateWith({ coins: 10 })) as unknown as Record<string, Record<string, unknown>>;
    g.run!.coins = '-3';
    g.run!['__proto__'] = { polluted: 1 };
    const s = parseGameForHook(g);
    expect(s.run.coins.eq(0)).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

/** 書き出し文字列を組み立てる（game の JSON を圧縮し、checksum を付ける。sum を渡すとその値にする） */
const exportOf = (game: unknown, sum?: string): string =>
  `ODR1:${LZString.compressToEncodedURIComponent(JSON.stringify(game))}.${sum ?? fnv(canon(game))}`;
const reasonOf = (r: ImportResult): string => (r.ok ? 'ok' : r.reason);

describe('TS-026-22 書き出し文字列の往復（property）', () => {
  it('importString(exportString(s)) は { ok:true, state } で stateHash が同じ。前後の空白・改行を付けても読める', () => {
    fc.assert(
      fc.property(gameStateArb, fc.constantFrom('', ' ', '\n', '\r\n  \t'), (s, pad) => {
        const str = exportString(s);
        expect(str).toMatch(/^ODR1:[A-Za-z0-9+\-$]+\.[0-9a-f]{8}$/);
        const r = importString(`${pad}${str}${pad}`);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(stateHash(r.state)).toBe(stateHash(s));
        expect(r.corrected).toEqual([]);
      }),
      fcRuns(100, 2622),
    );
  });
});

describe('TS-026-23 新しい版の書き出し文字列は newer（checksum より先に判定。Q-24）', () => {
  const game = (): Record<string, unknown> => toSaveGame(stateWith({ coins: 77, depth: 12 })) as unknown as Record<string, unknown>;
  it('game.schema が 3・"3" → newer（checksum を付け直しても・合わなくても）', () => {
    for (const v of [3, '3', 999]) {
      const g = { ...game(), schema: v };
      expect(reasonOf(importString(exportOf(g))), String(v)).toBe('newer');
      expect(reasonOf(importString(exportOf(g, '00000000'))), `${v} + checksum`).toBe('newer');
    }
  });
  it('game.schema が 1・"1"・キーなし（古い版）→ 読める（今の版に移行）', () => {
    for (const v of [1, '1', undefined]) {
      const g = game();
      if (v === undefined) delete g.schema;
      else g.schema = v;
      const r = importString(exportOf(g));
      expect(r.ok, String(v)).toBe(true);
      expect(r.ok && r.state.schema).toBe(SAVE_SCHEMA_VERSION);
    }
  });
  it('接頭辞が ODR2: 以上 → newer', () => {
    const str = exportString(stateWith({ coins: 1 }));
    expect(reasonOf(importString(str.replace('ODR1:', 'ODR2:')))).toBe('newer');
    expect(reasonOf(importString(str.replace('ODR1:', 'ODR10:')))).toBe('newer');
  });
});

/**
 * 'a' を k(k+1)/2 文字に展開する圧縮部（lz-string の形式）を直接作る。辞書の直前の項目＋1 文字を参照し続ける、
 * 最も膨らむ並び（lz-string で数百万文字を圧縮すると数秒かかるので、テストでは符号を直接並べる）
 */
function lzBomb(k: number): string {
  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = 0; i < n; i++) bits.push((value >> i) & 1); // 下位のビットから
  };
  let dictSize = 4;
  let numBits = 3;
  let enlargeIn = 4;
  put(0, 2);
  put(97, 8); // 最初の 1 文字 'a'
  for (let i = 1; i < k; i++) {
    put(dictSize, numBits); // まだない項目（直前の w ＋ w[0]）を参照する
    dictSize++;
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
  put(2, numBits); // 終わり
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) v = v * 2 + (bits[i + j] ?? 0); // 1 文字の 6 ビットは上位から読まれる
    out += alphabet[v];
  }
  return out;
}

describe('TS-026-24 展開の膨張・長すぎる入力（セキュリティ。展開しながら上限で止める）', () => {
  /** 展開の時間はこのスレッドの CPU 時間で測る（BL-118。CPU が測れなければ実時間） */
  const timed = (input: string, label = 'TS-026-24'): { reason: string; ms: number } => {
    const { value: r, timing: t } = measureOnce(label, () => importString(input));
    return { reason: reasonOf(r), ms: t.ms };
  };
  it('準備: lzBomb の圧縮部は lz-string 自身の展開でも同じ文字列になる', () => {
    for (const k of [1, 2, 5, 100]) expect(LZString.decompressFromEncodedURIComponent(lzBomb(k))).toBe('a'.repeat((k * (k + 1)) / 2));
  });
  it('① 展開すると 100 万文字を少し超える ②③ 約 300 万・500 万文字（数千文字が 700 倍以上に膨らむ）④ 5,000 万文字 → tooLarge、例外なし・1 秒以内', () => {
    for (const k of [1415, 2450, 3163, 10_000]) {
      const total = (k * (k + 1)) / 2;
      expect(total).toBeGreaterThan(MAX_SAVE_CHARS);
      const packed = lzBomb(k);
      expect(packed.length).toBeLessThan(MAX_IMPORT_CHARS);
      const r = timed(`ODR1:${packed}.00000000`, `TS-026-24 ${total} 文字`);
      expect(r.reason, `${total} 文字`).toBe('tooLarge');
      expect(r.ms, `${total} 文字`).toBeLessThan(1000);
    }
    // 上限の内側（約 99.9 万文字）は展開でき、JSON でないので notJson
    expect(timed(`ODR1:${lzBomb(1413)}.00000000`).reason).toBe('notJson');
  });
  it('lz-string で実際に圧縮した膨らむ入力（\'a\'×10 万）も、上限を小さくした展開で止まる', () => {
    const packed = LZString.compressToEncodedURIComponent('a'.repeat(100_000));
    expect(decompressUriBounded(packed, 100_000)).toEqual({ ok: true, text: 'a'.repeat(100_000) });
    expect(decompressUriBounded(packed, 99_999)).toEqual({ ok: false, reason: 'tooLarge' });
  });
  it(`④ 長さ ${MAX_IMPORT_CHARS}＋1 → tooLarge。⑤ ちょうど ${MAX_IMPORT_CHARS} は長さでは拒否しない（ほかの理由でよい）`, () => {
    const body = (len: number): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
      let x = '';
      let h = 12345;
      for (let i = 0; i < len; i++) {
        h = (Math.imul(h, 1103515245) + 12345) >>> 0;
        x += chars[h % 64];
      }
      return x;
    };
    const make = (total: number): string => `ODR1:${body(total - 'ODR1:'.length - 9)}.0123abcd`;
    const over = timed(make(MAX_IMPORT_CHARS + 1));
    expect(over.reason).toBe('tooLarge');
    const exact = make(MAX_IMPORT_CHARS);
    expect(exact.length).toBe(MAX_IMPORT_CHARS);
    const r = timed(exact);
    expect(r.reason).not.toBe('ok');
    expect(r.ms).toBeLessThan(1000);
    expect(timed(`  ${exact}\n`).reason).toBe(r.reason); // 前後の空白は長さに数えない
  });
  it('展開の関数そのもの: 上限ちょうどは通り、1 文字超で止まる。壊れた符号は corrupt', () => {
    const packed = LZString.compressToEncodedURIComponent('xyz'.repeat(1000));
    expect(decompressUriBounded(packed, 3000)).toEqual({ ok: true, text: 'xyz'.repeat(1000) });
    expect(decompressUriBounded(packed, 2999)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(decompressUriBounded('', 10)).toEqual({ ok: false, reason: 'corrupt' });
    expect(decompressUriBounded('!!', 10)).toEqual({ ok: false, reason: 'corrupt' });
    expect(decompressUriBounded(packed.slice(0, packed.length - 5), 3000).ok).toBe(false);
  });
});

describe('TS-026-25 壊れた・型の違う書き出し文字列はすべて理由つきで拒否し、例外を投げない（セキュリティ）', () => {
  const str = exportString(stateWith({ coins: 777, depth: 50 }));
  const [, packed = '', sum = ''] = /^ODR1:(.+)\.([0-9a-f]{8})$/.exec(str) ?? [];
  it('型の違う引数・空・接頭辞だけ・接頭辞違い・. なし・checksum の形違い・使えない文字 → format（ODR2: は newer）', () => {
    const cases: [unknown, string][] = [
      [null, 'format'],
      [undefined, 'format'],
      [123, 'format'],
      [{}, 'format'],
      ['', 'format'],
      ['ODR1:', 'format'],
      [str.replace('ODR1:', 'odr1:'), 'format'],
      [str.replace('ODR1:', 'XYZ1:'), 'format'],
      [str.replace('ODR1:', 'ODR2:'), 'newer'],
      [`ODR1:${packed}${sum}`, 'format'],
      [`ODR1:${packed}.${sum.slice(0, 7)}`, 'format'],
      [`ODR1:${packed}.${sum}0`, 'format'],
      [`ODR1:${packed}.${sum.toUpperCase().replace(/^[0-9]/, 'A')}`, 'format'],
      [`ODR1:${packed}.zzzzzzzz`, 'format'],
      [`ODR1:${packed.slice(0, 10)} ${packed.slice(10)}.${sum}`, 'format'],
      [`ODR1:${packed.slice(0, 10)}/${packed.slice(10)}.${sum}`, 'format'],
      [`ODR1:${packed.slice(0, 10)}=${packed.slice(10)}.${sum}`, 'format'],
    ];
    for (const [input, reason] of cases) {
      let r: ImportResult | undefined;
      expect(() => (r = importString(input)), String(input).slice(0, 30)).not.toThrow();
      expect(r && reasonOf(r), String(input).slice(0, 30)).toBe(reason);
    }
  });
  it('展開できない・JSON でない・game がオブジェクトでない・run がない・入れ子 65 段・checksum 違い → それぞれの理由', () => {
    const lz = (text: string): string => LZString.compressToEncodedURIComponent(text);
    const cases: [string, string][] = [
      [`ODR1:${packed.slice(0, packed.length - 3)}.${sum}`, 'notJson'],
      [`ODR1:${lz('not json {')}.${fnv('x')}`, 'notJson'],
      [exportOf([1, 2]), 'invalidGame'],
      [exportOf('text'), 'invalidGame'],
      [exportOf({ meta: {} }), 'invalidGame'],
      [`ODR1:${lz(`${'['.repeat(65)}${']'.repeat(65)}`)}.${sum}`, 'shape'],
      [exportOf(toSaveGame(stateWith({ coins: 5 })), '00000000'), 'checksum'],
      [`ODR1:${packed}.${sum === '00000000' ? '00000001' : '00000000'}`, 'checksum'],
    ];
    for (const [input, reason] of cases) {
      let r: ImportResult | undefined;
      expect(() => (r = importString(input))).not.toThrow();
      expect(r && reasonOf(r), `${reason}: ${input.slice(0, 40)}`).toBe(reason);
    }
  });
  it('__proto__・constructor.prototype を含む game: キーを捨てて読むか拒否し、どちらでもプロトタイプ汚染がない', () => {
    const g = toSaveGame(stateWith({ coins: 5 })) as unknown as Record<string, unknown>;
    const json = JSON.stringify(g).replace('{"clock"', '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"clock"');
    const sumRaw = fnv(canon(JSON.parse(json)));
    const r = importString(`ODR1:${LZString.compressToEncodedURIComponent(json)}.${sumRaw}`);
    expect(['ok', 'checksum']).toContain(reasonOf(r));
    const clean = importString(`ODR1:${LZString.compressToEncodedURIComponent(json)}.${fnv(canon(g))}`);
    expect(clean.ok).toBe(true); // 危険なキーを捨てた game の checksum で読める
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('TS-026-26 どんな文字列でも例外を投げない（property）', () => {
  const uriChars = fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$'.split(''));
  const good = exportString(stateWith({ coins: 777, depth: 50, drill: 12 }));
  const inputs = fc.oneof(
    fc.string({ maxLength: 200 }),
    fc
      .tuple(fc.array(uriChars, { maxLength: 20_000 }), fc.stringMatching(/^[0-9a-f]{8}$/))
      .map(([cs, h]) => `ODR1:${cs.join('')}.${h}`),
    fc.tuple(fc.array(fc.tuple(fc.nat(good.length - 1), uriChars), { minLength: 1, maxLength: 3 })).map(([edits]) => {
      const a = good.split('');
      for (const [i, ch] of edits) a[i] = ch;
      return a.join('');
    }),
  );
  it('1,000 回: 戻り値は { ok:false, reason } か { ok:true, state }（state は健全で 10 ステップ進めても例外なし）', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        let r: ImportResult | undefined;
        expect(() => (r = importString(input))).not.toThrow();
        if (!r) return;
        if (!r.ok) {
          expect(['format', 'tooLarge', 'notJson', 'shape', 'newer', 'checksum', 'invalidGame']).toContain(r.reason);
          return;
        }
        expect(Object.keys(toSaveGame(r.state)).sort()).toEqual(Object.keys(toSaveGame(createInitialState(1))).sort());
        expect(r.state.run.coins.gte(0) && Number.isFinite(r.state.run.coins.mantissa)).toBe(true);
        expect(() => {
          const st = r?.ok ? r.state : createInitialState(1);
          for (let i = 0; i < 10; i++) step(st, 100);
        }).not.toThrow();
      }),
      fcRuns(1000, 2626),
    );
  });
});

describe('レビュー S-5: ID の配列の重複除去は O(n) で、長さに上限がある', () => {
  it('upgrades に 15 万個の ID（重複あり）→ 1 秒以内、上限 MAX_ID_LIST 個まで、corrected に入る', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { run: Record<string, unknown>; meta: Record<string, unknown>; collection: Record<string, unknown> };
    const ids = Array.from({ length: 150_000 }, (_, i) => `u${i % 120_000}`);
    g.run.upgrades = ids;
    g.meta.perks = ids;
    g.collection.achievements = ids;
    // 判定はこのスレッドの CPU 時間（BL-118。CPU が測れなければ実時間）
    const { value: r, timing: t } = measureOnce('S-5 15 万個の ID', () => parseGame(g));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(t.ms, `${t.method} で判定`).toBeLessThan(1000);
    // 改良・木は知っている ID だけを残す（BL-018・BL-022。TS-026-11）ので、u0… はすべて捨てられる。上限の確かめは achievements で行う
    expect(r.state.run.upgrades).toEqual([]);
    expect(r.state.meta.perks).toEqual([]);
    expect(r.state.collection.achievements).toHaveLength(MAX_ID_LIST);
    expect(r.corrected).toEqual(expect.arrayContaining(['run.upgrades', 'meta.perks', 'collection.achievements']));
  });
  it('重複は 1 つにし、順番を保つ（上限より少なければ今までどおり）', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { collection: Record<string, unknown> };
    g.collection.achievements = ['b', 'a', 'b', 'bad id!', 'c', 'a'];
    const r = parseGame(g);
    expect(r.ok && r.state.collection.achievements).toEqual(['b', 'a', 'c']);
  });
  it('BL-022 湯の華の木: 知っている ID だけを定義の順に残し、前提を満たさないノードは捨てる。使った分はコストの合計に直す。合計が累計を超えたら木を空にする', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { meta: Record<string, unknown> & { yunohana: Record<string, unknown> } };
    g.meta.perks = ['nightDig', 'sharpBlade', 'grip', 'famousSpring', 'sharpBlade', 'travelFunds'];
    g.meta.yunohana = { lifetime: '1e2', spent: '7e0' };
    const r = parseGame(g);
    expect(r.ok && r.state.meta.perks).toEqual(['sharpBlade', 'nightDig', 'travelFunds']); // famousSpring は前提（大工の顔なじみ）なし
    expect(r.ok && r.state.meta.yunohana.spent.toNumber()).toBe(18);
    expect(r.ok && r.corrected).toEqual(expect.arrayContaining(['meta.perks', 'meta.yunohana.spent']));
    g.meta.yunohana = { lifetime: '1e1', spent: '1.8e1' };
    const poor = parseGame(g);
    expect(poor.ok && [poor.state.meta.perks, poor.state.meta.yunohana.spent.toNumber()]).toEqual([[], 0]);
  });
  it('TS-026-11・TS-018-14: 改良は知らない ID（後半の grip・prototype の名前）を捨て、知っている ID は重複を 1 つにして順番を保つ。解放の条件を満たしていない購入済みの ID も残す（Q-39 (a)）', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { run: Record<string, unknown> };
    g.run.upgrades = ['noren', 'polisher', 'noren', 'grip', '__proto__', 'constructor', 'sieve'];
    const r = parseGame(g);
    expect(r.ok && r.state.run.upgrades).toEqual(['noren', 'polisher', 'sieve']);
    expect(r.ok && r.corrected).toContain('run.upgrades');
  });
  it('知らないキーが 10 万個ある表（collection.ores・run.springs）も 1 秒以内', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { run: Record<string, unknown>; collection: Record<string, unknown> };
    const junk = Object.fromEntries(Array.from({ length: 100_000 }, (_, i) => [`k${i}`, 1]));
    g.collection.ores = { ...junk, quartz: 3 };
    g.run.springs = { ...junk, simple: { pump: 2 } };
    // 判定はこのスレッドの CPU 時間（BL-118。CPU が測れなければ実時間）
    const { value: r, timing: t } = measureOnce('S-5 10 万キーの表', () => parseGame(g));
    expect(t.ms, `${t.method} で判定`).toBeLessThan(1000);
    expect(r.ok && r.state.collection.ores).toEqual({ quartz: 3 });
    expect(r.ok && r.state.run.springs).toEqual({ simple: { pump: 2 } });
  });
});
