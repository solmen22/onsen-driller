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
