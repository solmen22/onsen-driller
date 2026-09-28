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

/** 起動時の試し書きのキー（すぐ消す） */
export const PROBE_KEY = `${STORAGE_PREFIX}__probe`;

/**
 * 保存先を決める（Q-21・Q-25、レビュー S-2）。規則は「**読めるなら localStorage、読めなければメモリ**」:
 * - 参照が例外・ない（V1）、試し書きの読み出しが例外（V3）→ メモリ（保存の状態は起動直後から unavailable。再試行しない）
 * - 試し書きが例外（V2: 容量いっぱい）、試し書きは通るが読み戻しが合わない（V4: 書き込みを黙って捨てる）→
 *   **localStorage のまま**（既存のセーブを読む）で writeProbe: 'failed'（保存の状態は起動時から failing。15 秒ごとに再試行）
 * - それ以外 → localStorage（writeProbe: 'ok'）
 * `ls` を省くとグローバルの localStorage を使う。**参照も try の中で行う**（既定の引数で参照すると、
 * 参照が SecurityError を投げたときに try の外で例外になり、起動が止まる。E2E の V1・TS-E9-01・04）。
 * 引数に関数を渡すと、その呼び出しも try の中で行う（テストで参照の例外を再現するため）。
 * 返すストアの get は、読めないとき例外を投げる（「ない」＝null と区別する。レビュー S-1）
 */
export function localStore(ls?: Storage | null | (() => Storage | null | undefined)): KeyValueStore & { readonly kind: StoreKind } {
  let store: Storage;
  let writable = true;
  try {
    const found = ls === undefined ? globalLocalStorage() : typeof ls === 'function' ? ls() : ls;
    if (!found) return memoryStore();
    store = found;
  } catch {
    return memoryStore();
  }
  try {
    store.setItem(PROBE_KEY, '1');
  } catch {
    writable = false; // V2（容量いっぱい）: 読めるなら localStorage のまま
  }
  let back: string | null;
  try {
    back = store.getItem(PROBE_KEY);
  } catch {
    return memoryStore(); // V3: 読めない
  }
  if (writable) {
    try {
      store.removeItem(PROBE_KEY);
    } catch {
      /* 試し書きのキーが残っても害はない */
    }
    if (back !== '1') writable = false; // V4: 書き込みを黙って捨てる
  }
  return {
    kind: 'local',
    writeProbe: writable ? 'ok' : 'failed',
    get: (k) => {
      assertKey(k);
      return store.getItem(k); // 例外はそのまま投げる（読めない枠。呼び出し側が区別する）
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
