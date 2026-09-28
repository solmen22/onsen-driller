// UI のキー操作（gdd §6・Q-09。BL-043）。純粋な関数（tests/unit/ui-keys.test.ts）
// - 1〜5: タブの切り替え（数字の段・テンキー）。Ctrl・Alt・Meta・Shift との組み合わせと F キーは使わない（CrazyGames の制限）
// - Shift: 購入数を 1 段進める（×1 → ×10 → 最大 → ×1）。押し続けても 1 段だけ（自動リピートの keydown は無視）
// - 編集できる要素（input・textarea・select・contenteditable）にフォーカスがあるときは何もしない（S3 の読み込み欄）
// Space（掘削）と矢印は app/input.ts が扱う
import type { Qty } from '../core/index.ts';

export type TabNo = 1 | 2 | 3 | 4 | 5;

export type KeyCommand = { kind: 'tab'; tab: TabNo } | { kind: 'cycleQty' };

export interface KeyLike {
  key?: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

/** 購入数の順番（切り替えボタンと Shift で共通） */
export const QTY_ORDER: readonly Qty[] = [1, 10, 'max'];

export const nextQty = (q: Qty): Qty => QTY_ORDER[(QTY_ORDER.indexOf(q) + 1) % QTY_ORDER.length] ?? 1;

/** 編集できる要素か（そこではキー操作をしない） */
export function isEditable(t: unknown): boolean {
  if (typeof t !== 'object' || t === null) return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const DIGIT = /^(?:Digit|Numpad)([1-5])$/;

/** keydown → UI の操作（なければ null） */
export function keyCommand(e: KeyLike): KeyCommand | null {
  if (e.ctrlKey === true || e.altKey === true || e.metaKey === true) return null;
  if (isEditable(e.target)) return null;
  if (e.key === 'Shift') return e.repeat === true ? null : { kind: 'cycleQty' };
  if (e.shiftKey === true) return null;
  const fromKey = typeof e.key === 'string' && /^[1-5]$/.test(e.key) ? Number(e.key) : null;
  const m = typeof e.code === 'string' ? DIGIT.exec(e.code) : null;
  const n = fromKey ?? (m ? Number(m[1]) : null);
  return n === null ? null : { kind: 'tab', tab: n as TabNo };
}
