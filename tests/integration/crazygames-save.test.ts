// BL-057: CrazyGames の保存（data モジュール）。localStorage の枠の移行（save/legacy.ts・arch §11）、
// 「ない」を undefined で返す保存先（S1 再レビュー A-N1。save/slots.ts の read）、data モジュールの上限でも進行を失わないこと
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGrant, createInitialState, stateHash } from '../../src/core/index.ts';
import { createCrazyGamesPlatform } from '../../src/platform/crazygames.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { moveLegacySlots, SUPERSEDED_KEY } from '../../src/save/legacy.ts';
import { BROKEN_KEY, SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
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
function saveText(seq: number, coins: string, savedAt = 1_000 + seq): string {
  const s = createInitialState(7);
  applyGrant(s, { coins });
  return encodeSave(s, seq, savedAt, APP);
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

describe('BL-115 両方に枠があるとき（kept の後の扱い。PR #30 のレビュー S-1）', () => {
  /** 2 枠の中身（なければ undefined） */
  const slotsOf = (s: FakeStore) => ({ a: s.map.get(SAVE_KEYS.a), b: s.map.get(SAVE_KEYS.b) });
  /** SaveSlots で読んだときのコイン */
  const coinsOf = (s: FakeStore) => new SaveSlots(s, { appVersion: APP, now: () => 1 }).load().state?.run.coins.toString();

  it('以前の保存先（seq 12。SDK を読めなかった起動の進行）が新しい: 今の保存先に写し、以前の枠を消し、今の保存先の最良の枠を 1 つ退避する（replaced）', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.a, saveText(9, '9'));
    to.map.set(SAVE_KEYS.b, saveText(10, '10'));
    from.map.set(SAVE_KEYS.a, saveText(11, '11'));
    from.map.set(SAVE_KEYS.b, saveText(12, '12'));
    expect(moveLegacySlots(from, to)).toBe('replaced');
    expect(slotsOf(to)).toEqual({ a: saveText(11, '11'), b: saveText(12, '12') });
    expect(from.map.size, '以前の枠は消える').toBe(0);
    expect(to.map.get(SUPERSEDED_KEY), '負けた側の最良の枠を 1 つだけ退避').toBe(saveText(10, '10'));
    expect(coinsOf(to), '新しいほうの進行で始まる').toBe('12');
    expect(moveLegacySlots(from, to), '二度目は何もしない').toBe('none');
  });
  it('以前の保存先に 1 枠だけ（seq 12）: その枠を写し、写さなかった今の保存先の枠は消す（2 枠の seq を混ぜない）', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.a, saveText(9, '9'));
    to.map.set(SAVE_KEYS.b, saveText(10, '10'));
    from.map.set(SAVE_KEYS.a, saveText(12, '12'));
    expect(moveLegacySlots(from, to)).toBe('replaced');
    expect(slotsOf(to)).toEqual({ a: saveText(12, '12'), b: undefined });
    expect(to.map.get(SUPERSEDED_KEY)).toBe(saveText(10, '10'));
    // 次の保存は反対の枠（b）に seq 13
    const slots = new SaveSlots(to, { appVersion: APP, now: () => 1 });
    expect(slots.load().state?.run.coins.toString()).toBe('12');
    expect(slots.nextTarget()).toEqual({ slot: 'b', seq: 13 });
  });
  it('今の保存先が新しい: 今の保存先はそのまま、以前の枠は消して 1 つ退避する（kept）。後で今の保存先が空になっても古い枠は戻らない', () => {
    const from = new FakeStore('local');
    const to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.b, saveText(20, '20'));
    from.map.set(SAVE_KEYS.a, saveText(12, '12'));
    from.map.set(SAVE_KEYS.b, saveText(11, '11'));
    expect(moveLegacySlots(from, to)).toBe('kept');
    expect(slotsOf(to)).toEqual({ a: undefined, b: saveText(20, '20') });
    expect(from.map.size, '以前の枠は消える').toBe(0);
    expect(to.map.get(SUPERSEDED_KEY)).toBe(saveText(12, '12'));
    // 症状 (b): 後で data モジュールが空になった起動（サインアウトでゲストのデータに戻る等）
    const empty = new FakeStore('sdk');
    expect(moveLegacySlots(from, empty)).toBe('none');
    expect(empty.map.size).toBe(0);
  });
  it('seq が同じなら savedAt の新しいほう。それも同じなら今の保存先', () => {
    for (const [legacyAt, want] of [
      [2_000, 'replaced'],
      [1_000, 'kept'],
      [500, 'kept'],
    ] as const) {
      const from = new FakeStore('local');
      const to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.a, saveText(5, '1', 1_000));
      from.map.set(SAVE_KEYS.a, saveText(5, '2', legacyAt));
      expect(moveLegacySlots(from, to), `savedAt ${legacyAt}`).toBe(want);
      expect(coinsOf(to), `savedAt ${legacyAt}`).toBe(want === 'replaced' ? '2' : '1');
      expect(from.map.size).toBe(0);
    }
  });
  it('壊れた枠は使わない。読めるほうを使い、壊れた枠しかない側は生の文字列を save:broken に 1 つ退避する（例外なし）', () => {
    // 以前の保存先が壊れている → 今の保存先を残す
    let from = new FakeStore('local');
    let to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.a, saveText(3, '3'));
    from.map.set(SAVE_KEYS.a, '{"seq":99,"broken');
    expect(moveLegacySlots(from, to)).toBe('kept');
    expect(slotsOf(to)).toEqual({ a: saveText(3, '3'), b: undefined });
    expect(to.map.get(BROKEN_KEY)).toBe('{"seq":99,"broken');
    expect(to.map.has(SUPERSEDED_KEY)).toBe(false);
    expect(from.map.size).toBe(0);
    // 今の保存先が壊れている → 以前の保存先を写す
    from = new FakeStore('local');
    to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.b, 'not json');
    from.map.set(SAVE_KEYS.a, saveText(2, '2'));
    expect(moveLegacySlots(from, to)).toBe('replaced');
    expect(slotsOf(to)).toEqual({ a: saveText(2, '2'), b: undefined });
    expect(to.map.get(BROKEN_KEY)).toBe('not json');
    expect(coinsOf(to)).toBe('2');
    // 片側の 1 枠だけ壊れている → 有効な枠で比べ、壊れた枠は写さない
    from = new FakeStore('local');
    to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.a, saveText(4, '4'));
    from.map.set(SAVE_KEYS.a, saveText(6, '6'));
    from.map.set(SAVE_KEYS.b, 'garbage');
    expect(moveLegacySlots(from, to)).toBe('replaced');
    expect(slotsOf(to)).toEqual({ a: saveText(6, '6'), b: undefined });
    // 両方とも壊れている → 何も変えない（held。今の保存先の退避は slots.ts の規則 4）
    from = new FakeStore('local');
    to = new FakeStore('sdk');
    to.map.set(SAVE_KEYS.a, 'x');
    from.map.set(SAVE_KEYS.a, 'y');
    expect(moveLegacySlots(from, to)).toBe('held');
    expect([...to.map]).toEqual([[SAVE_KEYS.a, 'x']]);
    expect([...from.map]).toEqual([[SAVE_KEYS.a, 'y']]);
  });
  it('どちらかに新しい版の枠があれば何も変えない（held。読み取り専用の規則。新しいビルドで読めるよう残す）', () => {
    const newer = '{"schema":999,"seq":1}';
    for (const side of ['from', 'to'] as const) {
      const from = new FakeStore('local');
      const to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.a, side === 'to' ? newer : saveText(3, '3'));
      from.map.set(SAVE_KEYS.a, side === 'from' ? newer : saveText(30, '30'));
      const fromBefore = new Map(from.map);
      const toBefore = new Map(to.map);
      expect(moveLegacySlots(from, to), side).toBe('held');
      expect(from.map, side).toEqual(fromBefore);
      expect(to.map, side).toEqual(toBefore);
    }
  });
  it('退避（superseded・broken）が書けない・読み戻しが合わないときは、元の枠を変えない（replaced は failed・kept は held で以前の枠を残す。PR #89 のレビュー S-2）', () => {
    /** 退避のキーだけ書けない（false）・黙って捨てる（読み戻しが合わない）・例外（容量不足） */
    const breakKey = (t: FakeStore, key: string, mode: 'false' | 'drop' | 'throw') => {
      const set = t.set.bind(t);
      t.set = (k, v) => {
        if (k !== key) return set(k, v);
        if (mode === 'throw') throw new DOMException('quota', 'QuotaExceededError');
        return mode === 'drop'; // drop: 成功と答えるが書かない（読み戻しが合わない）
      };
    };
    for (const mode of ['false', 'drop', 'throw'] as const) {
      // replaced: 今の保存先（負け）の最良の枠を退避できない → 何も変えず failed
      let from = new FakeStore('local');
      let to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.a, saveText(9, '9'));
      to.map.set(SAVE_KEYS.b, saveText(10, '10'));
      to.map.set(SUPERSEDED_KEY, 'older backup');
      from.map.set(SAVE_KEYS.a, saveText(11, '11'));
      let toBefore = new Map(to.map);
      let fromBefore = new Map(from.map);
      breakKey(to, SUPERSEDED_KEY, mode);
      expect(moveLegacySlots(from, to), `replaced ${mode}`).toBe('failed');
      expect(to.map, `replaced ${mode}: 今の保存先と前の退避はそのまま`).toEqual(toBefore);
      expect(from.map, `replaced ${mode}: 以前の枠は残る`).toEqual(fromBefore);
      // kept: 以前の保存先（負け）の最良の枠を退避できない → 以前の枠を消さない
      from = new FakeStore('local');
      to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.b, saveText(20, '20'));
      from.map.set(SAVE_KEYS.a, saveText(12, '12'));
      toBefore = new Map(to.map);
      fromBefore = new Map(from.map);
      breakKey(to, SUPERSEDED_KEY, mode);
      expect(moveLegacySlots(from, to), `kept ${mode}`).toBe('held');
      expect(to.map, `kept ${mode}`).toEqual(toBefore);
      expect(from.map, `kept ${mode}: 以前の枠は消さない`).toEqual(fromBefore);
      // 壊れた枠しかない側（save:broken への退避）も同じ
      from = new FakeStore('local');
      to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.b, 'not json');
      from.map.set(SAVE_KEYS.a, saveText(2, '2'));
      toBefore = new Map(to.map);
      breakKey(to, BROKEN_KEY, mode);
      expect(moveLegacySlots(from, to), `broken ${mode}`).toBe('failed');
      expect(to.map, `broken ${mode}: 壊れた枠も上書きしない`).toEqual(toBefore);
      expect(from.map.size).toBe(1);
    }
  });
  it('写せない・読み戻しが合わないときは、今の保存先を元に戻し、以前の枠を残す（failed。例外なし）', () => {
    const cases: [string, (t: FakeStore) => void][] = [
      ['set が false', (t) => void (t.setFails = true)],
      ['読み戻しが合わない', (t) => void (t.dropWrites = true)],
      [
        '2 枠目だけ書けない',
        (t) => {
          const set = t.set.bind(t);
          t.set = (k, v) => (k === SAVE_KEYS.b ? false : set(k, v));
        },
      ],
    ];
    for (const [name, setup] of cases) {
      const from = new FakeStore('local');
      const to = new FakeStore('sdk');
      to.map.set(SAVE_KEYS.a, saveText(9, '9'));
      to.map.set(SAVE_KEYS.b, saveText(10, '10'));
      from.map.set(SAVE_KEYS.a, saveText(11, '11'));
      from.map.set(SAVE_KEYS.b, saveText(12, '12'));
      const toBefore = new Map(to.map);
      const fromBefore = new Map(from.map);
      setup(to);
      expect(moveLegacySlots(from, to), name).toBe('failed');
      expect(to.map, `${name}: 今の保存先は元のまま`).toEqual(toBefore);
      expect(from.map, `${name}: 以前の枠は残る`).toEqual(fromBefore);
    }
  });
});

describe('TS-057-11 「ない」を undefined で返す保存先（A-N1）', () => {
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

  it('BL-115 main.ts と同じ順番: data モジュールに枠がある → SDK を読めなかった起動で進めた分 → 次の SDK ありの起動でその進行が残る', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    const up = crazyMock('local');
    const boot = async (sdk: ReturnType<typeof crazyMock>) => {
      const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: false });
      await p.init();
      if (p.legacyStorage) moveLegacySlots(p.legacyStorage, p.storage);
      const slots = new SaveSlots(p.storage, { appVersion: APP, now: () => 5 });
      return { p, slots, state: slots.load().state };
    };
    // 1 回目: SDK あり。data モジュールに 1 回保存
    const b1 = await boot(up);
    const s1 = createInitialState(3);
    applyGrant(s1, { coins: '100' });
    expect(b1.slots.save(s1)).toBe(true);
    // 2 回目: SDK の init が失敗 → localStorage（空）で始まり、3 回保存（seq 3）
    const down = crazyMock('local');
    down.initBehavior = 'reject';
    const b2 = await boot(down);
    expect(b2.p.storage.kind).toBe('local');
    const s2 = createInitialState(4);
    for (const c of ['1', '2', '3']) {
      applyGrant(s2, { coins: c });
      expect(b2.slots.save(s2)).toBe(true);
    }
    // 3 回目: SDK あり。localStorage の進行（seq 3 > 1）が data モジュールに写り、それで始まる
    const b3 = await boot(up);
    expect(b3.state && stateHash(b3.state)).toBe(stateHash(s2));
    expect(b3.p.legacyStorage?.get(SAVE_KEYS.a) ?? null, 'localStorage の枠は消えた').toBeNull();
    expect(b3.p.legacyStorage?.get(SAVE_KEYS.b) ?? null).toBeNull();
    expect(up.store.has(SUPERSEDED_KEY), '1 回目の枠は 1 つ退避').toBe(true);
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
