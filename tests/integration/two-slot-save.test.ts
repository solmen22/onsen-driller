// BL-027: 2 枠保存・保存先・保存の契機・設定（TS-027-01〜21。Q-11・Q-21）。偽のストレージと偽のタイマーで確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutosave, type Autosave } from '../../src/app/autosave.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from '../../src/app/settings.ts';
import { applyGrant, createInitialState, stateHash, type GameState } from '../../src/core/index.ts';
import { localStore } from '../../src/platform/storage.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { BROKEN_KEY, SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';

const APP = '0.0.1';

/** Map を持つ偽のストレージ。呼び出しを記録し、失敗を差し込める */
class FakeStore implements KeyValueStore {
  readonly kind = 'local' as const;
  readonly map = new Map<string, string>();
  readonly calls: { op: 'get' | 'set' | 'remove'; key: string }[] = [];
  getThrows = false;
  setThrows = false;
  removeThrows = false;
  /** set は成功するが、次の get でこの関数の値を返す（読み戻しの不一致） */
  corruptRead: ((v: string) => string) | null = null;
  get(k: string): string | null {
    this.calls.push({ op: 'get', key: k });
    if (this.getThrows) throw new DOMException('insecure', 'SecurityError');
    const v = this.map.get(k) ?? null;
    return v !== null && this.corruptRead ? this.corruptRead(v) : v;
  }
  set(k: string, v: string): boolean {
    this.calls.push({ op: 'set', key: k });
    if (this.setThrows) throw new DOMException('quota', 'QuotaExceededError');
    this.map.set(k, v);
    return true;
  }
  remove(k: string): void {
    this.calls.push({ op: 'remove', key: k });
    if (this.removeThrows) throw new DOMException('insecure', 'SecurityError');
    this.map.delete(k);
  }
  sets(): string[] {
    return this.calls.filter((c) => c.op === 'set').map((c) => c.key);
  }
}

let now = 1_700_000_000_000;
const slotsFor = (store: KeyValueStore, unavailable = false): SaveSlots => new SaveSlots(store, { appVersion: APP, now: () => now, unavailable });
const env = (store: FakeStore, slot: 'a' | 'b'): { seq: number; savedAt: number; game: unknown } => JSON.parse(store.map.get(SAVE_KEYS[slot]) ?? 'null') as never;
const stateAt = (depth: number): GameState => {
  const s = createInitialState(1);
  applyGrant(s, { depth, coins: String(depth * 10) });
  return s;
};
/** 枠に封筒を直接置く */
const put = (store: FakeStore, slot: 'a' | 'b', s: GameState, seq: number, savedAt = now): void => {
  store.map.set(SAVE_KEYS[slot], encodeSave(s, seq, savedAt, APP));
};

beforeEach(() => {
  now = 1_700_000_000_000;
});

describe('TS-027-01 空のストレージから交互に書く（a・seq 1 → b・2 → a・3）', () => {
  it('3 回保存', () => {
    const store = new FakeStore();
    const slots = slotsFor(store);
    expect(slots.load().state).toBeNull();
    for (let i = 0; i < 3; i++) expect(slots.save(stateAt(i + 1))).toBe(true);
    expect(store.sets()).toEqual([SAVE_KEYS.a, SAVE_KEYS.b, SAVE_KEYS.a]);
    expect([env(store, 'a').seq, env(store, 'b').seq]).toEqual([3, 2]);
    expect(slots.status).toBe('ok');
  });
});

describe('TS-027-03 書いた直後の読み戻しが合わない → 正は元の枠、次も同じ枠に同じ seq でやり直す（Q-11）', () => {
  it('a（seq 4）・b（seq 3）→ b に書いたが途中切れで読み戻る', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(40), 4);
    put(store, 'b', stateAt(30), 3);
    const slots = slotsFor(store);
    expect(slots.load().from).toBe('a');
    const aBefore = store.map.get(SAVE_KEYS.a);
    store.corruptRead = (v) => v.slice(0, v.length / 2);
    expect(slots.save(stateAt(50))).toBe(false);
    expect(slots.status).toBe('failing');
    expect(slots.nextTarget()).toEqual({ slot: 'b', seq: 5 });
    expect(slots.save(stateAt(51))).toBe(false);
    expect(store.map.get(SAVE_KEYS.a)).toBe(aBefore); // ただ 1 つの有効な控えを上書きしない
    expect(store.sets()).toEqual([SAVE_KEYS.b, SAVE_KEYS.b]);
    store.corruptRead = null;
    expect(slots.save(stateAt(52))).toBe(true); // 直ったら ok に戻る
    expect(slots.status).toBe('ok');
    expect(env(store, 'b').seq).toBe(5);
    expect(slots.nextTarget()).toEqual({ slot: 'a', seq: 6 });
  });
});

describe('TS-027-04・07・08 起動時の枠の選び方', () => {
  it('seq の大きいほう（a5・b4 → a、a4・b5 → b）', () => {
    for (const [sa, sb, want] of [
      [5, 4, 'a'],
      [4, 5, 'b'],
    ] as const) {
      const store = new FakeStore();
      put(store, 'a', stateAt(10), sa);
      put(store, 'b', stateAt(20), sb);
      const r = slotsFor(store).load();
      expect(r.from).toBe(want);
      expect(r.state?.run.depth).toBe(want === 'a' ? 10 : 20);
    }
  });
  it('a だけ → a から復元。どちらもない → 新しいゲーム（null）', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(12), 1);
    expect(slotsFor(store).load()).toMatchObject({ from: 'a', slots: { a: 'ok', b: 'empty' } });
    expect(slotsFor(new FakeStore()).load()).toMatchObject({ state: null, from: null, brokenReset: false });
  });
  it('seq が同じ → savedAt の新しいほう、それも同じなら a', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(1), 7, 100);
    put(store, 'b', stateAt(2), 7, 200);
    expect(slotsFor(store).load().from).toBe('b');
    put(store, 'b', stateAt(2), 7, 100);
    expect(slotsFor(store).load().from).toBe('a');
  });
});

describe('TS-027-05 seq の大きいほうの枠が壊れている（4 通り）→ もう一方から復元し、次は壊れた枠に書く', () => {
  const breakers: [string, (raw: string) => string][] = [
    ['checksum 不一致', (raw) => raw.replace(/"coins":"[^"]*"/, '"coins":"9e9"')],
    ['途中切れ', (raw) => raw.slice(0, raw.length - 10)],
    ['JSON でない', () => 'not json at all'],
    ['スキーマ違反（seq が負）', (raw) => raw.replace(/"seq":\d+/, '"seq":-1')],
  ];
  for (const [name, breakIt] of breakers) {
    it(name, () => {
      const store = new FakeStore();
      put(store, 'a', stateAt(30), 3);
      put(store, 'b', stateAt(40), 4);
      store.map.set(SAVE_KEYS.b, breakIt(store.map.get(SAVE_KEYS.b) ?? ''));
      const slots = slotsFor(store);
      const r = slots.load();
      expect(r.from).toBe('a');
      expect(r.state?.run.depth).toBe(30);
      expect(r.slots.b).not.toBe('ok');
      const aBefore = store.map.get(SAVE_KEYS.a);
      expect(slots.save(stateAt(31))).toBe(true);
      expect(store.sets()).toEqual([SAVE_KEYS.b]);
      expect(env(store, 'b').seq).toBe(4);
      expect(store.map.get(SAVE_KEYS.a)).toBe(aBefore);
    });
  }
});

describe('TS-027-06 両方の枠が壊れている → 例外なしで新しいゲーム、生の文字列を 1 つ save:broken に退避、a から書く（Q-11）', () => {
  it('seq の大きそうなほう（b）を退避', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(30), 3);
    put(store, 'b', stateAt(40), 4);
    const rawB = (store.map.get(SAVE_KEYS.b) ?? '').slice(0, 300);
    store.map.set(SAVE_KEYS.a, (store.map.get(SAVE_KEYS.a) ?? '').slice(0, 300));
    store.map.set(SAVE_KEYS.b, rawB);
    const slots = slotsFor(store);
    let r: ReturnType<SaveSlots['load']> | undefined;
    expect(() => (r = slots.load())).not.toThrow();
    expect(r).toMatchObject({ state: null, brokenReset: true, readOnly: false });
    expect(store.map.get(BROKEN_KEY)).toBe(rawB);
    expect(slots.nextTarget()).toEqual({ slot: 'a', seq: 1 });
    expect(slots.save(createInitialState(2))).toBe(true);
    expect(env(store, 'a').seq).toBe(1);
  });
  it('どちらも読めない（JSON でない）なら a を退避', () => {
    const store = new FakeStore();
    store.map.set(SAVE_KEYS.a, 'garbage-a');
    store.map.set(SAVE_KEYS.b, 'garbage-b');
    slotsFor(store).load();
    expect(store.map.get(BROKEN_KEY)).toBe('garbage-a');
  });
});

describe('新しい版のセーブ（schema 2）→ 読み取り専用（そのセッションは書かない）', () => {
  it('新しい版の枠は読まず、もう一方の有効な枠を使い、保存しない', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(10), 1);
    const newer = JSON.parse(encodeSave(stateAt(99), 2, now, APP)) as { schema: number };
    newer.schema = 2;
    store.map.set(SAVE_KEYS.b, JSON.stringify(newer));
    const slots = slotsFor(store);
    const r = slots.load();
    expect(r).toMatchObject({ readOnly: true, from: 'a', slots: { a: 'ok', b: 'newer' } });
    expect(slots.save(stateAt(11))).toBe(false);
    expect(store.sets()).toEqual([]);
  });
});

describe('レビュー M-1: 形・checksum の違う新しい版の枠も上書きしない（読み取り専用）', () => {
  /** schema 2 で、封筒の形と checksum が今の版と違う枠 */
  const futureRaw = (): string => {
    const e = JSON.parse(encodeSave(stateAt(99), 9, now, APP)) as Record<string, unknown>;
    e.schema = 2;
    e.checksum = 'sha256:0123';
    delete e.seq;
    e.generation = 9;
    return JSON.stringify(e);
  };
  it('b が新しい版（形・checksum 違い）、a が有効 → a を読み、読み取り専用。自動保存を何回しても set を呼ばない', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(10), 1);
    const future = futureRaw();
    store.map.set(SAVE_KEYS.b, future);
    const slots = slotsFor(store);
    const r = slots.load();
    expect(r).toMatchObject({ readOnly: true, from: 'a', brokenReset: false, slots: { a: 'ok', b: 'newer' } });
    for (let i = 0; i < 5; i++) expect(slots.save(stateAt(11 + i))).toBe(false);
    expect(store.sets()).toEqual([]);
    expect(store.map.get(SAVE_KEYS.b)).toBe(future);
  });
  it('a が新しい版（途中で切れている）・b が壊れている → 新しいゲームだが読み取り専用、退避もしない（brokenReset は false。N-4）', () => {
    const store = new FakeStore();
    store.map.set(SAVE_KEYS.a, futureRaw().slice(0, 40));
    store.map.set(SAVE_KEYS.b, 'garbage');
    const slots = slotsFor(store);
    const r = slots.load();
    expect(r).toMatchObject({ state: null, readOnly: true, brokenReset: false, slots: { a: 'newer', b: 'notJson' } });
    expect(slots.save(createInitialState(1))).toBe(false);
    expect(store.sets()).toEqual([]);
    expect(store.map.has(BROKEN_KEY)).toBe(false);
  });
});

describe('TS-027-09・20 キーはすべて onsen-driller: で始まり、他のゲームのキーを触らない', () => {
  it('起動・保存・設定の保存・読み込み', () => {
    const store = new FakeStore();
    store.map.set('other-game:save', 'x');
    store.map.set('save:a', 'y');
    const slots = slotsFor(store);
    slots.load();
    slots.save(stateAt(3));
    slots.save(stateAt(4));
    saveSettings(store, { ...DEFAULT_SETTINGS, lang: 'ja' });
    loadSettings(store);
    slotsFor(store).load();
    expect(store.calls.length).toBeGreaterThan(5);
    for (const c of store.calls) expect(c.key.startsWith('onsen-driller:')).toBe(true);
    expect(store.map.get('other-game:save')).toBe('x');
    expect(store.map.get('save:a')).toBe('y');
  });
});

describe('TS-027-10・11 get・set・remove の例外が保存の外に漏れない。QuotaExceededError は failing で続ける', () => {
  it('get が例外 → 読めない枠（新しいゲーム）、set が例外 → false・failing、以後の保存でも例外なし', () => {
    const store = new FakeStore();
    store.getThrows = true;
    const slots = slotsFor(store);
    expect(() => slots.load()).not.toThrow();
    store.getThrows = false;
    store.setThrows = true;
    const s = stateAt(5);
    const before = stateHash(s);
    expect(slots.save(s)).toBe(false);
    expect(slots.status).toBe('failing');
    expect(() => slots.save(s)).not.toThrow();
    expect(stateHash(s)).toBe(before); // メモリの状態は失わない
    store.setThrows = false;
    expect(slots.save(s)).toBe(true); // 15 秒ごとの再試行で直る
    expect(slots.status).toBe('ok');
  });
  it('remove が例外でも設定・保存に影響しない', () => {
    const store = new FakeStore();
    store.removeThrows = true;
    const slots = slotsFor(store);
    slots.load();
    expect(slots.save(stateAt(1))).toBe(true);
  });
});

describe('TS-027-12・Q-21 起動時からストレージがない → unavailable（起動直後に案内。再試行しない）', () => {
  const insecure = (): never => {
    throw new DOMException('insecure', 'SecurityError');
  };
  it('localStorage の参照が SecurityError（V1）', () => {
    const storage = localStore(insecure);
    const slots = slotsFor(storage, storage.kind === 'memory');
    expect(slots.status).toBe('unavailable');
    expect(slots.load().state).toBeNull();
    expect(slots.save(stateAt(1))).toBe(false);
  });
  it('V3（getItem・setItem・removeItem がすべて例外）・V4（setItem は黙って捨て、getItem は常に null）もメモリ扱い', () => {
    const v3 = { setItem: insecure, getItem: insecure, removeItem: insecure } as unknown as Storage;
    const v4 = { setItem: () => undefined, getItem: () => null, removeItem: () => undefined } as unknown as Storage;
    expect(localStore(v3).kind).toBe('memory');
    expect(localStore(v4).kind).toBe('memory');
  });
});

describe('TS-027-13〜17 保存の契機（偽のタイマー）', () => {
  let store: FakeStore;
  let slots: SaveSlots;
  let win: EventTarget;
  let doc: EventTarget & { hidden: boolean; visibilityState: string };
  let auto: Autosave;
  let suppressed = false;
  const state = stateAt(7);

  beforeEach(() => {
    vi.useFakeTimers();
    store = new FakeStore();
    slots = slotsFor(store);
    slots.load();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { hidden: false, visibilityState: 'visible' });
    suppressed = false;
    auto = startAutosave({ slots, getState: () => state, win, doc, isSuppressed: () => suppressed });
  });
  afterEach(() => {
    auto.dispose();
    vi.useRealTimers();
  });
  const hide = (): void => {
    doc.hidden = true;
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  it('TS-027-13 14,999ms では保存なし、15,000ms で 1 回、30,000ms で 2 回', () => {
    vi.advanceTimersByTime(14_999);
    expect(slots.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(slots.writes).toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(slots.writes).toBe(2);
  });
  it('TS-027-14 hidden ですぐ 1 回、visible では保存しない', () => {
    hide();
    expect(slots.writes).toBe(1);
    doc.hidden = false;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(slots.writes).toBe(1);
  });
  it('TS-027-15 pagehide ですぐ 1 回', () => {
    win.dispatchEvent(new Event('pagehide'));
    expect(slots.writes).toBe(1);
  });
  it('TS-027-16 hidden と pagehide が続けて来ても混ざらず 2 回書き、seq が 1 ずつ増える', () => {
    hide();
    win.dispatchEvent(new Event('pagehide'));
    expect(store.sets()).toEqual([SAVE_KEYS.a, SAVE_KEYS.b]);
    expect([env(store, 'a').seq, env(store, 'b').seq]).toEqual([1, 2]);
  });
  it('TS-027-16 保存の途中にもう一度求められたら、終わった後に 1 回だけ行う（割り込まない）', () => {
    const order: string[] = [];
    const inner = startAutosave({
      slots: {
        get status() {
          return slots.status;
        },
        save: (s: GameState) => {
          order.push('begin');
          const ok = slots.save(s);
          if (order.length === 1) {
            inner.saveNow('manual'); // 保存の途中に 2 回求める
            inner.saveNow('manual');
          }
          order.push('end');
          return ok;
        },
      },
      getState: () => state,
      win: new EventTarget(),
      doc: Object.assign(new EventTarget(), { hidden: false }),
    });
    inner.saveNow('manual');
    inner.dispose();
    expect(order).toEqual(['begin', 'end', 'begin', 'end']);
    expect([env(store, 'a').seq, env(store, 'b').seq]).toEqual([1, 2]);
  });
  it('TS-027-17 録画モード・読み取り専用のときは set が一度も呼ばれない', () => {
    suppressed = true;
    vi.advanceTimersByTime(60_000);
    hide();
    win.dispatchEvent(new Event('pagehide'));
    expect(auto.saveNow('prestige')).toBe(false);
    expect(store.sets()).toEqual([]);
  });
  it('状態が変わったら onStatus で知らせる（failing → ok）', () => {
    const seen: string[] = [];
    auto.dispose();
    auto = startAutosave({ slots, getState: () => state, win, doc, onStatus: (s) => seen.push(s) });
    store.setThrows = true;
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(15_000); // failing のまま（知らせるのは変わったときだけ）
    store.setThrows = false;
    vi.advanceTimersByTime(15_000);
    expect(seen).toEqual(['failing', 'ok']);
  });
});

describe('TS-027-18・19 設定は別のキー。壊れていたら初期値', () => {
  it('設定を保存しても、セーブの枠の中身と seq は変わらない', () => {
    const store = new FakeStore();
    const slots = slotsFor(store);
    slots.load();
    slots.save(stateAt(3));
    const a = store.map.get(SAVE_KEYS.a);
    expect(saveSettings(store, { ...DEFAULT_SETTINGS, lang: 'ja', sfx: false })).toBe(true);
    expect(store.map.get(SAVE_KEYS.a)).toBe(a);
    expect(JSON.parse(store.map.get(SETTINGS_KEY) ?? '{}')).toMatchObject({ lang: 'ja', sfx: false });
    expect(loadSettings(store)).toMatchObject({ lang: 'ja', sfx: false, recordingMode: false });
  });
  it('JSON でない・型違い・知らない値 → 初期値。セーブの読み込みには影響しない', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(9), 1);
    store.map.set(SETTINGS_KEY, '{broken');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.map.set(SETTINGS_KEY, JSON.stringify({ lang: 'fr', sfx: 'yes', recordingMode: true, __proto__: { x: 1 } }));
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, recordingMode: true });
    expect(slotsFor(store).load().state?.run.depth).toBe(9);
  });
  it('set が例外でも false で落ちない', () => {
    const store = new FakeStore();
    store.setThrows = true;
    expect(saveSettings(store, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('TS-027-21 seq が安全な整数の上限の近くでも桁あふれしない', () => {
  it('a の seq が MAX_SAFE_INTEGER − 1 → 2 回保存しても安全な整数のまま読める', () => {
    const store = new FakeStore();
    put(store, 'a', stateAt(1), Number.MAX_SAFE_INTEGER - 1);
    const slots = slotsFor(store);
    slots.load();
    expect(slots.save(stateAt(2))).toBe(true);
    expect(slots.save(stateAt(3))).toBe(true);
    for (const s of ['a', 'b'] as const) expect(Number.isSafeInteger(env(store, s).seq)).toBe(true);
    expect(slotsFor(store).load().state?.run.depth).toBe(3);
  });
});
