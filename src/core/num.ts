// 大きな数のラッパ（arch §9。BL-009）。break_eternity.js へ差し替えるときはこのファイルだけを直す。
// 本作の大きな量（コイン・HP・ダメージ・コスト・湯の華）は全部 0 以上なので、どの関数も「健全な値」だけを返す（Q-13）:
// - 負の結果は 0。負のゼロは作らない
// - 上限は 1e(9e15−1)（break_infinity.js は指数 9e15 以上を Infinity として扱う）。超えたら上限
// - ゼロ除算は 0。不正な入力（NaN・'abc'・''・undefined）は 0、Infinity は上限
// - 例外を投げない
import Decimal from 'break_infinity.js';

export type Num = Decimal;
export type NumSource = Num | number | string;

/** 指数の上限（これを超える値は NUM_MAX にする） */
export const NUM_EXP_MAX = 9e15 - 1;
export const NUM_MAX: Num = Decimal.fromMantissaExponent_noNormalize(1, NUM_EXP_MAX);
export const ZERO: Num = Decimal.fromMantissaExponent_noNormalize(0, 0);
export const ONE: Num = Decimal.fromMantissaExponent_noNormalize(1, 0);

export const isNum = (v: unknown): v is Num => v instanceof Decimal;

/**
 * 仮数を [1, 10) に戻すときの繰り返しの上限（正の有限の double なら 10 倍・1/10 を 330 回ほどで収まる。無限ループの防止）
 */
const RENORM_MAX_STEPS = 400;

/**
 * 計算結果を健全な値にする。break_infinity.js の加減算・乗除は、仮数が 9.99…9 の近くで丸められると
 * 仮数が [1, 10) から外れた値（例: add(1, 9999998.999999976) → 仮数 0.999999999999998・指数 7）を返すことがあるので、
 * 値をほぼ変えずに（1 回の 10 倍・1/10 で最大 0.5 ulp の丸め）10 倍ずつ桁を移して [1, 10) に戻す
 * （保存の文字列・isHealthy・比較の前提。num.ts の正規化の不具合。BL-106）。
 * 範囲の中の値はそのまま返す。範囲の外の値（BL-106 の不具合の値）を含むリプレイは、ハッシュが変わる（それが修正）。
 * BL-106 でリプレイ・sim のハッシュが変わらなかったのは、今の sim・リプレイが範囲の外の値を一度も作らないため
 * （PR #22 のレビューの実測: sim 3 ボット・20 時間で sanitize 5,370 万回のうち範囲の外は 0 回。N-3）
 */
export function sanitize(d: Decimal): Num {
  let m = d.mantissa;
  let e = d.exponent;
  if (Number.isNaN(m) || Number.isNaN(e) || m <= 0) return ZERO; // NaN・負・0・負のゼロ
  if (!Number.isFinite(m) || !Number.isFinite(e)) return NUM_MAX;
  const inRange = m >= 1 && m < 10;
  if (!inRange) {
    for (let i = 0; m < 1 && i < RENORM_MAX_STEPS; i++) {
      m *= 10;
      e -= 1;
    }
    for (let i = 0; m >= 10 && i < RENORM_MAX_STEPS; i++) {
      m /= 10;
      e += 1;
    }
    if (!(m >= 1 && m < 10)) return ZERO; // 正の有限の数なら届かない（念のため）
  }
  if (e > NUM_EXP_MAX || (e === NUM_EXP_MAX && m > 1)) return NUM_MAX;
  if (e < -NUM_EXP_MAX) return ZERO;
  return inRange ? d : Decimal.fromMantissaExponent_noNormalize(m, e);
}

const CANONICAL = /^([1-9](?:\.\d+)?)e(-?\d+)$/;
/**
 * BL-106 の修正の前に保存された、仮数が 1 未満の文字列（例 "0.999999999999998e7"）。修正の後の計算と同じ道（sanitize で 10 倍）で
 * 読み、値をビット単位で同じにする（break_infinity.js の文字列の読み方では最後の桁がずれる）
 */
const LEGACY_SUB1 = /^(0\.\d*[1-9]\d*)e(-?\d+)$/;

/** 任意の値を Num にする（読み込み・補正にも使う。例外を投げない） */
export function num(v: unknown): Num {
  if (v instanceof Decimal) return sanitize(v);
  if (typeof v === 'number') {
    if (Number.isNaN(v) || v <= 0) return ZERO;
    if (!Number.isFinite(v)) return NUM_MAX;
    return sanitize(new Decimal(v));
  }
  if (typeof v !== 'string') return ZERO;
  const s = v.trim();
  if (s === '' || s.length > 64) return ZERO;
  if (s === 'Infinity' || s === '+Infinity') return NUM_MAX;
  const c = CANONICAL.exec(s);
  if (c?.[1] && c[2]) {
    const m = Number(c[1]);
    const e = Number(c[2]);
    if (m >= 1 && m < 10 && Number.isSafeInteger(e)) return sanitize(Decimal.fromMantissaExponent_noNormalize(m, e));
  }
  const l = LEGACY_SUB1.exec(s);
  if (l?.[1] && l[2]) {
    const m = Number(l[1]);
    const e = Number(l[2]);
    if (m > 0 && m < 1 && Number.isSafeInteger(e)) return sanitize(Decimal.fromMantissaExponent_noNormalize(m, e));
  }
  try {
    return sanitize(new Decimal(s));
  } catch {
    return ZERO;
  }
}

/** 保存・イベント用の文字列（"<仮数>e<指数>"。ゼロは "0"）。num() で読むとビット単位で同じ値に戻る（Q-10） */
export function toStr(n: Num): string {
  const s = sanitize(n);
  return s.mantissa === 0 ? '0' : `${s.mantissa}e${s.exponent}`;
}

const isZero = (n: Num): boolean => n.mantissa === 0;

// 第 2 引数も num() で健全な値にしてから計算する（文字列で例外、NaN で結果が 0 になるのを防ぐ。Q-13・レビュー S-10）。
// num() は NaN・負・不正な文字列を 0、Infinity を上限にするので、足し算・引き算に NaN が混ざっても元の値が残る
export const add = (a: Num, b: NumSource): Num => sanitize(a.add(num(b)));
export const sub = (a: Num, b: NumSource): Num => sanitize(a.sub(num(b)));
export const mul = (a: Num, b: NumSource): Num => sanitize(a.mul(num(b)));
export function div(a: Num, b: NumSource): Num {
  const d = num(b);
  return isZero(d) ? ZERO : sanitize(a.div(d));
}
/** base^exp（exp は有限の数。そうでなければ 0） */
export function pow(base: NumSource, exp: number): Num {
  if (!Number.isFinite(exp)) return ZERO;
  return sanitize(Decimal.pow(num(base), exp));
}
export const floor = (a: Num): Num => sanitize(a.floor());
export const max = (a: Num, b: Num): Num => (a.gte(b) ? a : b);
export const min = (a: Num, b: Num): Num => (a.lte(b) ? a : b);

export const gt = (a: Num, b: NumSource): boolean => a.gt(b);
export const gte = (a: Num, b: NumSource): boolean => a.gte(b);
export const lt = (a: Num, b: NumSource): boolean => a.lt(b);
export const lte = (a: Num, b: NumSource): boolean => a.lte(b);
export const eq = (a: Num, b: NumSource): boolean => a.eq(b);
export const cmp = (a: Num, b: NumSource): number => a.cmp(b);

/** number にする（上限は Number.MAX_VALUE。表示・比の計算用） */
export function toNumber(a: Num): number {
  const v = sanitize(a).toNumber();
  return Number.isFinite(v) ? v : Number.MAX_VALUE;
}

/** 等比級数: 今 owned 個持っているとき、所持金で買える数（0 以上の整数） */
export function affordGeometric(money: Num, c0: number, r: number, owned: number): number {
  const n = Decimal.affordGeometricSeries(money, c0, r, owned).toNumber();
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 等比級数: owned 個から n 個買う合計コスト */
export const sumGeometric = (n: number, c0: number, r: number, owned: number): Num =>
  n <= 0 ? ZERO : sanitize(Decimal.sumGeometricSeries(n, c0, r, owned));

/** 健全か（NaN・Infinity・負・負のゼロでなく、上限以下）。不変条件 #22 */
export function isHealthy(v: Num): boolean {
  const m = v.mantissa;
  const e = v.exponent;
  if (!Number.isFinite(m) || !Number.isFinite(e)) return false;
  if (m < 0 || Object.is(m, -0)) return false;
  if (m === 0) return true;
  return (e < NUM_EXP_MAX || (e === NUM_EXP_MAX && m <= 1)) && m >= 1 && m < 10;
}

/** PoC からの互換（BL-010 で置き換える） */
export const numPow = pow;
export const numMax = (a: NumSource, b: NumSource): Num => max(num(a), num(b));
