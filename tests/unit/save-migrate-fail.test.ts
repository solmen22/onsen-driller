// BL-028・PR #87 のレビュー S-1: 移行のコードが失敗したら（データの破損ではなく、こちらの誤り）、その枠は壊れたものとして扱わず、
// newer と同じく読み取り専用で起動する（新しいゲームで上書きしない）。移行の関数の誤りを模すため、版 1 の移行だけを失敗させる
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '../../src/core/index.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { decodeSave, importString } from '../../src/save/codec.ts';
import { BROKEN_KEY, SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
import LZString from 'lz-string';

vi.mock('../../src/save/migrate.ts', async (orig) => {
  const actual = await orig<typeof import('../../src/save/migrate.ts')>();
  return {
    ...actual,
    // 版 1 からの移行が（コードの誤りで）失敗する、を模す。今の版はそのまま
    migrateGame: (g: Record<string, unknown>) => (actual.gameSchemaOf(g) === 1 ? null : actual.migrateGame(g)),
  };
});

const fixture = (v: string, k: string): string => readFileSync(join('tests', 'fixtures', 'saves', v, `${k}.json`), 'utf8').trim();

class CountingStore implements KeyValueStore {
  readonly kind = 'local' as const;
  readonly map = new Map<string, string>();
  sets = 0;
  removes = 0;
  get(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  set(k: string, v: string): boolean {
    this.sets++;
    this.map.set(k, v);
    return true;
  }
  remove(k: string): void {
    this.removes++;
    this.map.delete(k);
  }
}

describe('BL-028 移行の失敗は読み取り専用（PR #87 のレビュー S-1）', () => {
  it('decodeSave は migrateFailed（invalidGame ではない）', () => {
    expect(decodeSave(fixture('v1', 'early'))).toEqual({ ok: false, reason: 'migrateFailed' });
    expect(decodeSave(fixture('v2', 'early')).ok).toBe(true); // 今の版は移行しないので読める
  });

  it('2 枠とも移行に落ちた: 読み取り専用で新しいゲーム。退避もせず、そのセッションの書き込みは 0（直したビルドで読めるように残す）', () => {
    const st = new CountingStore();
    const a = fixture('v1', 'pre-prestige');
    const b = fixture('v1', 'post-prestige');
    st.map.set(SAVE_KEYS.a, a);
    st.map.set(SAVE_KEYS.b, b);
    const slots = new SaveSlots(st, { appVersion: 'x', now: () => 1 });
    const loaded = slots.load();
    expect([loaded.state, loaded.readOnly, loaded.brokenReset, loaded.slots]).toEqual([null, true, false, { a: 'migrateFailed', b: 'migrateFailed' }]);
    // 新しいゲームで遊んで保存しようとしても書かない
    const fresh = decodeSaveState(fixture('v2', 'early'));
    for (let i = 0; i < 3; i++) expect(slots.save(fresh)).toBe(false);
    expect([st.sets, st.removes, st.map.has(BROKEN_KEY)]).toEqual([0, 0, false]);
    expect([st.map.get(SAVE_KEYS.a), st.map.get(SAVE_KEYS.b)]).toEqual([a, b]);
  });

  it('片方だけ落ちた（もう一方は今の版）: 今の版の枠から始めるが、読み取り専用（落ちた枠を次の保存で上書きしない）', () => {
    const st = new CountingStore();
    const old = fixture('v1', 'post-prestige');
    st.map.set(SAVE_KEYS.a, old);
    st.map.set(SAVE_KEYS.b, fixture('v2', 'early'));
    const slots = new SaveSlots(st, { appVersion: 'x', now: () => 1 });
    const loaded = slots.load();
    expect([loaded.readOnly, loaded.from, loaded.slots.a]).toEqual([true, 'b', 'migrateFailed']);
    expect(slots.save(loaded.state!)).toBe(false);
    expect([st.sets, st.map.get(SAVE_KEYS.a)]).toEqual([0, old]);
  });

  it('書き出しの文字列も migrateFailed（今のセーブを上書きしない）', () => {
    const env = JSON.parse(fixture('v1', 'early')) as { checksum: string; game: unknown };
    const str = `ODR1:${LZString.compressToEncodedURIComponent(JSON.stringify(env.game))}.${env.checksum}`;
    expect(importString(str)).toEqual({ ok: false, reason: 'migrateFailed' });
  });
});

function decodeSaveState(raw: string): GameState {
  const r = decodeSave(raw);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}
