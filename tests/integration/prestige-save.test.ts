// BL-021: 転生の直後の保存（TS-021-24・25）と、版 1・版 2 が混ざった 2 枠（TS-021-29）。本物の SaveSlots・autosave と、偽のストレージ・偽のタイマー
import { describe, expect, it } from 'vitest';
import { saveReasonForEvents, startAutosave, type SaveReason } from '../../src/app/autosave.ts';
import { GameStore } from '../../src/app/store.ts';
import { checksumOf, toSaveGame, type GameState } from '../../src/core/index.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
import { SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { stateWith } from '../support/states.ts';

const APP = '0.0.1';

class FakeStore implements KeyValueStore {
  readonly kind = 'local' as const;
  readonly map = new Map<string, string>();
  setThrows = false;
  writes = 0;
  get(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  set(k: string, v: string): boolean {
    if (this.setThrows) throw new DOMException('quota', 'QuotaExceededError');
    this.writes++;
    this.map.set(k, v);
    return true;
  }
  remove(k: string): void {
    this.map.delete(k);
  }
}

type Env = { schema: number; seq: number; game: { schema: number; meta: Record<string, unknown> } };
const envOf = (st: FakeStore, slot: 'a' | 'b'): Env => JSON.parse(st.map.get(SAVE_KEYS[slot]) ?? 'null') as Env;

/** v1 の封筒（lastPrestigeGain なし・schema 1。v1 のコードが書く形） */
function v1Envelope(s: GameState, seq: number): string {
  const game = JSON.parse(JSON.stringify(toSaveGame(s))) as Record<string, unknown> & { meta: Record<string, unknown> };
  delete game.meta.lastPrestigeGain;
  game.schema = 1;
  return JSON.stringify({ schema: 1, seq, savedAt: 1_700_000_000_000, appVersion: '0.0.1-v1', checksum: checksumOf(game), game });
}

/** main.ts と同じ結線: ストアの出来事に PrestigeDone があれば saveNow('prestige') */
function rig(store: FakeStore, opts: { suppressed?: () => boolean } = {}) {
  const slots = new SaveSlots(store, { appVersion: APP, now: () => 1_700_000_000_000 });
  const loaded = slots.load();
  const game = new GameStore(loaded.state ?? stateWith({ depth: 160 }));
  const ticks: (() => void)[] = [];
  const reasons: [SaveReason, boolean][] = [];
  const auto = startAutosave({
    slots,
    getState: () => game.state,
    win: new EventTarget(),
    doc: new EventTarget(),
    timers: { setInterval: (fn) => (ticks.push(fn), ticks.length), clearInterval: () => undefined },
    isSuppressed: opts.suppressed,
    onSave: (r, ok) => reasons.push([r, ok]),
  });
  game.onEvents((evs) => {
    const r = saveReasonForEvents(evs);
    if (r) auto.saveNow(r);
  });
  return { slots, loaded, game, auto, reasons, tick: () => ticks.forEach((f) => f()) };
}

describe('TS-021-24 転生の直後に保存する（15 秒を待たない）', () => {
  it('PrestigeDone の直後に 1 回（理由 prestige・seq +1・もう一方の枠）。書いた中身は転生の後で、読み戻しの一致も通る', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, encodeSave(stateWith({ depth: 300 }), 5, 1, APP));
    const r = rig(st);
    expect(r.loaded.from).toBe('a');
    r.tick(); // 15 秒ごとの保存の直後でも
    expect(envOf(st, 'b').seq).toBe(6);
    st.writes = 0;
    expect(r.game.dispatch({ type: 'prestige' }).ok).toBe(true);
    expect(r.reasons.at(-1)).toEqual(['prestige', true]);
    expect(st.writes).toBe(1);
    const env = envOf(st, 'a');
    expect([env.schema, env.seq]).toEqual([SAVE_SCHEMA_VERSION, 7]);
    const back = decodeSave(st.map.get(SAVE_KEYS.a));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect([back.state.meta.prestiges, back.state.run.maxDepth, back.state.meta.yunohana.lifetime.toNumber()]).toEqual([1, 0, 36]);
    expect(back.state.meta.lastPrestigeGain.toNumber()).toBe(36);
    expect(back.state.meta.tickets).toBe(r.game.state.meta.tickets);
    expect(r.slots.status).toBe('ok');
    r.auto.dispose();
  });

  it('転生できない（locked）ときは保存しない', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, encodeSave(stateWith({ depth: 149 }), 1, 1, APP));
    const r = rig(st);
    st.writes = 0;
    expect(r.game.dispatch({ type: 'prestige' }).ok).toBe(false);
    expect(st.writes).toBe(0);
    r.auto.dispose();
  });
});

describe('TS-021-25 保存しない・できないときも転生は止まらない・二重にならない', () => {
  it('(a)(c) 録画モード・デモ（isSuppressed）: ストレージに書かない。転生はメモリの中で 1 回', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, encodeSave(stateWith({ depth: 200 }), 1, 1, APP));
    const r = rig(st, { suppressed: () => true });
    const before = st.map.get(SAVE_KEYS.a);
    expect(r.game.dispatch({ type: 'prestige' }).ok).toBe(true);
    expect([st.writes, st.map.get(SAVE_KEYS.a), st.map.has(SAVE_KEYS.b)]).toEqual([0, before, false]);
    expect(r.game.state.meta.prestiges).toBe(1);
    r.auto.dispose();
  });

  it('(b) 読み取り専用のセッション（もう一方の枠が新しい版）: 書かない。転生はメモリの中で 1 回', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, encodeSave(stateWith({ depth: 200 }), 1, 1, APP));
    const newer = JSON.parse(encodeSave(stateWith({ depth: 10 }), 2, 1, APP)) as Record<string, unknown>;
    st.map.set(SAVE_KEYS.b, JSON.stringify({ ...newer, schema: SAVE_SCHEMA_VERSION + 1 }));
    const r = rig(st);
    expect(r.slots.readOnly).toBe(true);
    expect(r.game.dispatch({ type: 'prestige' }).ok).toBe(true);
    expect(r.reasons).toEqual([['prestige', false]]);
    expect(st.writes).toBe(0);
    expect(r.game.state.meta.prestiges).toBe(1);
    r.auto.dispose();
  });

  it('(d) 書き込みが失敗する: 転生はメモリの中で終わり、状態は failing。15 秒ごとにやり直し、直ったら転生の後の状態を書く', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, encodeSave(stateWith({ depth: 200 }), 1, 1, APP));
    const r = rig(st);
    st.setThrows = true;
    expect(r.game.dispatch({ type: 'prestige' }).ok).toBe(true);
    expect(r.reasons).toEqual([['prestige', false]]);
    expect(r.slots.status).toBe('failing');
    expect(r.game.state.meta.prestiges).toBe(1);
    r.tick();
    expect(r.slots.status).toBe('failing');
    st.setThrows = false;
    r.tick();
    expect(r.slots.status).toBe('ok');
    const back = decodeSave(st.map.get(SAVE_KEYS.b));
    expect(back.ok && back.state.meta.prestiges).toBe(1);
    r.auto.dispose();
  });
});

describe('TS-021-29 版 1 と版 2 が混ざった 2 枠', () => {
  it('(a) a＝版 1 seq 10、b＝版 2 seq 11 → b を使う', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, v1Envelope(stateWith({ depth: 100 }), 10));
    st.map.set(SAVE_KEYS.b, encodeSave(stateWith({ depth: 120 }), 11, 1, APP));
    const r = rig(st);
    expect([r.loaded.from, r.loaded.state?.run.depth]).toEqual(['b', 120]);
    r.auto.dispose();
  });

  it('(b) a＝版 2 seq 11（checksum 不一致）、b＝版 1 seq 10 → b を移行して使う（a は使わない）。次は壊れていた a に版 2 で書く', () => {
    const st = new FakeStore();
    const bad = JSON.parse(encodeSave(stateWith({ depth: 130 }), 11, 1, APP)) as Record<string, unknown>;
    st.map.set(SAVE_KEYS.a, JSON.stringify({ ...bad, checksum: '00000000' }));
    st.map.set(SAVE_KEYS.b, v1Envelope(stateWith({ depth: 90 }), 10));
    const r = rig(st);
    expect([r.loaded.from, r.loaded.state?.run.depth, r.loaded.slots.a]).toEqual(['b', 90, 'checksum']);
    expect(r.loaded.state?.meta.lastPrestigeGain.toNumber()).toBe(0);
    r.tick();
    expect([envOf(st, 'a').schema, envOf(st, 'a').seq]).toEqual([SAVE_SCHEMA_VERSION, 11]);
    expect(envOf(st, 'b').schema).toBe(1); // 直前のセーブ（版 1）は残る
    r.auto.dispose();
  });

  it('(c) 両方とも版 1 → seq の大きいほうを移行して使い、次の保存はもう一方の枠に版 2 で書く（版 1 の控えが 1 つ残る）', () => {
    const st = new FakeStore();
    st.map.set(SAVE_KEYS.a, v1Envelope(stateWith({ depth: 60 }), 4));
    st.map.set(SAVE_KEYS.b, v1Envelope(stateWith({ depth: 70 }), 5));
    const r = rig(st);
    expect([r.loaded.from, r.loaded.state?.run.depth, r.loaded.corrected]).toEqual(['b', 70, []]);
    r.tick();
    const a = envOf(st, 'a');
    expect([a.schema, a.game.schema, a.seq, typeof a.game.meta.lastPrestigeGain]).toEqual([SAVE_SCHEMA_VERSION, SAVE_SCHEMA_VERSION, 6, 'string']);
    expect(envOf(st, 'b').schema).toBe(1);
    // 転生した後の版 2 のセーブを読み直すと、前回の獲得が残る
    r.game.state.run.maxDepth = 300;
    r.game.dispatch({ type: 'prestige' });
    const back = decodeSave(st.map.get(SAVE_KEYS.b));
    expect(back.ok && back.state.meta.lastPrestigeGain.toNumber()).toBe(36);
    r.auto.dispose();
  });
});
