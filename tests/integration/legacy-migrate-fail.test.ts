// BL-115・PR #89 のレビュー S-1: 移行のコードが失敗した枠（migrateFailed。PR #87 のレビュー S-1 で「こちらの誤り。直したビルドで
// 読めるよう上書きしない」と決めた枠）がどちらかの保存先にあれば、moveLegacySlots は何も変えない。
// 移行の関数の誤りを模すため、版 1 の移行だけを失敗させる（tests/unit/save-migrate-fail.test.ts と同じ形）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyGrant, createInitialState } from '../../src/core/index.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { moveLegacySlots } from '../../src/save/legacy.ts';
import { SAVE_KEYS } from '../../src/save/slots.ts';

vi.mock('../../src/save/migrate.ts', async (orig) => {
  const actual = await orig<typeof import('../../src/save/migrate.ts')>();
  return {
    ...actual,
    migrateGame: (g: Record<string, unknown>) => (actual.gameSchemaOf(g) === 1 ? null : actual.migrateGame(g)),
  };
});

const fixture = (v: string, k: string): string => readFileSync(join('tests', 'fixtures', 'saves', v, `${k}.json`), 'utf8').trim();

class MapStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  readonly kind: 'local' | 'sdk';
  constructor(kind: 'local' | 'sdk') {
    this.kind = kind;
  }
  get(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  set(k: string, v: string): boolean {
    this.map.set(k, v);
    return true;
  }
  remove(k: string): void {
    this.map.delete(k);
  }
}

/** 今の版の有効なセーブ（seq を大きくして、比べれば必ず勝つ） */
function valid(seq: number): string {
  const s = createInitialState(3);
  applyGrant(s, { coins: '42' });
  return encodeSave(s, seq, 9_000_000_000_000, '0.0.1');
}

describe('BL-115 移行の失敗の枠があれば何も変えない（PR #89 のレビュー S-1）', () => {
  it('見本の版 1 は、この移行の誤りの下で migrateFailed になる（前提）', () => {
    expect(decodeSave(fixture('v1', 'early'))).toEqual({ ok: false, reason: 'migrateFailed' });
    expect(decodeSave(valid(999)).ok).toBe(true);
  });

  for (const side of ['to', 'from'] as const) {
    it(`${side === 'to' ? '今の保存先（data モジュール）' : '以前の保存先（localStorage）'}に移行の失敗の枠がある: どちらの枠も上書き・削除しない（held）`, () => {
      const from = new MapStore('local');
      const to = new MapStore('sdk');
      const failed = fixture('v1', 'early');
      if (side === 'to') {
        to.map.set(SAVE_KEYS.a, failed);
        from.map.set(SAVE_KEYS.a, valid(999));
        from.map.set(SAVE_KEYS.b, valid(998));
      } else {
        from.map.set(SAVE_KEYS.a, failed);
        to.map.set(SAVE_KEYS.b, valid(5));
      }
      const fromBefore = new Map(from.map);
      const toBefore = new Map(to.map);
      expect(moveLegacySlots(from, to)).toBe('held');
      expect(to.map, '今の保存先はそのまま（退避のキーも増えない）').toEqual(toBefore);
      expect(from.map, '以前の保存先もそのまま').toEqual(fromBefore);
    });
  }
});
