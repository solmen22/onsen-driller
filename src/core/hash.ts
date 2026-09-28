// 状態の直列化とハッシュ（arch §8-4 の stateHash。改ざん対策ではなく一致の確認用）
import { num } from './num.ts';
import type { GameState } from './state.ts';

/** Decimal は toJSON() で文字列になる。キーの順序は生成順で決まる */
export const serializeState = (s: GameState): string => JSON.stringify(s);

/** FNV-1a（32 ビット） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const stateHash = (s: GameState): string => fnv1a(serializeState(s));

/** serializeState の逆。Decimal のフィールドを戻す（スキーマ検証は save 層で行う） */
export function deserializeState(json: string): GameState {
  const o = JSON.parse(json) as GameState & {
    run: { coins: string; blockDmg: string };
    meta: { yunohanaLifetime: string };
    stats: { totalCoins: string };
  };
  return {
    ...o,
    run: { ...o.run, coins: num(o.run.coins), blockDmg: num(o.run.blockDmg) },
    meta: { ...o.meta, yunohanaLifetime: num(o.meta.yunohanaLifetime) },
    stats: { ...o.stats, totalCoins: num(o.stats.totalCoins) },
  };
}

export const cloneState = (s: GameState): GameState => deserializeState(serializeState(s));
