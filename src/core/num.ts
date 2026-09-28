// 大きな数のラッパ（arch §9）。break_eternity.js へ差し替えるときはこのファイルだけを直す。
import Decimal from 'break_infinity.js';

export type Num = Decimal;
export type NumSource = Decimal | number | string;

export const num = (v: NumSource): Num => new Decimal(v);
export const isNum = (v: unknown): v is Num => v instanceof Decimal;

export const numPow = (base: NumSource, exp: number): Num => Decimal.pow(base, exp);
export const numMax = (a: NumSource, b: NumSource): Num => Decimal.max(a, b);

/** 等比級数: 今 owned 個持っているとき、所持金で買える数 */
export const affordGeometric = (money: Num, c0: number, r: number, owned: number): number =>
  Decimal.affordGeometricSeries(money, c0, r, owned).toNumber();

/** 等比級数: owned 個から n 個買う合計コスト */
export const sumGeometric = (n: number, c0: number, r: number, owned: number): Num =>
  Decimal.sumGeometricSeries(n, c0, r, owned);

export const ZERO: Num = num(0);

/** NaN・Infinity・負を検出する（不変条件 #22） */
export const isHealthy = (v: Num): boolean =>
  Number.isFinite(v.mantissa) && Number.isFinite(v.exponent) && v.mantissa >= 0;
