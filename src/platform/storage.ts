// 保存先（arch §11）: localStorage（接頭辞・try/catch）と、使えないときのメモリ
import { STORAGE_PREFIX, type KeyValueStore } from './types.ts';

const assertKey = (k: string): void => {
  if (!k.startsWith(STORAGE_PREFIX)) throw new Error(`storage key must start with ${STORAGE_PREFIX}: ${k}`);
};

export type StoreKind = 'local' | 'memory';

export function memoryStore(): KeyValueStore & { readonly kind: 'memory' } {
  const m = new Map<string, string>();
  return {
    kind: 'memory',
    get: (k) => (assertKey(k), m.get(k) ?? null),
    set: (k, v) => (assertKey(k), m.set(k, v), true),
    remove: (k) => {
      assertKey(k);
      m.delete(k);
    },
  };
}

/** localStorage を取り出す。`window.localStorage` の参照そのものが SecurityError を投げる環境がある（Safari のサードパーティ iframe など） */
const globalLocalStorage = (): Storage | null | undefined => globalThis.localStorage;

/**
 * localStorage が使えなければ（シークレット・埋め込みの制限など）メモリに切り替える。
 * `ls` を省くとグローバルの localStorage を使う。**参照も try の中で行う**（既定の引数で参照すると、
 * 参照が SecurityError を投げたときに try の外で例外になり、起動が止まる。E2E の V1・TS-E9-01・04）。
 * 引数に関数を渡すと、その呼び出しも try の中で行う（テストで参照の例外を再現するため）。
 */
export function localStore(ls?: Storage | null | (() => Storage | null | undefined)): KeyValueStore & { readonly kind: StoreKind } {
  let store: Storage;
  try {
    const found = ls === undefined ? globalLocalStorage() : typeof ls === 'function' ? ls() : ls;
    if (!found) return memoryStore();
    const probe = `${STORAGE_PREFIX}__probe`;
    found.setItem(probe, '1');
    found.removeItem(probe);
    store = found;
  } catch {
    return memoryStore();
  }
  return {
    kind: 'local',
    get: (k) => {
      assertKey(k);
      try {
        return store.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      assertKey(k);
      try {
        store.setItem(k, v);
        return true;
      } catch {
        return false; // QuotaExceededError など
      }
    },
    remove: (k) => {
      assertKey(k);
      try {
        store.removeItem(k);
      } catch {
        /* 無視 */
      }
    },
  };
}
