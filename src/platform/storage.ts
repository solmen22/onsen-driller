// 保存先（arch §11）: localStorage（接頭辞・try/catch）と、使えないときのメモリ
import { STORAGE_PREFIX, type KeyValueStore } from './types.ts';

const assertKey = (k: string): void => {
  if (!k.startsWith(STORAGE_PREFIX)) throw new Error(`storage key must start with ${STORAGE_PREFIX}: ${k}`);
};

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

/** localStorage が使えなければ（シークレット・埋め込みの制限など）メモリに切り替える */
export function localStore(ls: Storage | undefined = globalThis.localStorage): KeyValueStore & { readonly kind: 'local' | 'memory' } {
  try {
    if (!ls) return memoryStore();
    const probe = `${STORAGE_PREFIX}__probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
  } catch {
    return memoryStore();
  }
  return {
    kind: 'local',
    get: (k) => {
      assertKey(k);
      try {
        return ls.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      assertKey(k);
      try {
        ls.setItem(k, v);
        return true;
      } catch {
        return false; // QuotaExceededError など
      }
    },
    remove: (k) => {
      assertKey(k);
      try {
        ls.removeItem(k);
      } catch {
        /* 無視 */
      }
    },
  };
}
