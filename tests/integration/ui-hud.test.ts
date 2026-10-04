// @vitest-environment jsdom
// BL-042: HUD の部品と store を jsdom で組んで確かめる（TS-042-06・07・11〈jsdom 版〉・12・13）。
// 実際の描画が要るもの（文字の大きさ・的の大きさ・レイアウトの切り替え）は e2e（TS-042-02・05・08・09・10・11）
import { afterEach, describe, expect, it } from 'vitest';
import { num, stateHash, temperatureAt } from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const HUD_IDS = ['hud-coins', 'hud-income', 'hud-depth', 'hud-max-depth', 'hud-temp', 'hud-tickets', 'toggle-auto-dig', 'btn-boost', 'btn-settings'];

describe('HUD の中身（TS-042-06）', () => {
  it('新しいゲーム: HUD の項目がすべてあり、チケットは 2、コイン 0、深さ・最深 0。鉱脈のチップは DOM にない（Q-20）', () => {
    m = mount();
    for (const id of HUD_IDS) expect(m.q(id), id).not.toBeNull();
    expect(m.get('hud-tickets').dataset['value']).toBe('2');
    expect(m.get('hud-tickets').textContent).toMatch(/^\D*2\D*$/); // e2e の TS-E1-02 と同じ見方
    expect(m.get('hud-coins').textContent).toMatch(/^\D*0\D*$/);
    expect(m.get('hud-depth').dataset['value']).toBe('0');
    expect(m.get('hud-max-depth').dataset['value']).toBe('0');
    expect(m.get('hud-temp').dataset['value']).toBe(String(temperatureAt(0)));
    expect(m.q('chip-vein')).toBeNull();
    // 保存できているときは「保存できません」を出さない
    expect(m.q('save-warning')).toBeNull();
  });
  it('鉱脈が出ているときだけチップを出す（S2 の BL-058 の前の置き場所）', () => {
    const s = stateWith();
    s.run.vein.active = { depth: 3, hits: 0, expiresAtMs: 60_000 };
    m = mount({ state: s });
    expect(m.q('chip-vein')).not.toBeNull();
  });
  it('毎秒の収入は selector incomePerSec の値（自動掘りがオンなら 0 より大きい。小数も出す）', () => {
    m = mount({ state: stateWith({ tool: 1, autoOn: true, depth: 3 }) });
    const raw = Number(m.get('hud-income').dataset['value']);
    expect(raw).toBeGreaterThan(0);
    expect(m.get('hud-income').textContent).not.toMatch(/^\+0\//);
  });
  it('保存の状態が ok 以外の間は save-warning を出し、data-state に状態を入れる。ok に戻ると消す（Q-11 の 5）', () => {
    m = mount();
    m.run((st) => st.setSaveStatus('unavailable'));
    expect(m.get('save-warning').dataset['state']).toBe('unavailable');
    m.run((st) => st.setSaveStatus('failing'));
    expect(m.get('save-warning').dataset['state']).toBe('failing');
    m.run((st) => st.setSaveStatus('ok'));
    expect(m.q('save-warning')).toBeNull();
  });
});

describe('HUD の更新（TS-042-07）', () => {
  it('コインと深さを変えて 200ms の通知（store.tick）が来ると、hud-coins・hud-depth・hud-temp が新しい値になる', () => {
    m = mount();
    const s = m.store.state;
    s.run.coins = num(1234);
    s.run.depth = 10;
    s.run.maxDepth = 10;
    m.run((st) => st.tick(0)); // 最初の tick は次の通知の時刻を決めるだけ
    m.run((st) => st.tick(199));
    expect(m.get('hud-depth').dataset['value']).toBe('0');
    m.run((st) => st.tick(200));
    expect(m.get('hud-coins').dataset['value']).toBe('1.234e3');
    expect(m.get('hud-coins').textContent).toContain('1.23K'); // 英語は 1,000 から単位（BL-011。S1 の仮の表記は「1,234」）
    expect(m.get('hud-depth').dataset['value']).toBe('10');
    expect(m.get('hud-max-depth').dataset['value']).toBe('10');
    expect(m.get('hud-temp').dataset['value']).toBe(String(temperatureAt(10)));
  });
});

describe('自動掘りの切り替え（TS-042-12・TS-043-15）', () => {
  it('ツルハシの前は locked・disabled・aria-pressed=false で、押しても状態は変わらない', () => {
    m = mount();
    const t = m.get('toggle-auto-dig') as HTMLButtonElement;
    expect(t.dataset['state']).toBe('locked');
    expect(t.disabled).toBe(true);
    expect(t.getAttribute('aria-pressed')).toBe('false');
    const h = stateHash(m.store.state);
    m.click('toggle-auto-dig');
    expect(stateHash(m.store.state)).toBe(h);
    // 色だけでなく文字でも状態が分かる
    expect(t.textContent).toMatch(/Locked/);
  });
  it('ツルハシを買うと off で押せ、押すと on（aria-pressed=true）、もう一度押すと off。状態の文字も変わる', () => {
    m = mount({ state: stateWith({ coins: 3 }) });
    expect(m.run((st) => st.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
    const t = m.get('toggle-auto-dig') as HTMLButtonElement;
    expect([t.dataset['state'], t.disabled, t.getAttribute('aria-pressed')]).toEqual(['off', false, 'false']);
    const offText = t.textContent;
    m.click('toggle-auto-dig');
    expect([t.dataset['state'], t.getAttribute('aria-pressed')]).toEqual(['on', 'true']);
    expect(m.store.state.run.autoDig.on).toBe(true);
    expect(t.textContent).not.toBe(offText);
    m.click('toggle-auto-dig');
    expect(t.dataset['state']).toBe('off');
    expect(m.store.state.run.autoDig.on).toBe(false);
  });
});

describe('掘削ブースト（S1 は押せない。TS-042-13）', () => {
  it('disabled・aria-disabled="true"・data-state="unavailable" で、押しても例外が出ず状態も変わらない', () => {
    m = mount();
    const b = m.get('btn-boost') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.dataset['state']).toBe('unavailable');
    const h = stateHash(m.store.state);
    expect(() => m?.click('btn-boost')).not.toThrow();
    expect(stateHash(m.store.state)).toBe(h);
  });
});

describe('設定ボタン', () => {
  it('押すと T5（≡）に切り替わる（S1 は準備中）', () => {
    m = mount();
    m.click('btn-settings');
    expect(m.get('tab-5').getAttribute('aria-selected')).toBe('true');
    expect(m.get('tab-1').getAttribute('aria-selected')).toBe('false');
    expect(m.q('panel-placeholder')).not.toBeNull();
  });
});

describe('操作できる要素の data-testid（TS-042-11 の jsdom 版。本判定は e2e）', () => {
  const OPERABLE = 'button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"])';
  it('T1〜T5 のどれを開いても、操作できる要素すべてに空でない data-testid がある', () => {
    const s = stateWith({ coins: 1e6 });
    s.run.vein.active = { depth: 3, hits: 0, expiresAtMs: 60_000 };
    m = mount({ state: s });
    for (const tab of [1, 2, 3, 4, 5]) {
      m.click(`tab-${tab}`);
      const missing = [...m.root.querySelectorAll<HTMLElement>(OPERABLE)].filter((el) => !el.dataset['testid']).map((el) => el.outerHTML.slice(0, 80));
      expect(missing, `tab-${tab}`).toEqual([]);
    }
  });
});
