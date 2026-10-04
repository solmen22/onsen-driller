// UI の integration テストの共通部品（jsdom の環境で使う。ファイルの先頭に `// @vitest-environment jsdom`）。
// 本物の store・core・アクションに Preact の App（または部品）をつなぎ、data-testid で要素を引く。
import { h, render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState, type GameState } from '../../src/core/index.ts';
import { setLang, type Lang } from '../../src/i18n/index.ts';
import type { Platform } from '../../src/platform/types.ts';
import { App } from '../../src/ui/App.tsx';
import { Ctx, type UiContext } from '../../src/ui/hooks/use-game.ts';

/** UI が読むだけの最小のアダプタ（target と calls） */
export function uiPlatform(target: Platform['target'] = 'web'): Platform {
  return {
    target,
    init: () => Promise.resolve(),
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => {},
    gameplayStop: () => {},
    happyTime: () => {},
    ads: {
      rewardedAvailable: () => false,
      showRewarded: () => Promise.resolve('unavailable'),
      breakOpportunity: () => Promise.resolve(),
      onPlaying: () => {},
    },
    storage: { get: () => null, set: () => false, remove: () => {}, kind: 'memory' },
    locale: () => null,
    isMuted: () => false,
    onMutedChange: () => {},
    openExternalLink: () => {},
    calls: () => [],
  };
}

export interface Mounted {
  store: GameStore;
  root: HTMLElement;
  /** data-testid で 1 つ引く（なければ null） */
  q(id: string): HTMLElement | null;
  /** data-testid で 1 つ引く（なければ例外） */
  get(id: string): HTMLElement;
  /** store の通知（5Hz の通知か dispatch の直後と同じ）を送り、描画を終わらせる */
  notify(): void;
  /** store を操作する（dispatch・setSaveStatus・tick など、通知を起こすもの）。描画まで終わらせる */
  run<T>(fn: (store: GameStore) => T): T;
  /** 要素をクリックし、描画を終わらせる */
  click(id: string): void;
  /** window にキーを送り、描画を終わらせる */
  key(init: KeyboardEventInit & { key: string }, type?: 'keydown' | 'keyup', target?: EventTarget): KeyboardEvent;
  unmount(): void;
}

/** 部品（既定は App 全体）を描く。lang の既定は en（表示の文字ではなく data-* で判定する） */
export function mount(
  opts: { state?: GameState; lang?: Lang; node?: ComponentChild; store?: GameStore; ctx?: Partial<UiContext> } = {},
): Mounted {
  setLang(opts.lang ?? 'en');
  const store = opts.store ?? new GameStore(opts.state ?? createInitialState(1), { onError: (e) => { throw e; } });
  const root = document.createElement('div');
  document.body.appendChild(root);
  // ctx: ご褒美の口（rewards・requestReward）・壁時計（now）・platform などを差し替える（BL-046）
  const value: UiContext = { store, platform: uiPlatform(), version: '0.0.1-test', ...opts.ctx };
  // act は Promise の型を返すが、同期の関数なら描画を終えてから戻る（ここでは待たない）
  void act(() => {
    render(h(Ctx.Provider, { value }, opts.node ?? h(App, {})), root);
  });
  const q = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const get = (id: string): HTMLElement => {
    const el = q(id);
    if (!el) throw new Error(`data-testid="${id}" がない`);
    return el;
  };
  return {
    store,
    root,
    q,
    get,
    notify() {
      void act(() => store.notify());
    },
    run<T>(fn: (st: GameStore) => T): T {
      let r: T | undefined;
      void act(() => {
        r = fn(store);
      });
      return r as T;
    },
    click(id) {
      void act(() => get(id).click());
    },
    key(init, type = 'keydown', target = window) {
      const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      void act(() => {
        target.dispatchEvent(ev);
      });
      return ev;
    },
    unmount() {
      void act(() => render(null, root));
      root.remove();
    },
  };
}
