// lz-string の compressToEncodedURIComponent の形式を、展開後の長さに上限をつけて読む（書き出し文字列の読み込み。
// レビュー S-6・Q-24）。lz-string の展開は入力の 2 乗の長さまで膨らみうる（4,225 文字 → 300 万文字）ので、
// 展開しながら長さを数え、上限を超えた時点で止める（展開してから測ると、その前にメモリと時間を使い切る）。
// 例外を投げない。仕組みは lz-string 1.5.0 の _decompress と同じで、上限・型・壊れた入力の扱いだけを足した。
//
// 元のコード: lz-string 1.5.0（https://github.com/pieroxy/lz-string）
//   MIT License
//   Copyright (c) 2013 pieroxy
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or substantial portions of
//   the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/** URI で使える 64 文字（lz-string の keyStrUriSafe） */
const URI_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const VALUE_OF = new Map<string, number>([...URI_SAFE].map((ch, i) => [ch, i]));

export type BoundedResult = { ok: true; text: string } | { ok: false; reason: 'tooLarge' | 'corrupt' };

const CORRUPT: BoundedResult = { ok: false, reason: 'corrupt' };
const TOO_LARGE: BoundedResult = { ok: false, reason: 'tooLarge' };

/**
 * compressToEncodedURIComponent の出力を展開する。展開後が maxChars 文字を超えたら tooLarge（その時点で止める）。
 * 空・知らない文字・壊れた符号は corrupt。例外を投げない
 */
export function decompressUriBounded(input: string, maxChars: number): BoundedResult {
  if (typeof input !== 'string' || input.length === 0) return CORRUPT;
  const s = input.replace(/ /g, '+'); // lz-string と同じ（URL の + が空白になったもの）
  for (let i = 0; i < s.length; i++) if (!VALUE_OF.has(s.charAt(i))) return CORRUPT;
  try {
    return decompressBounded(s.length, 32, (i) => VALUE_OF.get(s.charAt(i)) ?? 0, maxChars);
  } catch {
    return CORRUPT;
  }
}

function decompressBounded(length: number, resetValue: number, getNextValue: (index: number) => number, maxChars: number): BoundedResult {
  const dictionary: string[] = ['', '', ''];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  const result: string[] = [];
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  /** n ビットを読む（下位のビットから） */
  const readBits = (n: number): number => {
    let bits = 0;
    const maxpower = 2 ** n;
    let power = 1;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  let w: string;
  switch (readBits(2)) {
    case 0:
      w = String.fromCharCode(readBits(8));
      break;
    case 1:
      w = String.fromCharCode(readBits(16));
      break;
    case 2:
      return { ok: true, text: '' };
    default:
      return CORRUPT;
  }
  dictionary[3] = w;
  result.push(w);
  /** 展開した文字数 */
  let total = 1;
  if (total > maxChars) return TOO_LARGE;

  for (;;) {
    if (data.index > length) return CORRUPT; // 終わりの符号がないまま入力が尽きた（途中で切れた）
    let c = readBits(numBits);
    switch (c) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8));
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16));
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return { ok: true, text: result.join('') };
      default:
        break;
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    const known = c < dictSize ? dictionary[c] : undefined;
    if (known) entry = known;
    else if (c === dictSize) entry = w + w.charAt(0);
    else return CORRUPT;
    total += entry.length;
    if (total > maxChars) return TOO_LARGE; // 展開しながら上限を見て止める
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}
