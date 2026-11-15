// @vitest-environment jsdom
// BL-045 の T5（≡）: 入口の並び・設定（言語・効果音・数値の表記・動きを減らす）・クレジット・「エラー情報をコピー」を jsdom で確かめる
// - 設定の保存は app の口（settings.set・onLangChange）を通るかで見る（保存そのものと読み取り専用の扱いは save-display・two-slot-save のテスト）
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../../src/app/settings.ts';
import { getNotation, setNotation } from '../../src/i18n/number-format.ts';
import en from '../../src/i18n/en.json';
import type { SettingsHooks } from '../../src/ui/hooks/use-game.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setNotation('auto');
  vi.unstubAllGlobals();
});

/** app の設定の口の代わり（main.ts と同じく、変えたら数値の表記を当てる） */
function fakeSettings(init: Partial<Settings> = {}): SettingsHooks & { value: Settings; sets: Partial<Settings>[] } {
  const o = {
    value: normalizeSettings({ ...DEFAULT_SETTINGS, ...init }),
    sets: [] as Partial<Settings>[],
    get: () => o.value,
    set: (patch: Partial<Settings>) => {
      o.sets.push(patch);
      o.value = normalizeSettings({ ...o.value, ...patch });
      setNotation(o.value.notation);
    },
  };
  return o;
}

describe('T5 の並び', () => {
  it('記録・設定・セーブ・このゲームについての入口があり、中身がまだないもの（図鑑・実績・統計・書き出し・読み込み・初めから・プライバシーポリシー）は押せない。外部リンクはない', () => {
    m = mount({ ctx: { settings: fakeSettings() } });
    m.click('tab-5');
    expect(m.q('panel-menu')).not.toBeNull();
    for (const id of ['menu-collection', 'menu-achievements', 'menu-stats', 'menu-export', 'menu-import', 'menu-new-game', 'menu-privacy']) {
      expect((m.get(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
    for (const id of ['lang-toggle', 'setting-sfx', 'setting-notation', 'setting-motion', 'menu-credits', 'btn-copy-errors']) {
      expect((m.get(id) as HTMLButtonElement).disabled, id).toBe(false);
    }
    expect(m.get('menu-version').textContent).toContain('0.0.1-test');
    expect(m.get('menu-version').textContent).toContain('web');
    expect(m.root.querySelectorAll('a[href]')).toHaveLength(0);
  });
});

describe('T5 の設定', () => {
  it('効果音を押すと settings.set({sfx}) で切り替わり、表示（data-value・文字）が変わる', () => {
    const st = fakeSettings();
    m = mount({ ctx: { settings: st } });
    m.click('tab-5');
    expect(m.get('setting-sfx').dataset['value']).toBe('on');
    m.click('setting-sfx');
    expect(st.sets).toEqual([{ sfx: false }]);
    expect(m.get('setting-sfx').dataset['value']).toBe('off');
    expect(m.get('setting-sfx').textContent).toContain(en['state.off']);
  });

  it('数値の表記を「指数」にすると、HUD のコインの表記がすぐ指数になる（自動に戻すと戻る）', () => {
    const st = fakeSettings();
    m = mount({ state: stateWith({ coins: 1.5e7 }), ctx: { settings: st } });
    m.click('tab-5');
    const before = m.get('hud-coins').textContent;
    m.click('setting-notation');
    expect(getNotation()).toBe('exp');
    expect(m.get('setting-notation').dataset['value']).toBe('exp');
    const after = m.get('hud-coins').textContent;
    expect(after).not.toBe(before);
    expect(after).toMatch(/e7/);
    m.click('setting-notation');
    expect(m.get('hud-coins').textContent).toBe(before);
  });

  it('動きを減らすは 自動 → オン → オフ → 自動 と巡り、「次の起動から」と出す', () => {
    const st = fakeSettings();
    m = mount({ ctx: { settings: st } });
    m.click('tab-5');
    expect(m.get('setting-motion').textContent).toContain(en['menu.nextLaunch']);
    const seen = [m.get('setting-motion').dataset['value']];
    for (let i = 0; i < 3; i++) {
      m.click('setting-motion');
      seen.push(m.get('setting-motion').dataset['value']);
    }
    expect(seen).toEqual(['auto', 'on', 'off', 'auto']);
  });

  it('言語を明示していると「端末の言語に合わせる」が出て、押すと設定は auto に戻り、端末の言語（ここでは英語）になる', () => {
    const st = fakeSettings({ lang: 'ja' });
    const langs: string[] = [];
    m = mount({ lang: 'ja', ctx: { settings: st, onLangChange: (l) => langs.push(l) } });
    m.click('tab-5');
    m.click('lang-auto');
    expect(st.value.lang).toBe('auto');
    expect(document.documentElement.lang).toBe('en');
    expect(m.q('lang-auto')).toBeNull();
    expect(m.get('lang-toggle').textContent).toContain(en['menu.auto']);
    expect(langs).toEqual([]); // auto は onLangChange（明示の言語の保存）を通さない
  });
});

describe('クレジット', () => {
  it('開くとフォント（OFL）とライブラリ（MIT）が出て、Esc で閉じる', () => {
    m = mount({ ctx: { settings: fakeSettings() } });
    m.click('tab-5');
    m.click('menu-credits');
    expect(m.get('credits-font').textContent).toContain('DotGothic16');
    expect(m.get('modal-credits').textContent).toContain('Phaser — MIT');
    m.key({ key: 'Escape' }, 'keydown', m.get('modal-credits'));
    expect(m.q('modal-credits')).toBeNull();
  });
});

describe('エラー情報をコピー（gdd §11-2）', () => {
  it('版・ビルド種別・ブラウザ・直近のエラーを 1 つの文字にしてクリップボードに書き、選べる欄にも出す', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, userAgent: 'TestUA/1.0' });
    m = mount({ ctx: { settings: fakeSettings(), errors: () => ['Error: boom', 'TypeError: x'] } });
    m.click('tab-5');
    m.click('btn-copy-errors');
    await act(async () => {
      await Promise.resolve();
    });
    const text = (m.get('errors-text') as HTMLTextAreaElement).value;
    expect(writeText).toHaveBeenCalledWith(text);
    for (const part of ['0.0.1-test', '(web)', 'UA: TestUA/1.0', 'Errors: 2', '1. Error: boom', '2. TypeError: x']) expect(text).toContain(part);
    expect(m.get('errors-status').dataset['copied']).toBe('true');
  });

  it('クリップボードが使えない環境では「コピーできませんでした」と出し、選べる欄で渡す', () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    m = mount({ ctx: { settings: fakeSettings() } });
    m.click('tab-5');
    m.click('btn-copy-errors');
    expect(m.get('errors-status').dataset['copied']).toBe('false');
    expect((m.get('errors-text') as HTMLTextAreaElement).value).toContain('Errors: 0');
  });
});
