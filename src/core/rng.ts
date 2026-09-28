// シード付きの擬似乱数（arch §8-1）。sfc32（128 ビットの状態）と hash32（整数の混合）。

export type Sfc32State = [number, number, number, number];

/** splitmix32 でシードから sfc32 の状態を作る */
export function seedSfc32(seed: number): Sfc32State {
  let x = seed >>> 0;
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
  s[0] = a;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return t >>> 0;
}

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
