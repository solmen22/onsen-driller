// @vitest-environment jsdom
// BL-011: HUD と購入ボタンの数が、同じ表記の関数（src/i18n/number-format.ts）で出ること（TS-011-12・13・16）。
// シナリオ `org/30_quality/test-designer/scenarios/BL-011_number-format.md`
import { afterEach, describe, expect, it } from 'vitest';
import { buyQuote, incomePerSec, num, sub, toStr, type GameState } from '../../src/core/index.ts';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { formatAmount, formatRate, formatShortfall, setNotation } from '../../src/i18n/number-format.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setNotation('auto');
});

const fill = (s: string, n: string): string => s.replace(/\{\w+\}/g, n);

describe('TS-011-12 HUD と T1 の購入ボタンの数は同じ表記の関数', () => {
  it('日本語 → 英語: コイン 12,345 は「1.23万」→「12.3K」。コスト・毎秒の量・「あと N コイン」も同じ関数で、data-value は元の値のまま', () => {
    const s = stateWith({ coins: 12_345, drill: 90 }) // ドリルの次のコストは所持より大きい（足りない）;
    m = mount({ state: s, lang: 'ja' });
    const cost = buyQuote(s, 'drill', 1).cost;
    expect(m.get('hud-coins').textContent).toContain('1.23万');
    expect(m.get('hud-coins').dataset['value']).toBe(toStr(num(12_345)));
    expect(m.get('hud-income').textContent).toBe(fill(ja['hud.income'], formatRate(incomePerSec(s), 'ja').text));
    expect(m.get('buy-drill-cost').textContent).toBe(fill(ja['buy.cost'], formatAmount(cost, 'ja').text));
    expect(m.get('buy-drill-eta').textContent).toBe(fill(ja['eta.coins'], formatShortfall(sub(cost, s.run.coins), 'ja').text));

    // 言語を切り替える（T5 の lang-toggle）と、次の描画で表記も変わる
    m.click('tab-5');
    m.click('lang-toggle');
    m.click('tab-1');
    expect(m.get('hud-coins').textContent).toContain('12.3K');
    expect(m.get('hud-coins').textContent).not.toContain('万');
    expect(m.get('hud-coins').dataset['value']).toBe(toStr(num(12_345)));
    expect(m.get('buy-drill-cost').textContent).toContain(formatAmount(cost, 'en').text);
    expect(m.get('buy-drill-eta').textContent).toContain(formatShortfall(sub(cost, s.run.coins), 'en').text);
  });
});

describe('TS-011-13 数値表記の設定「指数」', () => {
  it('HUD・購入ボタンのすべての数が指数になり、設定を戻すと自動の表記に戻る', () => {
    setNotation('exp');
    const s = stateWith({ coins: 12_345, drill: 90 }) // ドリルの次のコストは所持より大きい（足りない）;
    m = mount({ state: s, lang: 'ja' });
    const cost = buyQuote(s, 'drill', 1).cost;
    expect(m.get('hud-coins').textContent).toContain('1.23e4');
    expect(m.get('buy-drill-cost').textContent).toBe(fill(ja['buy.cost'], formatAmount(cost, 'ja', 'exp').text));
    expect(m.get('buy-drill-cost').textContent).toMatch(/\de\d/);
    expect(m.get('buy-drill-eta').textContent).toMatch(/\de\d/);
    for (const id of ['hud-coins', 'buy-drill-cost', 'buy-drill-eta']) expect(m.get(id).textContent, id).not.toMatch(/万|億|兆/);

    setNotation('auto');
    m.notify();
    expect(m.get('hud-coins').textContent).toContain('1.23万');
    expect(m.get('buy-drill-cost').textContent).toBe(fill(ja['buy.cost'], formatAmount(cost, 'ja').text));
  });
});

/** 収入 0（時間を出さない）で、ドリルの次のコストまでの不足額がちょうど lack になる状態 */
function withLack(lack: number, drill: number): GameState {
  const s = stateWith({ drill });
  const cost = buyQuote(s, 'drill', 1).cost;
  s.run.coins = sub(cost, lack);
  expect(incomePerSec(s).eq(0)).toBe(true);
  return s;
}

describe('TS-011-16 「あと N コイン」の N は切り上げ', () => {
  const cases: readonly [lack: number, drill: number, ja: string, en: string][] = [
    [0.4, 0, '1', '1 coin short'],
    [1, 0, '1', '1 coin short'],
    [1.5, 0, '2', '2 coins short'],
    [12_301, 60, '1.24万', '12.4K coins short'],
    [999_999, 90, '100万', '1M coins short'],
  ];
  for (const [lack, drill, jaN, enText] of cases) {
    it(`不足 ${lack}: 日本語「あと ${jaN} コイン」、英語「${enText}」（繰り上がりの表記にならない）`, () => {
      const s = withLack(lack, drill);
      m = mount({ state: s, lang: 'ja' });
      const eta = m.get('buy-drill-eta');
      expect(eta.dataset['seconds']).toBeUndefined();
      expect(num(eta.dataset['lack']).sub(lack).abs().lte(lack * 1e-9)).toBe(true);
      expect(eta.textContent).toBe(fill(ja['eta.coins'], jaN));
      m.unmount();
      m = mount({ state: withLack(lack, drill), lang: 'en' });
      expect(m.get('buy-drill-eta').textContent).toBe(enText);
      expect(m.get('buy-drill-eta').textContent).not.toMatch(/1000K|100\.0|\b0 coin/);
      expect(enText.startsWith('1 ') ? en['eta.coins.one'] : en['eta.coins']).toContain('{n}');
    });
  }
});
