// シード付きの擬似乱数（arch §8-1）。sfc32（128 ビットの状態）と hash32（整数の混合）。

export type Sfc32State = [number, number, number, number];

/** シードを 32 ビットの符号なし整数にする（小数は切り捨て、負・2^32 以上は 2^32 で割った余り、NaN は 0） */
export const normalizeSeed = (seed: number): number => (Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0);

/** splitmix32 でシードから sfc32 の状態を作る */
export function seedSfc32(seed: number): Sfc32State {
  let x = normalizeSeed(seed);
  const next = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const s: Sfc32State = [next(), next(), next(), next()];
  // 最初の数回を捨てて状態をなじませる
  for (let i = 0; i < 12; i++) sfc32Next(s);
  return s;
}

/** sfc32: 状態 s を進めて 32 ビットの符号なし整数を返す */
export function sfc32Next(s: Sfc32State): number {
  let [a, b, c, d] = s;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  // 状態は符号なしで持つ（JSON にしたときの形をそろえる。出力の列は符号の表現によらない）
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return t >>> 0;
}

/** 状態の複製（保存・比較用） */
export const cloneSfc32 = (s: Sfc32State): Sfc32State => [s[0], s[1], s[2], s[3]];

/** 状態として正しいか（32 ビットの符号なし整数 4 つで、全部 0 ではない） */
export const isValidSfc32 = (v: unknown): v is Sfc32State =>
  Array.isArray(v) && v.length === 4 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff) && v.some((x) => x !== 0);

/** [0, 1) の浮動小数 */
export const sfc32Float = (s: Sfc32State): number => sfc32Next(s) / 4294967296;

/** [min, max] の整数 */
export const sfc32Int = (s: Sfc32State, min: number, max: number): number =>
  min + Math.floor(sfc32Float(s) * (max - min + 1));

/** 2 つの整数から 32 ビットのハッシュ（murmur3 の fmix を 2 段）。打つ順番・刻み幅に左右されない配置に使う */
export function hash32(a: number, b: number): number {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const hash01 = (a: number, b: number): number => hash32(a, b) / 4294967296;

/** 鉱石の種類を選ぶための、hash32 とは独立な 2 つ目のハッシュ（Q-07） */
export const ORE_KIND_SALT = 0x6f726573;
export const hash01Kind = (seed: number, depth: number): number => hash32((seed ^ ORE_KIND_SALT) >>> 0, depth) / 4294967296;
