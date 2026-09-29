// @vitest-environment jsdom
// BL-052: 言語の切り替えが再読み込みなしで UI に効くこと（TS-052-12。シナリオ `org/30_quality/test-designer/scenarios/BL-052_i18n.md`）。
// 設定への保存（main.ts の onLangChange → saveSettings）は app の側。ここでは UI が onLangChange に選んだ言語を渡すことを確かめる
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState } from '../../src/core/index.ts';
import en from '../../src/i18n/en.json';
import { getLang, setLang, type Lang } from '../../src/i18n/index.ts';
import ja from '../../src/i18n/ja.json';
import { App } from '../../src/ui/App.tsx';
import { Ctx } from '../../src/ui/hooks/use-game.ts';
import { uiPlatform } from '../support/ui.ts';

let root: HTMLElement | null = null;
afterEach(() => {
  if (root) {
    const r = root;
    void act(() => render(null, r));
    r.remove();
  }
  root = null;
  setLang('en');
});

function mountWithLang(lang: Lang, onLangChange: (l: Lang) => void): { q: (id: string) => HTMLElement; click: (id: string) => void } {
  setLang(lang);
  const store = new GameStore(createInitialState(1), {
    onError: (e) => {
      throw e;
    },
  });
  const r = document.createElement('div');
  document.body.appendChild(r);
  root = r;
  void act(() => {
    render(h(Ctx.Provider, { value: { store, platform: uiPlatform(), version: '0.0.1-test', onLangChange } }, h(App, {})), r);
  });
  const q = (id: string): HTMLElement => {
    const el = r.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`data-testid="${id}" がない`);
    return el;
  };
  return { q, click: (id) => void act(() => q(id).click()) };
}

describe('TS-052-12 言語の切り替え（T5 の lang-toggle）', () => {
  it('日本語で起動 → 英語に切り替えると、再読み込みなしでタブ・購入ボタン・メニューの文言が英語になり、<html lang> が en、onLangChange に en が渡る', () => {
    const onLangChange = vi.fn<(l: Lang) => void>();
    const m = mountWithLang('ja', onLangChange);
    expect(document.documentElement.lang).toBe('ja');
    expect(m.q('tab-1').textContent).toContain(ja['tab.dig']);
    expect(m.q('buy-drill-name').textContent).toContain(ja['item.drill']);

    m.click('tab-5');
    expect(m.q('lang-toggle').textContent).toContain(ja['ui.langName.ja']);
    m.click('lang-toggle');

    expect(getLang()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(onLangChange).toHaveBeenCalledTimes(1);
    expect(onLangChange).toHaveBeenCalledWith('en');
    expect(m.q('tab-1').textContent).toContain(en['tab.dig']);
    expect(m.q('tab-1').textContent).not.toContain(ja['tab.dig']);
    expect(m.q('lang-toggle').textContent).toContain(en['ui.langName.en']);
    expect(m.q('lang-toggle').textContent).toContain(en['menu.lang']);

    m.click('tab-1');
    expect(m.q('buy-drill-name').textContent).toContain(en['item.drill']);
  });

  it('英語から日本語に戻すと日本語になり、onLangChange に ja が渡る', () => {
    const onLangChange = vi.fn<(l: Lang) => void>();
    const m = mountWithLang('en', onLangChange);
    m.click('tab-5');
    m.click('lang-toggle');
    expect(getLang()).toBe('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect(onLangChange).toHaveBeenCalledWith('ja');
    expect(m.q('tab-5').textContent).toContain(ja['tab.menu']);
  });
});
