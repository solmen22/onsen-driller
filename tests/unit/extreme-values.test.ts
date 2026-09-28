// レビュー S-4: レベルに上限がなく、大きな値で打数が Infinity・端数が NaN になり、以後の保存がすべて失敗していた件
// （arch §9「NaN・Infinity・負の値にならない」、QA の不変条件 #22）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import {
  autoDiggerHitsPerSec,
  buyQuote,
  canonicalJson,
  createInitialState,
  dispatch,
  num,
  stateHash,
  step,
  toSaveGame,
  type GameState,
} from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { parseGame } from '../../src/save/schema.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { stateWith } from '../support/states.ts';

const LEVEL_MAX = PARAMS.levelMax;
const APP = '0.0.1';

/** 保存する形の数値がすべて有限で、回数が安全な整数か */
function allFinite(v: unknown, path = ''): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => allFinite(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => allFinite(x, path ? `${path}.${k}` : k));
  return [];
}

describe('自動掘削機の打数/秒は有限（上限 maxHitsPerSec）', () => {
  it('Lv 25,574・25,600（2^floor(Lv/25) が Infinity）・30,000・上限・安全な整数の上限', () => {
    for (const lv of [25_574, 25_600, 30_000, LEVEL_MAX, Number.MAX_SAFE_INTEGER]) {
      const s = stateWith({ digger: 1 });
      s.run.autoDig.level = lv;
      const h = autoDiggerHitsPerSec(s);
      expect(Number.isFinite(h), String(lv)).toBe(true);
      expect(h).toBeLessThanOrEqual(PARAMS.autoDigger.maxHitsPerSec);
      expect(h).toBeGreaterThan(0);
    }
    const s = stateWith({ digger: 100 });
    expect(autoDiggerHitsPerSec(s)).toBeCloseTo(0.2 * 100 * 2 ** 4, 9); // ふだんの値は変わらない
  });
});

describe('レビューの再現 ①: 自動掘削機 Lv30000 で 1 ステップ → 打数・端数が有限で、保存できる', () => {
  it('stats.hits は安全な整数、diggerCarry は 0 以上 1 未満、canonicalJson・encodeSave が例外を投げず、読み戻せる', () => {
    const s = stateWith({ digger: 1, depth: 40 });
    s.run.autoDig.level = 30_000;
    step(s, 100);
    expect(Number.isSafeInteger(s.stats.hits)).toBe(true);
    expect(s.run.diggerCarry >= 0 && s.run.diggerCarry < 1).toBe(true);
    expect(() => canonicalJson(toSaveGame(s))).not.toThrow();
    const r = decodeSave(encodeSave(s, 1, 1, APP));
    expect(r.ok && r.corrected).toEqual([]);
  });
  it('回数（打数・壊したブロック・タップ・鉱石）は安全な整数の上限で止まる', () => {
    const s = stateWith({ digger: 1, depth: 40 });
    s.run.autoDig.level = LEVEL_MAX;
    s.stats.hits = Number.MAX_SAFE_INTEGER - 1;
    s.stats.blocks = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 5; i++) step(s, 100);
    expect(s.stats.hits).toBe(Number.MAX_SAFE_INTEGER);
    expect(s.stats.blocks).toBe(Number.MAX_SAFE_INTEGER);
    expect(allFinite(toSaveGame(s))).toEqual([]);
  });
});

describe('レビューの再現 ②: 読み込みでレベルを上限に補正する', () => {
  it('ドリル・自動掘削機・湯船・ポンプの Lv 1e9 → PARAMS.levelMax（corrected に入る）', () => {
    const g = toSaveGame(stateWith({ pumps: { simple: 1 } })) as unknown as { run: Record<string, unknown> };
    g.run.drill = { level: 1e9, tool: 0 };
    g.run.autoDig = { level: 1e9, on: false };
    g.run.bath = { level: 1e9, slots: [] };
    g.run.springs = { simple: { pump: 1e9 } };
    const r = parseGame(g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.state.run.drill.level, r.state.run.autoDig.level, r.state.run.bath.level, r.state.run.springs.simple?.pump]).toEqual([
      LEVEL_MAX,
      LEVEL_MAX,
      LEVEL_MAX,
      LEVEL_MAX,
    ]);
    expect(r.corrected).toEqual(expect.arrayContaining(['run.drill.level', 'run.autoDig.level', 'run.bath.level', 'run.springs.simple.pump']));
  });
});

describe('購入はレベルの上限で止まる（maxed）', () => {
  it('上限の 3 つ手前: ×1 は 1、×10・最大は 3 個まで。上限では maxed で buy も maxed', () => {
    const s = stateWith({ coins: '1e300000' });
    s.run.drill.level = LEVEL_MAX - 3;
    expect(buyQuote(s, 'drill', 1)).toMatchObject({ n: 1, state: 'affordable' });
    expect(buyQuote(s, 'drill', 10)).toMatchObject({ n: 3, state: 'affordable' });
    expect(buyQuote(s, 'drill', 'max')).toMatchObject({ n: 3, state: 'affordable' });
    expect(dispatch(s, { type: 'buy', item: 'drill', qty: 'max' }).ok).toBe(true);
    expect(s.run.drill.level).toBe(LEVEL_MAX);
    expect(buyQuote(s, 'drill', 1)).toMatchObject({ n: 0, state: 'maxed' });
    const before = stateHash(s);
    expect(dispatch(s, { type: 'buy', item: 'drill', qty: 1 })).toMatchObject({ ok: false, reason: 'maxed' });
    expect(stateHash(s)).toBe(before);
  });
});

describe('property: 極端なレベルを含む任意の状態で、ステップの後も保存でき、数値が有限（不変条件 #22）', () => {
  it('step(100ms) を 3 回 → 数値がすべて有限・保存して読み戻すと同じ（補正なし）', () => {
    fc.assert(
      fc.property(gameStateArb, (s0: GameState) => {
        const s = s0;
        for (let i = 0; i < 3; i++) step(s, 100);
        expect(allFinite(toSaveGame(s))).toEqual([]);
        expect(s.run.coins.eq(num(s.run.coins))).toBe(true);
        const r = decodeSave(encodeSave(s, 1, 1, APP));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.corrected).toEqual([]);
        expect(stateHash(r.state)).toBe(stateHash(s));
      }),
      { numRuns: 60, seed: 2604 },
    );
  });
  it('新しいゲームの基本の値も変わらない（上限の追加で序盤に影響しない）', () => {
    expect(buyQuote(createInitialState(1), 'drill', 1).nextCost.eq(PARAMS.drill.c0)).toBe(true);
  });
});
