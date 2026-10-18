// BL-021: セーブの版 1 → 2 の移行（meta.lastPrestigeGain を足す。src/save/migrate.ts）。
// v1 のセーブは「今の版で書いたものから lastPrestigeGain を消し、schema を 1 にして checksum を付け直したもの」で作る
// （v1 のコードが書く形と同じ: v1 と v2 の違いはこの 1 項目と schema だけ）
import fc from 'fast-check';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { checksumOf, dispatch, num, stateHash, toSaveGame, type GameState } from '../../src/core/index.ts';
import { decodeSave, encodeSave, importString } from '../../src/save/codec.ts';
import { gameSchemaOf, migrateGame } from '../../src/save/migrate.ts';
import { SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { gameStateArb } from '../arbitraries/state.ts';
import { fcRuns } from '../helpers/fc-runs.ts';
import { stateWith } from '../support/states.ts';

type Rec = Record<string, unknown>;
const APP = '0.0.1';

/** 状態から v1 の game（lastPrestigeGain なし・schema 1） */
function v1Game(s: GameState): Rec & { meta: Rec } {
  const g = JSON.parse(JSON.stringify(toSaveGame(s))) as Rec & { meta: Rec };
  delete g.meta.lastPrestigeGain;
  g.schema = 1;
  return g;
}
/** v1 の封筒の文字列（schema 1・checksum は v1 の game に付ける） */
function v1Envelope(s: GameState, seq = 3): string {
  const game = v1Game(s);
  return JSON.stringify({ schema: 1, seq, savedAt: 1_700_000_000_000, appVersion: '0.0.1-v1', checksum: checksumOf(game), game });
}

describe('BL-021 セーブの版 1 → 2 の移行', () => {
  it('今の版は 2', () => {
    expect(SAVE_SCHEMA_VERSION).toBe(2);
  });

  it('v1 のセーブを読める: lastPrestigeGain は 0、移行で足した値は「補正」に数えない。ほかの値は同じ', () => {
    const s = stateWith({ depth: 220, coins: 12345 });
    s.meta.prestiges = 3;
    s.meta.yunohana.lifetime = num(57);
    const r = decodeSave(v1Envelope(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toEqual([]);
    expect(r.state.schema).toBe(2);
    expect(r.state.meta.lastPrestigeGain.toNumber()).toBe(0);
    expect(r.state.meta.prestiges).toBe(3);
    expect(r.state.meta.yunohana.lifetime.toNumber()).toBe(57);
    expect(stateHash(r.state)).toBe(stateHash(s)); // s の lastPrestigeGain は初期値 0
  });

  it('v1 を読んで保存し直すと、schema 2 で lastPrestigeGain が入る（次の読み込みも同じ）', () => {
    const r = decodeSave(v1Envelope(stateWith({ depth: 160 })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = encodeSave(r.state, 4, 1, APP);
    const env = JSON.parse(raw) as { schema: number; game: { schema: number; meta: Rec } };
    expect([env.schema, env.game.schema, env.game.meta.lastPrestigeGain]).toEqual([2, 2, toSaveGame(r.state).meta.lastPrestigeGain]);
    const again = decodeSave(raw);
    expect(again.ok && stateHash(again.state)).toBe(stateHash(r.state));
  });

  it('v1 の書き出し文字列も読める（移行してから検証）', () => {
    const g = v1Game(stateWith({ depth: 90, coins: 7 }));
    const str = `ODR1:${LZString.compressToEncodedURIComponent(JSON.stringify(g))}.${checksumOf(g)}`;
    const r = importString(str);
    expect(r.ok).toBe(true);
    expect(r.ok && r.corrected).toEqual([]);
    expect(r.ok && r.state.meta.lastPrestigeGain.toNumber()).toBe(0);
  });

  it('v2 のセーブは lastPrestigeGain を保つ（転生した後の値）', () => {
    const s = stateWith({ depth: 400 });
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.meta.lastPrestigeGain.toNumber()).toBe(64);
    const r = decodeSave(encodeSave(s, 1, 1, APP));
    expect(r.ok && r.state.meta.lastPrestigeGain.toNumber()).toBe(64);
    expect(r.ok && r.corrected).toEqual([]);
  });

  it('v2 の lastPrestigeGain が壊れていたら 0 に補正する（補正として数える）', () => {
    for (const bad of ['abc', -5, null, { x: 1 }]) {
      const g = toSaveGame(stateWith({})) as unknown as Rec & { meta: Rec };
      g.meta.lastPrestigeGain = bad;
      const raw = JSON.stringify({ schema: 2, seq: 1, savedAt: 1, appVersion: APP, checksum: checksumOf(g), game: g });
      const r = decodeSave(raw);
      expect(r.ok, JSON.stringify(bad)).toBe(true);
      expect(r.ok && r.state.meta.lastPrestigeGain.toNumber(), JSON.stringify(bad)).toBe(0);
      expect(r.ok && r.corrected, JSON.stringify(bad)).toContain('meta.lastPrestigeGain');
    }
  });

  it('任意の状態（fast-check）: v1 に戻して読むと、lastPrestigeGain が 0 になるだけで、ほかは同じ', () => {
    fc.assert(
      fc.property(gameStateArb, (s) => {
        s.meta.lastPrestigeGain = num(0);
        const r = decodeSave(v1Envelope(s, 1));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.state.meta.lastPrestigeGain.toNumber()).toBe(0);
        expect(toSaveGame(r.state)).toEqual(toSaveGame(decodeSaveOk(encodeSave(s, 1, 1, APP))));
      }),
      fcRuns(100),
    );
  });

  it('migrateGame: 入力を書き換えない。今の版はそのまま。schema がない・読めないものは 1 とみなす', () => {
    const g = v1Game(stateWith({}));
    const before = JSON.stringify(g);
    const m = migrateGame(g);
    expect(JSON.stringify(g)).toBe(before);
    expect((m.meta as Rec).lastPrestigeGain).toBeDefined();
    expect(m.schema).toBe(2);
    const cur = toSaveGame(stateWith({})) as unknown as Rec;
    expect(migrateGame(cur)).toBe(cur);
    expect([gameSchemaOf({}), gameSchemaOf({ schema: 'x' }), gameSchemaOf({ schema: '2' }), gameSchemaOf({ schema: 0 })]).toEqual([1, 1, 2, 1]);
  });
});

function decodeSaveOk(raw: string): GameState {
  const r = decodeSave(raw);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
