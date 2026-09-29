// UI の数の表記（gdd §11-3・§11-4。BL-011）: 表記の規則と単位の表は src/i18n/number-format.ts（view の数字のポップと共通）。
// ここは HUD・購入ボタンが使う入口で、数値表記の設定（自動・指数）は getNotation() から読む
// - 所持コイン・コスト: formatNum（切り捨て。等しい値は同じ表記。表記どうしの大小は実際の大小と逆にならない）
// - 毎秒の量: formatRate（100 未満は小数 2 桁まで切り捨て）
// - 「あと N コイン」: formatShortfall（切り上げ。足りないのに 0 と見せない）
// 買えるかどうかは表記の数ではなく buyQuote の state で決める（Q-33）
import type { Num } from '../core/index.ts';
import type { Lang } from '../i18n/index.ts';
import { formatAmount, formatRate as rate, formatShortfall as shortfall, getNotation, type Notation } from '../i18n/number-format.ts';

export const formatNum = (n: Num, lang: Lang, notation: Notation = getNotation()): string => formatAmount(n, lang, notation).text;

export const formatRate = (n: Num, lang: Lang, notation: Notation = getNotation()): string => rate(n, lang, notation).text;

export const formatShortfall = (n: Num, lang: Lang, notation: Notation = getNotation()): string => shortfall(n, lang, notation).text;

/** 「あと N 秒」の単位（Q-09）: 60 秒未満は秒、1 時間未満は分、それ以上は時間（どれも切り上げ）。99 時間を超えたら「99 時間以上」 */
export type EtaUnit = 'sec' | 'min' | 'hour' | 'over';

export function etaParts(seconds: number): { unit: EtaUnit; n: number } {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  if (s < 60) return { unit: 'sec', n: s };
  if (s < 3600) return { unit: 'min', n: Math.ceil(s / 60) };
  const h = Math.ceil(s / 3600);
  return h > 99 ? { unit: 'over', n: 99 } : { unit: 'hour', n: h };
}
