// 数値の表記 3 種（gdd §11-4・arch §9。BL-011）: 日本語は万進（無量大数まで）、英語は K・M・B…Dc → aa…zz、どちらも超えたら指数。
// 設定「指数」なら 1,000 以上を指数にする。表記は言語ごとのデータなので i18n に置く（ui の HUD・購入ボタンと、view の数字のポップの両方が使う）
//
// 規則（Q-32・Q-33 の PM の回答。traceability §5-4。シナリオ BL-011_number-format.md）:
// - 比べて読む数（所持コイン・コスト・毎秒の量・数字のポップ）は、すべて同じ関数・同じ丸め（切り捨て）。等しい値は同じ表記になる。
//   切り捨ては値の大小の順番を崩さないので、表記どうしで「所持 < コスト」なら必ず買えず、「所持 > コスト」なら必ず買える。
//   表記が同じになるときは購入ボタンの状態（buyQuote。実際の値）が正
// - 不足額（「あと N コイン」）だけは切り上げ（足りないのに「あと 0 コイン」と見せない）
// - 単位の中の数は有効 3 桁で切り捨て（1.23K・12.3K・123K／1.23万・12.3万・123万）。日本語で単位の中の数が 1,000〜9,999 なら
//   カンマつきの 4 桁の整数（1,234万）。末尾の 0 は落とす。1 未満の端数は整数に切り捨て（0.5 → 0）
// - 日本語は 9,999無量大数（〜9.999e71）まで単位、1e72 以上は指数。英語は Dc の次を aa（1e36）…zz とし、1e2064 以上は指数
// - 指数の設定: 1,000 未満は自動と同じ、1,000 以上は指数（仮数は小数 2 桁まで切り捨て。言語によらない）
// - 毎秒の量: 100 未満は小数 2 桁まで切り捨て。100 以上は所持コインと同じ
// - 区切り「,」と小数点「.」はロケールによらない（toLocaleString・Intl を使わない）
//
// 桁は浮動小数の掛け算・Math.floor で切らず、10 進の桁の文字列で切る（0.29 を 0.28 と出さない。S1 レビュー B-N9）。
// 仮数は有効 15 桁に丸めてから桁の文字列にする（break_infinity の仮数の誤差〔0.29 の仮数 2.8999999999999995〕を消すため。
// 丸めは大小の順番を崩さない）。正規化されていない仮数（0.999…e7 など。BL-106）も桁の文字列の上で正規化する
import { num, ZERO, type Num } from '../core/num.ts';
import type { Lang } from './index.ts';

/** 設定の数値表記（settings.notation と同じ値） */
export type Notation = 'auto' | 'exp';

/** 表記の結果: 表示の文字列と、丸めた後の値（テストが表記を読み戻さずに大小を比べられるように） */
export interface Formatted {
  readonly text: string;
  readonly value: Num;
}

/** 日本語の万進の単位（10^4 ごと。無量大数 = 10^68 まで） */
const JA_UNITS = ['', '万', '億', '兆', '京', '垓', '秭', '穣', '溝', '澗', '正', '載', '極', '恒河沙', '阿僧祇', '那由他', '不可思議', '無量大数'] as const;
/** 英語の単位（10^3 ごと。Dc = 10^33 の後は aa〜zz） */
const EN_UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'] as const;
/** 英語の 2 文字の単位の数（aa〜zz） */
const EN_LETTER_UNITS = 26 * 26;

/** 日本語: 10^72 以上は指数。英語: 10^2064 以上は指数 */
const JA_EXP_FROM = JA_UNITS.length * 4;
const EN_EXP_FROM = (EN_UNITS.length + EN_LETTER_UNITS) * 3;

/**
 * 10 進の桁: 値 = d[0].d[1]d[2]… × 10^e（d は先頭が 0 でなく、末尾の 0 を落とした数字の列。0 は d が空）。
 * 大きさの上限（1e(9e15)）でも e は安全な整数の範囲
 */
interface Digits {
  readonly d: string;
  readonly e: number;
}

const ZERO_DIGITS: Digits = { d: '', e: 0 };
const NUMERIC = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/** Num → 10 進の桁（NaN・負・0 は 0、Infinity は扱わない〔num() が上限にする〕） */
export function digitsOf(n: Num): Digits {
  const v = num(n); // 健全な値にする（NaN・負・負のゼロは 0、Infinity・上限超えは上限）
  const m = v.mantissa;
  if (!(m > 0) || !Number.isFinite(m) || !Number.isFinite(v.exponent)) return ZERO_DIGITS;
  const s = NUMERIC.exec(m.toPrecision(15));
  if (!s) return ZERO_DIGITS;
  const int = s[1] ?? '';
  let d = int + (s[2] ?? '');
  // 先頭の数字の位（int の最後の桁が 10^0）
  let e = v.exponent + int.length - 1 + Number(s[3] ?? 0);
  const lead = d.length - d.replace(/^0+/, '').length;
  d = d.slice(lead);
  e -= lead;
  d = d.replace(/0+$/, '');
  return d === '' ? ZERO_DIGITS : { d, e };
}

/** 10^place の位より下を切り捨てる（inexact: 捨てた桁に 0 でないものがあったか） */
function truncAt(x: Digits, place: number): { x: Digits; inexact: boolean } {
  if (x.d === '') return { x, inexact: false };
  const keep = x.e - place + 1; // 残す桁の数
  if (keep <= 0) return { x: ZERO_DIGITS, inexact: true };
  if (keep >= x.d.length) return { x, inexact: false };
  const d = x.d.slice(0, keep).replace(/0+$/, '');
  return { x: d === '' ? ZERO_DIGITS : { d, e: x.e }, inexact: true };
}

/** 10^place を足す（切り上げの繰り上がり用。x は 10^place の位より下に桁がないこと） */
function addUnit(x: Digits, place: number): Digits {
  if (x.d === '') return { d: '1', e: place };
  const len = x.e - place + 1; // 10^place の位までの桁の数（≥ d.length）
  const digits = x.d.padEnd(len, '0').split('').map(Number);
  let i = digits.length - 1;
  for (; i >= 0; i--) {
    const v = (digits[i] ?? 0) + 1;
    if (v < 10) {
      digits[i] = v;
      break;
    }
    digits[i] = 0;
  }
  const d = (i < 0 ? '1' : '') + digits.join('');
  return { d: d.replace(/0+$/, ''), e: i < 0 ? x.e + 1 : x.e };
}

/** 10^place までの数を「整数部.小数部」の文字列にする（区切りのカンマは付けない。小数部の末尾の 0 は落とす） */
function plain(x: Digits, place: number): string {
  if (x.d === '') return '0';
  const digitAt = (pos: number): string => {
    const i = x.e - pos;
    return i >= 0 && i < x.d.length ? (x.d[i] ?? '0') : '0';
  };
  let int = '';
  for (let pos = Math.max(x.e, 0); pos >= 0; pos--) int += digitAt(pos);
  let frac = '';
  for (let pos = -1; pos >= place; pos--) frac += digitAt(pos);
  frac = frac.replace(/0+$/, '');
  return frac === '' ? int : `${int}.${frac}`;
}

/** 整数にカンマを 3 桁ごとに入れる（ロケールによらない） */
const withCommas = (int: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 桁 → Num（丸めた後の値） */
const toNum = (x: Digits): Num => (x.d === '' ? ZERO : num(`${x.d[0]}${x.d.length > 1 ? `.${x.d.slice(1)}` : ''}e${x.e}`));

/** 英語の単位（u は 10^(3u)。0 は単位なし） */
function enUnit(u: number): string {
  const named = EN_UNITS[u];
  if (named !== undefined) return named;
  const i = u - EN_UNITS.length; // 0 = aa
  const a = 'a'.charCodeAt(0);
  return String.fromCharCode(a + Math.floor(i / 26), a + (i % 26));
}

/**
 * 表記の形（どの位まで残すか・どう書くか）を値の大きさから決める。
 * place: 残す最下位の位（10^place）。write: 切った後の桁を文字列にする
 */
interface Shape {
  readonly place: number;
  readonly write: (x: Digits) => string;
}

function expShape(e: number): Shape {
  return {
    place: e - 2, // 仮数は小数 2 桁まで
    write: (x) => {
      const m = x.d.length > 1 ? `${x.d[0]}.${x.d.slice(1)}` : (x.d[0] ?? '0');
      return `${m}e${x.e}`;
    },
  };
}

/** 整数（1 未満の端数は切り捨て）。日本語は 1,000 以上でカンマつき（英語は 1,000 から単位なので 999 まで） */
const intShape: Shape = { place: 0, write: (x) => withCommas(plain(x, 0)) };

/** 単位つき: unitExp は単位の 10 の指数（万 = 4、K = 3）。有効 3 桁（日本語で単位の中が 1,000〜9,999 なら 4 桁の整数） */
function unitShape(e: number, unitExp: number, unit: string, fourDigitInt: boolean): Shape {
  const r = e - unitExp; // 単位の中の数の先頭の位（0〜3）
  const place = fourDigitInt && r === 3 ? unitExp : e - 2;
  const shifted = (x: Digits): Digits => ({ d: x.d, e: x.e - unitExp });
  return { place, write: (x) => `${withCommas(plain(shifted(x), place - unitExp))}${unit}` };
}

/** 所持コイン・コストの表記の形 */
function amountShape(e: number, lang: Lang, notation: Notation): Shape {
  if (e < 3) return intShape; // 1,000 未満は表記によらず整数
  if (notation === 'exp') return expShape(e);
  if (lang === 'ja') {
    if (e < 4) return intShape; // 1,000〜9,999 は「1,234」
    if (e >= JA_EXP_FROM) return expShape(e);
    const u = Math.floor(e / 4);
    return unitShape(e, u * 4, JA_UNITS[u] ?? '', true);
  }
  if (e >= EN_EXP_FROM) return expShape(e);
  const u = Math.floor(e / 3);
  return unitShape(e, u * 3, enUnit(u), false);
}

/** 毎秒の量の表記の形: 100 未満は小数 2 桁まで、それ以上は所持コインと同じ */
function rateShape(e: number, lang: Lang, notation: Notation): Shape {
  if (e < 2) return { place: -2, write: (x) => plain(x, -2) };
  return amountShape(e, lang, notation);
}

function formatWith(n: Num, shapeOf: (e: number) => Shape, roundUp: boolean): Formatted {
  const x = digitsOf(n);
  // 不足額が 0: 足りないのに Decimal の引き算で差が消えた（break_infinity は相対 1e-14 未満の差を 0 にする）。「1」に見せる
  if (x.d === '' && roundUp) return { text: intShape.write({ d: '1', e: 0 }), value: num(1) };
  if (x.d === '') return { text: '0', value: ZERO };
  const shape = shapeOf(x.e);
  const t = truncAt(x, shape.place);
  if (!roundUp || !t.inexact) return { text: t.x.d === '' ? '0' : shape.write(t.x), value: toNum(t.x) };
  // 切り上げ: 残した最下位の位に 1 を足し、繰り上がった値の形で書き直す（999,999 → 「1M」「100万」。「1000K」にしない）
  const up = addUnit(t.x, shape.place);
  const again = truncAt(up, shapeOf(up.e).place); // 繰り上がりで位が変わっても切れる桁はない（念のため同じ手順）
  return { text: shapeOf(again.x.e).write(again.x), value: toNum(again.x) };
}

/** 所持コイン・コスト・獲得したコイン（切り捨て） */
export const formatAmount = (n: Num, lang: Lang, notation: Notation = 'auto'): Formatted =>
  formatWith(n, (e) => amountShape(e, lang, notation), false);

/** 毎秒の量（100 未満は小数 2 桁まで切り捨て） */
export const formatRate = (n: Num, lang: Lang, notation: Notation = 'auto'): Formatted =>
  formatWith(n, (e) => rateShape(e, lang, notation), false);

/**
 * 不足額（「あと N コイン」。足りないときだけ呼ぶ）: 所持コインと同じ形で切り上げ（0 より大きい不足は 1 以上に見える）。
 * 0 以下を渡されたときも「1」（コストと所持がとても近いと、Decimal の引き算で差が 0 になるため。足りないのに 0 と見せない）
 */
export const formatShortfall = (n: Num, lang: Lang, notation: Notation = 'auto'): Formatted =>
  formatWith(n, (e) => amountShape(e, lang, notation), true);

let notation: Notation = 'auto';
/** 今の数値表記（設定。起動時に main.ts が設定の値を入れる。設定の画面は S3 の BL-045） */
export const getNotation = (): Notation => notation;
export const setNotation = (v: Notation): void => {
  notation = v;
};
