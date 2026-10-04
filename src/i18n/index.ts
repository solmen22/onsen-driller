// 軽い多言語（arch §13。BL-052）: 置き換え変数だけ。英語が既定
// - 文章は i18n/en.json・ja.json だけに置き、コードとコンテンツはキーだけを持つ（キーの突き合わせは tests/unit/i18n.test.ts）
// - 英語の複数形はキーを分ける: 数が 1 のときの文を「<キー>.one」に置き、tn() で出し分ける（日本語は同じ文を入れておく）
// - 言語の判定: 設定の上書き → platform.locale() → navigator.language → 英語。判定の結果は保存しない（設定は 'auto' のまま）
import en from './en.json';
import ja from './ja.json';

export type Lang = 'en' | 'ja';
export type TextKey = keyof typeof en;
/** 置き換え変数（{n}・{cost} など） */
export type TextVars = Readonly<Record<string, string | number>>;

/** ja.json に en.json のキーが欠けていれば型検査で落ちる（余分なキーは tests/unit/i18n.test.ts で落とす） */
const dict: Record<Lang, Readonly<Record<TextKey, string>>> = { en, ja };

let lang: Lang = 'en';
export const getLang = (): Lang => lang;
export const setLang = (l: Lang): void => {
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
};

/** ロケールの文字列（BCP 47 の ja・ja-JP・ja_JP など。大文字小文字は問わない）が日本語か。主の言語の部分が ja のときだけ */
const isJapanese = (locale: string): boolean => /^ja(?:[-_]|$)/i.test(locale.trim());

/** 空でないロケールの文字列だけを残す（null・空文字・空白は「分からない」として次の候補へ） */
const known = (locale: string | null | undefined): string | null => (typeof locale === 'string' && locale.trim() !== '' ? locale : null);

/** ブラウザの言語（navigator がない環境は null） */
export const navigatorLanguage = (): string | null => (typeof navigator !== 'undefined' ? known(navigator.language) : null);

/**
 * 言語を決める（arch §13 の順番）: 設定の上書き（'en'・'ja'）→ platform.locale() → navigator.language → 英語。
 * 最初に分かった候補で決め、ja で始まれば日本語、それ以外（fr・zh など）は英語
 */
export function resolveLang(setting: Lang | 'auto', platformLocale: string | null, browserLocale: string | null = navigatorLanguage()): Lang {
  if (setting === 'en' || setting === 'ja') return setting;
  const locale = known(platformLocale) ?? known(browserLocale);
  return locale !== null && isJapanese(locale) ? 'ja' : 'en';
}

/** 設定が 'auto' のときの判定（platform.locale() → navigator.language → 英語）。main.ts が使う */
export const detectLang = (platformLocale: string | null, browserLocale: string | null = navigatorLanguage()): Lang =>
  resolveLang('auto', platformLocale, browserLocale);

/** 辞書（言語 → キー → 文）。translate を辞書から切り離して確かめるための形 */
export type Dictionaries = Readonly<Record<Lang, Readonly<Record<string, string | undefined>>>>;

/**
 * 文を引く純粋な関数（今の言語 → 英語 → キーそのもの）。{名前} を置き換え変数で置き換える
 * （同じ変数が何度出てもすべて。値のない変数は {名前} のまま残し、余った変数は使わない。Q-34 (a)）
 */
export function translate(d: Dictionaries, l: Lang, key: string, vars?: TextVars): string {
  return fill(pick(d[l], key) ?? pick(d.en, key) ?? key, vars);
}

/** 辞書の自分のキーだけを引く（'constructor'・'toString' など prototype の名前を拾わない。PR #11 のレビュー N-3） */
const pick = (m: Readonly<Record<string, string | undefined>>, k: string): string | undefined => (Object.hasOwn(m, k) ? m[k] : undefined);

/** 今の言語で文を引く */
export function t(key: TextKey, vars?: TextVars): string {
  return translate(dict, lang, key, vars);
}

/** 表示する数が 1 か（英語の単数。数でも表示の文字列でもよい。「1.0」「1K」は複数） */
export const isOne = (count: number | string): boolean => (typeof count === 'number' ? count === 1 : count.trim() === '1');

/**
 * 数に応じて文を引く（英語の複数形。arch §13）: count が 1 で「<key>.one」があればそれを、なければ key を使う。
 * count には**表示する数（表記の後の文字列）**を渡す。文の数と文法を一致させるため、丸めた後に「1」と見えるなら単数、
 * 「1.5」「1K」「0」は複数（Q-34 (b)。表記の前の Decimal では判定しない: 0.4 コインの不足は「1」と表示されるので単数にする）
 */
export function tn(key: TextKey, count: number | string, vars?: TextVars): string {
  const one = `${key}.one`;
  return isOne(count) && Object.hasOwn(dict.en, one) ? t(one as TextKey, vars) : t(key, vars);
}

function fill(s: string, vars: TextVars | undefined): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m: string, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}
