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

export function useGame<T>(selector: (s: GameState) => T, equals: (a: T, b: T) => boolean = shallowEqual): T {
  const { store } = useUi();
  const [value, setValue] = useState(() => selector(store.state));
  const ref = useRef({ selector, value });
  ref.current.selector = selector;
  useEffect(
    () =>
      store.subscribe(() => {
        const next = ref.current.selector(store.state);
        if (!equals(ref.current.value, next)) {
          ref.current.value = next;
          setValue(next);
        }
      }),
    [store],
  );
  return value;
}

/** 保存の状態（'ok' | 'failing' | 'unavailable'）。store の通知で読み直す（BL-027 の save-warning） */
export function useSaveStatus(): GameStore['saveStatus'] {
  const { store } = useUi();
  const [value, setValue] = useState(store.saveStatus);
  useEffect(() => store.subscribe(() => setValue(store.saveStatus)), [store]);
  return value;
}
