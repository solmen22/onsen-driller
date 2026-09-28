// 必要な値だけを購読する（arch §15）。ストアの通知（5Hz か dispatch の直後）で selector を評価し、変わったときだけ再描画
import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../../core/index.ts';
import type { GameStore } from '../../app/store.ts';
import type { Lang } from '../../i18n/index.ts';
import type { Platform } from '../../platform/types.ts';

export interface UiContext {
  store: GameStore;
  platform: Platform;
  version: string;
  /** 言語を選んだ（app が設定に保存する） */
  onLangChange?: (l: Lang) => void;
}

export const Ctx = createContext<UiContext | null>(null);

export function useUi(): UiContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('UiContext missing');
  return c;
}

const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/**
 * 状態から selector で選んだ値を返し、store の通知（5Hz か dispatch の直後）でその値が変わったときだけ描き直す（BL-043）。
 * - 描画のたびに今の selector で読み直す（props が変わった〔×1 → ×10 など〕ときに、次の通知まで古い値を出さないため）。
 *   等しい（equals）ときは前の値をそのまま返す（子の描き直しを増やさない）
 * - 通知では selector を評価し、値が変わったときだけ描き直しを頼む。描画から購読までの間の変化も購読の直後に拾う
 */
export function useGame<T>(selector: (s: GameState) => T, equals: (a: T, b: T) => boolean = shallowEqual): T {
  const { store } = useUi();
  const [, bump] = useState(0);
  const ref = useRef<{ selector: (s: GameState) => T; equals: (a: T, b: T) => boolean; value: T } | null>(null);
  const next = selector(store.state);
  const value = ref.current !== null && ref.current.equals(ref.current.value, next) ? ref.current.value : next;
  ref.current = { selector, equals, value };
  useEffect(() => {
    const check = (): void => {
      const r = ref.current;
      if (!r) return;
      const n = r.selector(store.state);
      if (r.equals(r.value, n)) return;
      r.value = n;
      bump((x) => x + 1);
    };
    const off = store.subscribe(check);
    check();
    return off;
  }, [store]);
  return value;
}

/** 保存の状態（'ok' | 'failing' | 'unavailable'）。store の通知で読み直す（BL-027 の save-warning） */
export function useSaveStatus(): GameStore['saveStatus'] {
  const { store } = useUi();
  const [value, setValue] = useState(store.saveStatus);
  useEffect(() => store.subscribe(() => setValue(store.saveStatus)), [store]);
  return value;
}
