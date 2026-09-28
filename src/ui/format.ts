// 数値の表記（gdd §11-4）: 日本語は万進（無量大数まで）、英語は K/M/B…、超えたら指数
import type { Num } from '../core/index.ts';
import type { Lang } from '../i18n/index.ts';

const JA_UNITS = ['', '万', '億', '兆', '京', '垓', '秭', '穣', '溝', '澗', '正', '載', '極', '恒河沙', '阿僧祇', '那由他', '不可思議', '無量大数'];
const EN_UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

const trim = (x: number): string => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));

export function formatNum(n: Num, lang: Lang): string {
  const v = n.toNumber();
  if (!Number.isFinite(v) || n.exponent >= 300) return `${n.mantissa.toFixed(2)}e${n.exponent}`;
  if (v < 1e4) return Math.floor(v).toLocaleString('en-US');
  const e = Math.floor(Math.log10(v));
  if (lang === 'ja') {
    const u = Math.floor(e / 4);
    const unit = JA_UNITS[u];
    if (unit !== undefined) return `${trim(v / 10 ** (u * 4))}${unit}`;
  } else {
    const u = Math.floor(e / 3);
    const unit = EN_UNITS[u];
    if (unit !== undefined) return `${trim(v / 10 ** (u * 3))}${unit}`;
  }
  return `${(v / 10 ** e).toFixed(2)}e${e}`;
}

/**
 * 毎秒の量（HUD の毎秒の収入・自動掘削機の打数）: 100 未満は小数 2 桁まで（切り捨て、末尾の 0 は落とす）、それ以上は formatNum。
 * 序盤の収入は 1 未満なので、formatNum（整数に切り捨て）だと「+0」に見えてしまう（S1 の仮。BL-011 で 3 種の表記に合わせる）
 */
export function formatRate(n: Num, lang: Lang): string {
  const v = n.toNumber();
  if (Number.isFinite(v) && v < 100) return String(Math.floor(Math.max(0, v) * 100) / 100);
  return formatNum(n, lang);
}

/**
 * コスト（購入ボタンの -cost・「あと N コイン」）: 1 万未満は整数に切り上げる（所持コインは切り捨てなので、
 * 表示のコイン ≥ 表示のコストなら必ず買える。gdd §11-3 の「買えるように見えて買えない」を防ぐ）。それ以上は formatNum。
 * 買えるかどうかは表示の数ではなく buyQuote の state で決める（S1 の仮。BL-011 で 3 種の表記に合わせる）
 */
export function formatCost(n: Num, lang: Lang): string {
  const v = n.toNumber();
  if (Number.isFinite(v) && v < 1e4) return Math.ceil(Math.max(0, v - 1e-9)).toLocaleString('en-US');
  return formatNum(n, lang);
}

/** 「あと N 秒」の単位（Q-09）: 60 秒未満は秒、1 時間未満は分、それ以上は時間（どれも切り上げ）。99 時間を超えたら「99 時間以上」 */
export type EtaUnit = 'sec' | 'min' | 'hour' | 'over';

export function etaParts(seconds: number): { unit: EtaUnit; n: number } {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
  if (s < 60) return { unit: 'sec', n: s };
  if (s < 3600) return { unit: 'min', n: Math.ceil(s / 60) };
  const h = Math.ceil(s / 3600);
  return h > 99 ? { unit: 'over', n: 99 } : { unit: 'hour', n: h };
}
