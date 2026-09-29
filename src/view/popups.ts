// 数字のポップ（arch §14・Q-19。BL-036）。Phaser に依存しない
// - 同時に表示するのは 20 まで。21 個目は最も古いポップを消して使い回す（新しい破壊の数字を優先する）
// - 1 フレームに届いた破壊が 4 個以上なら、まとめて 1 つのポップ（合計のコイン）にする
import { add, num, toStr } from '../core/num.ts';
import { getLang, type Lang } from '../i18n/index.ts';
import { formatRate, getNotation, type Notation } from '../i18n/number-format.ts';

export const POPUP_MAX = 20;
export const POPUP_TTL_MS = 700;
/** 1 フレームでこの数以上の破壊はまとめる */
export const POPUP_MERGE_AT = 4;

export interface Slot<T> {
  item: T;
  bornAt: number;
}

export class PopupQueue<T> {
  private readonly slots: (Slot<T> | null)[];
  private readonly ttlMs: number;

  constructor(capacity = POPUP_MAX, ttlMs = POPUP_TTL_MS) {
    this.slots = Array.from({ length: Math.max(1, Math.floor(capacity)) }, () => null);
    this.ttlMs = ttlMs;
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** 表示中の数 */
  get active(): number {
    return this.slots.filter((s) => s !== null).length;
  }

  /** 1 つ足す。空きがなければ最も古いものを使い回す。使った枠の番号を返す（描画はその番号のテキストを使う） */
  add(item: T, now: number): { slot: number; recycled: boolean } {
    let free = this.slots.indexOf(null);
    let recycled = false;
    if (free < 0) {
      let oldest = 0;
      for (let i = 1; i < this.slots.length; i++) if ((this.slots[i]?.bornAt ?? Infinity) < (this.slots[oldest]?.bornAt ?? Infinity)) oldest = i;
      free = oldest;
      recycled = true;
    }
    this.slots[free] = { item, bornAt: now };
    return { slot: free, recycled };
  }

  /** 1 フレームに届いたものを足す（POPUP_MERGE_AT 個以上なら merge で 1 つにまとめる） */
  addFrame(items: readonly T[], now: number, merge: (items: readonly T[]) => T): { slot: number; item: T }[] {
    if (items.length === 0) return [];
    const list = items.length >= POPUP_MERGE_AT ? [merge(items)] : items;
    return list.map((item) => ({ ...this.add(item, now), item }));
  }

  /** 寿命が過ぎたものを消す。消した枠の番号を返す */
  expire(now: number): number[] {
    const gone: number[] = [];
    this.slots.forEach((s, i) => {
      if (s && now - s.bornAt >= this.ttlMs) {
        this.slots[i] = null;
        gone.push(i);
      }
    });
    return gone;
  }

  slot(i: number): Slot<T> | null {
    return this.slots[i] ?? null;
  }
}

/** ブロックの破壊 1 つ分のポップ（coins は Decimal の文字列。ore は鉱石の ID か null） */
export interface BreakPop {
  depth: number;
  coins: string;
  ore: string | null;
  /** まとめた数（1 なら 1 つ） */
  count: number;
}

/** まとめる: 合計のコイン、深さは最後のもの、鉱石はまとめたら出さない */
export function mergeBreaks(items: readonly BreakPop[]): BreakPop {
  let sum = num(0);
  for (const b of items) sum = add(sum, num(b.coins));
  const last = items[items.length - 1];
  return { depth: last?.depth ?? 0, coins: toStr(sum), ore: null, count: items.reduce((a, b) => a + b.count, 0) };
}

/**
 * ポップの文字: 普通のブロックは「+12」、鉱石は「石英 +96」（名前は呼び出し側が言語に合わせて渡す）、まとめたものは「+120 ×5」。
 * 数は HUD と同じ表記の関数（src/i18n/number-format.ts。BL-011・Q-32 ⑥）で、言語と数値表記の設定に従う（「+1.23万」「+12.3K」）。
 * 獲得したコインは序盤に 1 未満のことがあるので、毎秒の量と同じ形（100 未満は小数 2 桁まで切り捨て。100 以上は所持コインと同じ）
 */
export function popupText(p: BreakPop, oreName: string | null, lang: Lang = getLang(), notation: Notation = getNotation()): string {
  const coins = `+${formatRate(num(p.coins), lang, notation).text}`;
  if (p.count > 1) return `${coins} ×${p.count}`;
  return oreName ? `${oreName} ${coins}` : coins;
}
