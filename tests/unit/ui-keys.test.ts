// BL-043: UI のキー操作（ui/keys.ts。Q-09）と「あと N 秒」・コストの表示（ui/format.ts）
import { describe, expect, it } from 'vitest';
import { num } from '../../src/core/index.ts';
import { etaParts, formatCost, formatRate } from '../../src/ui/format.ts';
import { isEditable, keyCommand, nextQty, QTY_ORDER } from '../../src/ui/keys.ts';

describe('keyCommand（1〜5 でタブ、Shift で購入数。TS-043-12・13 の元）', () => {
  it('数字の段・テンキーの 1〜5 でタブ', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(keyCommand({ key: String(n), code: `Digit${n}` })).toEqual({ kind: 'tab', tab: n });
      expect(keyCommand({ key: String(n), code: `Numpad${n}` })).toEqual({ kind: 'tab', tab: n });
    }
    // 配列が違うキーボード（AZERTY の Digit1 は '&'）でも位置で決める
    expect(keyCommand({ key: '&', code: 'Digit1' })).toEqual({ kind: 'tab', tab: 1 });
  });
  it('0・6〜9・文字・F キーは何もしない', () => {
    for (const k of ['0', '6', '9', 'a', 'F1', 'F5', 'F12', 'Enter', ' ']) expect(keyCommand({ key: k, code: k.startsWith('F') ? k : 'KeyA' }), k).toBeNull();
  });
  it('Ctrl・Alt・Meta・Shift との組み合わせでは切り替えない（CrazyGames の制限。TS-043-13）', () => {
    expect(keyCommand({ key: '1', code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(keyCommand({ key: '1', code: 'Digit1', altKey: true })).toBeNull();
    expect(keyCommand({ key: '1', code: 'Digit1', metaKey: true })).toBeNull();
    expect(keyCommand({ key: '!', code: 'Digit1', shiftKey: true })).toBeNull();
    expect(keyCommand({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, ctrlKey: true })).toBeNull();
  });
  it('Shift の keydown で購入数を 1 段進める。自動リピートは無視（TS-043-10）', () => {
    expect(keyCommand({ key: 'Shift', code: 'ShiftLeft', shiftKey: true })).toEqual({ kind: 'cycleQty' });
    expect(keyCommand({ key: 'Shift', code: 'ShiftRight', shiftKey: true, repeat: true })).toBeNull();
  });
  it('編集できる要素にフォーカスがあるときは何もしない（S3 の読み込み欄）', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(isEditable(target)).toBe(true);
      expect(keyCommand({ key: '1', code: 'Digit1', target })).toBeNull();
      expect(keyCommand({ key: 'Shift', target })).toBeNull();
    }
    expect(isEditable({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
  it('購入数の順番は ×1 → ×10 → 最大 → ×1', () => {
    expect(QTY_ORDER).toEqual([1, 10, 'max']);
    expect([nextQty(1), nextQty(10), nextQty('max')]).toEqual([10, 'max', 1]);
  });
});

describe('etaParts（「あと N 秒」の単位。Q-09・TS-043-05）', () => {
  it('60 秒未満は秒、1 時間未満は分、それ以上は時間（切り上げ）、99 時間を超えたら「99 時間以上」', () => {
    expect(etaParts(1.5)).toEqual({ unit: 'sec', n: 2 });
    expect(etaParts(59)).toEqual({ unit: 'sec', n: 59 });
    expect(etaParts(60)).toEqual({ unit: 'min', n: 1 });
    expect(etaParts(61)).toEqual({ unit: 'min', n: 2 });
    expect(etaParts(3599)).toEqual({ unit: 'min', n: 60 });
    expect(etaParts(3600)).toEqual({ unit: 'hour', n: 1 });
    expect(etaParts(99 * 3600)).toEqual({ unit: 'hour', n: 99 });
    expect(etaParts(99 * 3600 + 1)).toEqual({ unit: 'over', n: 99 });
    expect(etaParts(100 * 3600)).toEqual({ unit: 'over', n: 99 });
  });
  it('0・負・数でない値は 0 秒（例外にしない）', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(etaParts(v)).toEqual({ unit: 'sec', n: 0 });
  });
});

describe('formatCost・formatRate（S1 の仮の表示）', () => {
  it('コストは 1 万未満を切り上げる（所持コインは切り捨てなので「買えるように見えて買えない」を防ぐ）', () => {
    expect(formatCost(num(3), 'ja')).toBe('3');
    expect(formatCost(num(5.8), 'ja')).toBe('6');
    expect(formatCost(num('106.60735'), 'en')).toBe('107');
    expect(formatCost(num(9999.2), 'en')).toBe('10,000');
    expect(formatCost(num(0), 'en')).toBe('0');
    expect(formatCost(num(1.5e6), 'en')).toBe('1.50M');
  });
  it('毎秒の量は 100 未満を小数 2 桁まで（切り捨て）。それ以上は整数の表記', () => {
    expect(formatRate(num(0.4467), 'ja')).toBe('0.44');
    expect(formatRate(num(2), 'ja')).toBe('2');
    expect(formatRate(num(0), 'ja')).toBe('0');
    expect(formatRate(num(123.9), 'en')).toBe('123');
  });
});
