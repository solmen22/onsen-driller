// BL-057: CrazyGames の保存（data モジュール）。localStorage の枠の移行（save/legacy.ts・arch §11）、
// 「ない」を undefined で返す保存先（S1 再レビュー A-N1。save/slots.ts の read）、data モジュールの上限でも進行を失わないこと
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGrant, createInitialState, stateHash } from '../../src/core/index.ts';
import { createCrazyGamesPlatform } from '../../src/platform/crazygames.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { moveLegacySlots } from '../../src/save/legacy.ts';
import { SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
import { crazyMock } from '../mocks/sdk.ts';

const APP = '0.0.1';

/** Map を持つ偽の KeyValueStore。失敗を差し込める。undefinedWhenMissing なら get の「ない」を undefined で返す（A-N1） */
class FakeStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getThrows = false;
  setFails = false;
  /** set は成功するが、読み戻すと違う値（書き込みを黙って捨てる保存先） */
  dropWrites = false;
  readonly kind: 'local' | 'sdk';
  private readonly undefinedWhenMissing: boolean;
  constructor(kind: 'local' | 'sdk' = 'local', undefinedWhenMissing = false) {
    this.kind = kind;
    this.undefinedWhenMissing = undefinedWhenMissing;
  }
  get(k: string): string | null {
    if (this.getThrows) throw new DOMException('insecure', 'SecurityError');
    const v = this.map.get(k);
    if (v !== undefined) return v;
    return this.undefinedWhenMissing ? (undefined as unknown as null) : null;
  }
  set(k: string, v: string): boolean {
    if (this.setFails) return false;
    if (!this.dropWrites) this.map.set(k, v);
    return true;
  }
  remove(k: string): void {
    this.map.delete(k);
  }
}

/** 本物の形のセーブ（seq・コイン） */
function saveText(seq: number, coins: string): string {
  const s = createInitialState(7);
  applyGrant(s, { coins });
  return encodeSave(s, seq, 1_000 + seq, APP);
}

/** Storage（localStorage）の偽物 */
function fakeLocalStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('moveLegacySlots（以前の保存先 → 今の保存先）', () => {
  it('今の保存先が空で以前の保存先に枠があれば、2 枠とも移して以前の枠を消す（moved）', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    from.map.set(SAVE_KEYS.a, saveText(3, '100'));
    from.map.set(SAVE_KEYS.b, saveText(4, '200'));
    from.map.set('onsen-driller:settings', '{"lang":"ja"}');
    expect(moveLegacySlots(from, to)).toBe('moved');
    expect(to.map.get(SAVE_KEYS.a)).toBe(saveText(3, '100'));
    expect(to.map.get(SAVE_KEYS.b)).toBe(saveText(4, '200'));
    expect(from.map.has(SAVE_KEYS.a) || from.map.has(SAVE_KEYS.b)).toBe(false);
    expect(from.map.get('onsen-driller:settings'), 'セーブの枠以外は触らない').toBe('{"lang":"ja"}');
    // 二度目は移すものがない
    expect(moveLegacySlots(from, to)).toBe('none');
  });
  it('片方の枠だけでも移す', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk', true);
    from.map.set(SAVE_KEYS.b, saveText(9, '5'));
    expect(moveLegacySlots(from, to)).toBe('moved');
    expect([...to.map.keys()]).toEqual([SAVE_KEYS.b]);
  });
  it('以前の保存先に枠がなければ何もしない（none）', () => {
    const to = new FakeStore('sdk');
    expect(moveLegacySlots(new FakeStore('local'), to)).toBe('none');
    expect(to.map.size).toBe(0);
  });
  it('今の保存先にもう枠があれば上書きしない（kept）。以前の枠も残す', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    from.map.set(SAVE_KEYS.a, saveText(50, '999'));
    to.map.set(SAVE_KEYS.b, saveText(2, '1'));
    expect(moveLegacySlots(from, to)).toBe('kept');
    expect(to.map.has(SAVE_KEYS.a)).toBe(false);
    expect(from.map.has(SAVE_KEYS.a)).toBe(true);
  });
  it('書けない・読み戻しが合わない・読めないときは以前の枠を消さず、今の保存先に書いた分を取り消す（failed。例外なし）', () => {
    const cases: [string, (from: FakeStore, to: FakeStore) => void][] = [
      ['set が false（dataLimitExcedeed など）', (_f, t) => void (t.setFails = true)],
      ['読み戻しが合わない', (_f, t) => void (t.dropWrites = true)],
      ['以前の保存先が読めない', (f) => void (f.getThrows = true)],
      ['今の保存先が読めない', (_f, t) => void (t.getThrows = true)],
    ];
    for (const [name, setup] of cases) {
      const from = new FakeStore('local');
      const to = new FakeStore('sdk');
      from.map.set(SAVE_KEYS.a, saveText(3, '100'));
      from.map.set(SAVE_KEYS.b, saveText(4, '200'));
      setup(from, to);
      expect(moveLegacySlots(from, to), name).toBe('failed');
      expect(from.map.size, `${name}: 以前の枠は残る`).toBe(2);
      expect(to.map.size, `${name}: 書いた分は取り消す`).toBe(0);
    }
  });
  it('2 枠目だけ書けなかったら、1 枠目も取り消す（片方だけ移った状態を残さない）', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    from.map.set(SAVE_KEYS.a, saveText(3, '100'));
    from.map.set(SAVE_KEYS.b, saveText(4, '200'));
    const set = to.set.bind(to);
    to.set = (k, v) => (k === SAVE_KEYS.b ? false : set(k, v));
    expect(moveLegacySlots(from, to)).toBe('failed');
    expect(to.map.size).toBe(0);
    expect(from.map.size).toBe(2);
  });
});

describe('「ない」を undefined で返す保存先（A-N1）', () => {
  it('空の枠は empty（unreadable ではない）。新しいプレイヤーも保存できる', () => {
    const store = new FakeStore('sdk', true);
    const slots = new SaveSlots(store, { appVersion: APP, now: () => 1 });
    const r = slots.load();
    expect(r.slots).toEqual({ a: 'empty', b: 'empty' });
    expect(slots.status).toBe('ok');
    expect(slots.save(createInitialState(1))).toBe(true);
    expect(store.map.has(SAVE_KEYS.a)).toBe(true);
  });
  it('例外は今までどおり unreadable（その枠を空とみなして上書きしない）', () => {
    const store = new FakeStore('sdk', true);
    store.getThrows = true;
    const slots = new SaveSlots(store, { appVersion: APP, now: () => 1 });
    expect(slots.load().slots).toEqual({ a: 'unreadable', b: 'unreadable' });
    expect(slots.status).toBe('unavailable');
  });
});

describe('CrazyGames のアダプタの保存先', () => {
  it('data モジュールの getItem が undefined を返しても、storage.get は null', async () => {
    const sdk = crazyMock('local');
    const data = sdk.data;
    if (!data) throw new Error('no data module');
    data.getItem = (k) => sdk.store.get(k) ?? (undefined as unknown as null);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: false });
    await p.init();
    expect(p.storage.kind).toBe('sdk');
    expect(p.storage.get(SAVE_KEYS.a)).toBeNull();
  });
  it('data モジュールを使うときだけ legacyStorage（localStorage）を出す', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    const on = createCrazyGamesPlatform({ getSdk: () => crazyMock('local'), adsEnabled: false });
    expect(on.legacyStorage, 'init の前はない').toBeUndefined();
    await on.init();
    expect(on.legacyStorage?.kind).toBe('local');

    for (const [name, make] of [
      ['environment が disabled', () => crazyMock('disabled')],
      ['SDK がない', () => undefined],
    ] as const) {
      const p = createCrazyGamesPlatform({ getSdk: make, adsEnabled: false });
      await p.init();
      expect(p.storage.kind, name).toBe('local');
      expect(p.legacyStorage, name).toBeUndefined();
    }
    const failing = crazyMock('local');
    failing.initBehavior = 'reject';
    const p = createCrazyGamesPlatform({ getSdk: () => failing, adsEnabled: false });
    await p.init();
    expect(p.legacyStorage, 'init の失敗').toBeUndefined();
  });
  it('localStorage が使えない（メモリ）なら legacyStorage はない', async () => {
    const p = createCrazyGamesPlatform({ getSdk: () => crazyMock('local'), adsEnabled: false });
    await p.init(); // Node には localStorage がない → メモリ
    expect(p.storage.kind).toBe('sdk');
    expect(p.legacyStorage).toBeUndefined();
  });

  it('main.ts と同じ順番: SDK なしの起動で localStorage に保存 → SDK ありの起動で data モジュールへ移り、同じ進行で始まる', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    // 1 回目: SDK の init が失敗 → localStorage に保存
    const down = crazyMock('local');
    down.initBehavior = 'reject';
    const p1 = createCrazyGamesPlatform({ getSdk: () => down, adsEnabled: false });
    await p1.init();
    const s1 = createInitialState(11);
    applyGrant(s1, { coins: '12345', depth: 30 });
    const slots1 = new SaveSlots(p1.storage, { appVersion: APP, now: () => 5 });
    slots1.load();
    expect(slots1.save(s1)).toBe(true);
    expect(p1.storage.kind).toBe('local');

    // 2 回目: SDK が使える → 移して読む
    const up = crazyMock('local');
    const p2 = createCrazyGamesPlatform({ getSdk: () => up, adsEnabled: false });
    await p2.init();
    const legacy = p2.legacyStorage;
    if (!legacy) throw new Error('no legacy storage');
    expect(moveLegacySlots(legacy, p2.storage)).toBe('moved');
    const slots2 = new SaveSlots(p2.storage, { appVersion: APP, now: () => 6 });
    const r = slots2.load();
    expect(r.state && stateHash(r.state)).toBe(stateHash(s1));
    expect(up.store.has(SAVE_KEYS.a)).toBe(true);
    expect(legacy.get(SAVE_KEYS.a), 'localStorage の枠は消えた').toBeNull();

    // 3 回目: もう移すものはない。data モジュールの上限で書けなくても、進行は失わない（failing で続け、読み込み済みの状態は残る）
    const p3 = createCrazyGamesPlatform({ getSdk: () => up, adsEnabled: false });
    await p3.init();
    expect(moveLegacySlots(p3.legacyStorage ?? legacy, p3.storage)).toBe('none');
    const slots3 = new SaveSlots(p3.storage, { appVersion: APP, now: () => 7 });
    const loaded = slots3.load().state;
    expect(loaded && stateHash(loaded)).toBe(stateHash(s1));
    const data = up.data;
    if (!data) throw new Error('no data module');
    data.setItem = () => {
      throw new Error('dataLimitExcedeed');
    };
    if (!loaded) throw new Error('no state');
    expect(slots3.save(loaded)).toBe(false);
    expect(slots3.status).toBe('failing');
    expect(up.store.has(SAVE_KEYS.a), '前の枠は残る').toBe(true);
  });
});
