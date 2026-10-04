// 以前の保存先から今の保存先へ、セーブの 2 枠を移す（arch §11 の「CrazyGames の移行」。BL-057）。
// CrazyGames で SDK が読めなかった起動では localStorage に保存している。次に SDK の data モジュールが使えた起動で、それを移す
// （移さないと、data モジュールが空なので新しいゲームになり、進行が消えたように見える）。
// - 今の保存先に枠が 1 つもなく、以前の保存先に枠があるときだけ移す（今の保存先のセーブを上書きしない）
// - 2 枠とも書いて読み戻し、一致したら以前の保存先から消す（二度移さない。後で進行を消したときに古いセーブが戻らない）
// - 読めない・書けない・一致しないときは以前の枠を消さず、今の保存先に書いた分は取り消す（次の起動でやり直す。進行を失わない）。
//   例外を投げない
import type { KeyValueStore } from '../platform/types.ts';
import { SAVE_KEYS } from './slots.ts';

export type LegacyMove = 'none' | 'kept' | 'moved' | 'failed';

const read = (s: KeyValueStore, k: string): string | null => {
  const v: unknown = s.get(k); // 読めない（例外）は呼び出し側で failed にする
  return typeof v === 'string' ? v : null;
};

/**
 * @returns none: 以前の保存先に枠がない／kept: 今の保存先にもう枠がある（移さない）／moved: 移して以前の枠を消した／
 *          failed: 読めない・書けない・読み戻しが合わない（以前の枠は消さず、今の保存先に書いた分は取り消す）
 */
export function moveLegacySlots(from: KeyValueStore, to: KeyValueStore): LegacyMove {
  const keys = [SAVE_KEYS.a, SAVE_KEYS.b];
  const written: string[] = [];
  try {
    const old: [string, string][] = [];
    for (const k of keys) {
      const v = read(from, k);
      if (v !== null) old.push([k, v]);
    }
    if (old.length === 0) return 'none';
    if (keys.some((k) => read(to, k) !== null)) return 'kept';
    for (const [k, v] of old) {
      written.push(k);
      if (!to.set(k, v) || read(to, k) !== v) throw new Error('write-back mismatch');
    }
    for (const [k] of old) from.remove(k);
    return 'moved';
  } catch {
    for (const k of written) {
      try {
        to.remove(k); // 途中まで書いた枠を取り消す（片方だけ移った状態を残さない）
      } catch {
        /* 無視 */
      }
    }
    return 'failed';
  }
}
