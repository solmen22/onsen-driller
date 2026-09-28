// 軽い多言語（arch §13）: 置き換え変数だけ。英語が既定
import en from './en.json';
import ja from './ja.json';

export type Lang = 'en' | 'ja';
export type TextKey = keyof typeof en;
const dict: Record<Lang, Record<TextKey, string>> = { en, ja };

let lang: Lang = 'en';
export const getLang = (): Lang => lang;
export const setLang = (l: Lang): void => {
  lang = l;
  document.documentElement.lang = l;
};
export const detectLang = (locale: string | null): Lang => (locale?.toLowerCase().startsWith('ja') ? 'ja' : 'en');

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
