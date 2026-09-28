// platform/storage.ts: localStorage が使えない環境でも例外を外に出さず、メモリに切り替える（BL-027。E2E の V1〜V3・TS-E9-01・04 の本体）
import { afterEach, describe, expect, it } from 'vitest';
import { localStore, memoryStore } from '../../src/platform/storage.ts';
import { createWebPlatform } from '../../src/platform/web.ts';

/** Map を持つ偽の Storage。each に例外を差し込める */
function fakeStorage(fail: Partial<Record<'get' | 'set' | 'remove', Error>> = {}): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      if (fail.get) throw fail.get;
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (fail.set) throw fail.set;
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (fail.remove) throw fail.remove;
      map.delete(k);
    },
  };
}

const securityError = (): Error => new DOMException('The operation is insecure.', 'SecurityError');
const quotaError = (): Error => new DOMException('quota', 'QuotaExceededError');

/** globalThis.localStorage を差し替える（終わったら元に戻す） */
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function defineGlobalLocalStorage(desc: PropertyDescriptor): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...desc });
}
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('localStorage の参照そのものが SecurityError を投げる（V1。Safari のサードパーティ iframe など）', () => {
  it('localStore() は例外を投げず、メモリに切り替わって読み書きできる', () => {
    defineGlobalLocalStorage({
      get() {
        throw securityError();
      },
    });
    let s: ReturnType<typeof localStore> | undefined;
    expect(() => (s = localStore())).not.toThrow();
    expect(s?.kind).toBe('memory');
    expect(s?.set('onsen-driller:save:a', 'x')).toBe(true);
    expect(s?.get('onsen-driller:save:a')).toBe('x');
  });

  it('引数に参照の関数を渡した場合も、その呼び出しを try の中で行う', () => {
    const s = localStore(() => {
      throw securityError();
    });
    expect(s.kind).toBe('memory');
  });

  it('web のアダプタを作っても例外にならない（起動が止まらない。TS-E9-01 の本体）', () => {
    defineGlobalLocalStorage({
      get() {
        throw securityError();
      },
    });
    const p = createWebPlatform('web');
    expect(p.storage.get('onsen-driller:save:a')).toBeNull();
    expect(p.storage.set('onsen-driller:save:a', '1')).toBe(true);
  });
});

describe('localStorage がない・壊れている', () => {
  it('グローバルに localStorage がない → メモリ', () => {
    defineGlobalLocalStorage({ value: undefined });
    expect(localStore().kind).toBe('memory');
  });

  it('null を渡す → メモリ', () => {
    expect(localStore(null).kind).toBe('memory');
  });

  it('試し書きが QuotaExceededError（V2）・getItem なども例外（V3）→ メモリ', () => {
    expect(localStore(fakeStorage({ set: quotaError() })).kind).toBe('memory');
    expect(localStore(fakeStorage({ set: securityError(), get: securityError(), remove: securityError() })).kind).toBe('memory');
  });

  it('試し書きのキーは接頭辞付きで、後に残さない', () => {
    const ls = fakeStorage();
    const s = localStore(ls);
    expect(s.kind).toBe('local');
    expect([...ls.map.keys()]).toEqual([]);
  });
});

describe('使える localStorage で、途中から例外になる（V5 など）', () => {
  it('get の例外は null、set の例外は false、remove の例外は握りつぶす', () => {
    const ls = fakeStorage();
    const s = localStore(ls);
    expect(s.set('onsen-driller:save:a', 'v1')).toBe(true);
    expect(ls.map.get('onsen-driller:save:a')).toBe('v1');
    const broken = localStore(ls);
    ls.getItem = () => {
      throw securityError();
    };
    ls.setItem = () => {
      throw quotaError();
    };
    ls.removeItem = () => {
      throw securityError();
    };
    expect(broken.get('onsen-driller:save:a')).toBeNull();
    expect(broken.set('onsen-driller:save:a', 'v2')).toBe(false);
    expect(() => broken.remove('onsen-driller:save:a')).not.toThrow();
  });
});

describe('キーの接頭辞（arch §11）', () => {
  it('onsen-driller: で始まらないキーは、メモリでも localStorage でも使えない（書き間違いに気づくため例外）', () => {
    for (const s of [memoryStore(), localStore(fakeStorage())]) {
      expect(() => s.get('save:a')).toThrow();
      expect(() => s.set('other-game:save', 'x')).toThrow();
      expect(() => s.remove('x')).toThrow();
    }
  });
});
