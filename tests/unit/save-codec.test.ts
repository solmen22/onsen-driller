// BL-026: セーブの codec とスキーマ v1（TS-026-01〜18。Q-10）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  advance,
  applyGrant,
  createInitialState,
  dispatch,
  num,
  NUM_MAX,
  stateHash,
  toSaveGame,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave, exportString, importString, parseGameForHook } from '../../src/save/codec.ts';
import { parseGame, SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { gameStateArb } from '../arbitraries/state.ts';
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
      { numRuns: 200, seed: 2601 },
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
  it('キーは 6 つ、schema 1・savedAt は注入した時刻・appVersion は版', () => {
    const e = envOf(createInitialState(1), 7, 1_234_567);
    expect(Object.keys(e).sort()).toEqual(['appVersion', 'checksum', 'game', 'savedAt', 'schema', 'seq']);
    expect([e.schema, e.seq, e.savedAt, e.appVersion]).toEqual([1, 7, 1_234_567, APP]);
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
  it('schema がない・0 は shape、"1" は 1 として読む、2（新しい版）は newer', () => {
    const withSchema = (schema: unknown): ReturnType<typeof decodeSave> => {
      const e = envOf(createInitialState(1)) as Env & { schema?: unknown };
      if (schema === undefined) delete e.schema;
      else e.schema = schema;
      return decodeSave(JSON.stringify(e));
    };
    expect(withSchema(undefined)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema(0)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema(1.5)).toEqual({ ok: false, reason: 'shape' });
    expect(withSchema('1').ok).toBe(true);
    expect(withSchema(2)).toEqual({ ok: false, reason: 'newer' });
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

describe('レビュー M-1: 新しい版（schema 2）は封筒の形・checksum より先に newer と判定する', () => {
  /** schema 2 の封筒（今の版の書き方で作ってから schema だけ変える） */
  const newerEnv = (): Env => {
    const e = envOf(stateWith({ coins: 50, depth: 20 }), 9);
    e.schema = 2;
    return e;
  };
  it('checksum が違う・seq がない・キーを足した／消した・game が文字列・seq が文字列 → どれも newer', () => {
    const variants: [string, (e: Env & Record<string, unknown>) => void][] = [
      ['checksum が違う', (e) => (e.checksum = 'ffffffff')],
      ['checksum の計算が変わった（別の形式）', (e) => (e.checksum = 'sha256:abcdef')],
      ['seq がない', (e) => delete e.seq],
      ['seq が文字列', (e) => (e.seq = '9')],
      ['封筒のキーを足した', (e) => (e.compression = 'none')],
      ['savedAt・appVersion・checksum・game がない', (e) => ['savedAt', 'appVersion', 'checksum', 'game'].forEach((k) => delete e[k])],
      ['game が文字列（二重に包む形式）', (e) => ((e as { game: unknown }).game = '{"run":{}}')],
      ['schema が文字列の "2"', (e) => (e.schema = '2')],
    ];
    for (const [name, change] of variants) {
      const e = newerEnv() as Env & Record<string, unknown>;
      change(e);
      expect(decodeSave(JSON.stringify(e)), name).toEqual({ ok: false, reason: 'newer' });
    }
    expect(decodeSave('{"schema":2}')).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave('{"schema":3,"envelope":{"v":1}}')).toEqual({ ok: false, reason: 'newer' });
  });
  it('JSON として読めない（途中で切れた）・大きすぎる・深すぎる文字列でも、先頭が "schema":2 なら newer', () => {
    const raw = JSON.stringify(newerEnv());
    expect(decodeSave(raw.slice(0, raw.length / 2))).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave('{"schema":2')).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave(`{"schema":2,"pad":"${'x'.repeat(1_100_000)}"}`)).toEqual({ ok: false, reason: 'newer' });
    expect(decodeSave(`{"schema":2,"deep":${'['.repeat(100)}${']'.repeat(100)}}`)).toEqual({ ok: false, reason: 'newer' });
  });
  it('今の版（schema 1）の壊れた封筒は今までどおり（newer にしない）', () => {
    const raw = encodeSave(stateWith({ coins: 50 }), 1, 1, APP);
    expect(decodeSave(raw.slice(0, raw.length / 2))).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave(raw.replace(/"checksum":"[0-9a-f]{8}"/, '"checksum":"00000000"'))).toEqual({ ok: false, reason: 'checksum' });
    const e = envOf(createInitialState(1)) as Env & { seq?: unknown };
    delete e.seq;
    expect(decodeSave(JSON.stringify(e))).toEqual({ ok: false, reason: 'shape' });
    // 先頭のキーが schema でない・schema が 1 の途中切れは notJson のまま
    expect(decodeSave('{"seq":1,"schema":2')).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave('{"schema":1,"seq":')).toEqual({ ok: false, reason: 'notJson' });
    expect(decodeSave(`{"schema":1,"pad":"${'x'.repeat(1_100_000)}"}`)).toEqual({ ok: false, reason: 'tooLarge' });
  });
});

describe('TS-026-14 巨大・深すぎる入力で落ちず、すぐ拒否する', () => {
  it('5MB の文字列 → tooLarge、深さ 10,000 の入れ子 → shape、どちらも 1 秒以内', () => {
    const t0 = performance.now();
    expect(decodeSave('x'.repeat(5_000_000))).toEqual({ ok: false, reason: 'tooLarge' });
    expect(decodeSave(`${'['.repeat(10_000)}${']'.repeat(10_000)}`)).toEqual({ ok: false, reason: 'shape' });
    const deep = `{"schema":1,"seq":1,"savedAt":0,"appVersion":"x","checksum":"00000000","game":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}}`;
    expect(decodeSave(deep)).toEqual({ ok: false, reason: 'shape' });
    expect(performance.now() - t0).toBeLessThan(1000);
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
  it('save/schema.ts が 1 を公開し、新しいゲームは補正なしで通る', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(1);
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

describe('書き出し文字列（S3 の BL-029 の土台）', () => {
  it('往復し、壊れた・途中で切れた・別のゲームの・空の文字列は null', () => {
    const s = stateWith({ coins: 777, depth: 50 });
    const str = exportString(s);
    expect(str.startsWith('ODR1:')).toBe(true);
    const back = importString(str);
    expect(back && stateHash(back)).toBe(stateHash(s));
    for (const bad of ['', 'ODR1:', str.slice(0, -3), str.replace('ODR1:', 'XYZ1:'), `${str.slice(0, 20)}A${str.slice(21)}`]) expect(importString(bad)).toBeNull();
  });
});
