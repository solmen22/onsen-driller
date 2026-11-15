// 以前の保存先から今の保存先へ、セーブの 2 枠を移す（arch §11 の「CrazyGames の移行」。BL-057・BL-115）。
// CrazyGames で SDK が読めなかった起動では localStorage に保存している。次に SDK の data モジュールが使えた起動で、それを移す
// （移さないと、data モジュールが空なので新しいゲームになり、進行が消えたように見える）。
// - 今の保存先に枠が 1 つもなければ、以前の枠をそのまま写す（moved）
// - 両方に枠があれば（BL-115）、両方を decodeSave して、有効な枠のうちいちばん新しいもの（seq、同じなら savedAt。
//   それも同じなら今の保存先）を持つ側を残す。負けた側の最良の枠は、元の枠を変える前に SUPERSEDED_KEY に 1 つだけ退避し
//   （壊れた枠しかなければその生の文字列を BROKEN_KEY に。slots.ts の規則 4 と同じ形）、以前の保存先の枠は消す（後で古い枠が
//   戻らない）。退避できなければ元の枠を変えない（replaced は failed、kept は held で以前の枠を残す）
//   - 以前の保存先が新しい: その有効な枠を今の保存先に写し、写さなかった今の保存先の枠は消す（replaced）
//   - 今の保存先が新しい（または同じ）: 今の保存先はそのまま（kept）
//   - どちらかに新しい版・移行の失敗の枠がある、またはどちらにも有効な枠がない: 何も変えない（held。slots.ts が読み取り専用・
//     退避を扱う。新しい版のビルドで読めるよう残す）
// - 写した後は読み戻し、一致したら以前の保存先から消す（二度移さない）
// - 読めない・書けない・一致しないときは以前の枠を消さず、今の保存先は元に戻す（次の起動でやり直す。進行を失わない）。
//   例外を投げない
import type { KeyValueStore } from '../platform/types.ts';
import { decodeSave } from './codec.ts';
import { BROKEN_KEY, SAVE_KEYS } from './slots.ts';

/** 両方に枠があったとき、負けた側の最良の有効な枠（生の文字列）を 1 つだけ退避するキー（BL-115。読むのは人の手の復旧だけ） */
export const SUPERSEDED_KEY = 'onsen-driller:save:superseded';

/** held: 両方に枠があるが何も変えなかった（新しい版・移行の失敗の枠がある／どちらにも有効な枠がない／退避できない。PR #89 のレビュー Nit 2） */
export type LegacyMove = 'none' | 'kept' | 'held' | 'replaced' | 'moved' | 'failed';

const KEYS = [SAVE_KEYS.a, SAVE_KEYS.b] as const;

const read = (s: KeyValueStore, k: string): string | null => {
  const v: unknown = s.get(k); // 読めない（例外）は呼び出し側で failed にする
  return typeof v === 'string' ? v : null;
};

type Raws = [key: string, raw: string][];

/** 片側の枠を調べた結果 */
interface Side {
  raws: Raws;
  /** 有効な枠（新しい順） */
  valid: { key: string; raw: string; seq: number; savedAt: number }[];
  /** 新しい版・移行の失敗の枠がある（触らない） */
  hold: boolean;
}

function inspect(raws: Raws): Side {
  const valid: Side['valid'] = [];
  let hold = false;
  for (const [key, raw] of raws) {
    const r = decodeSave(raw);
    if (r.ok) valid.push({ key, raw, seq: r.env.seq, savedAt: r.env.savedAt });
    else if (r.reason === 'newer' || r.reason === 'migrateFailed') hold = true;
  }
  valid.sort((x, y) => y.seq - x.seq || y.savedAt - x.savedAt);
  return { raws, valid, hold };
}

/**
 * 負けた側を 1 つだけ退避する（有効な枠があれば SUPERSEDED_KEY、壊れた枠しかなければ BROKEN_KEY）。
 * 書いて読み戻し、一致したら退避したキーと前の値を返す（後で取り消すため。退避するものがなければ null）。書けない・合わない・
 * 例外なら、そのキーを元の値に戻して false（PR #89 のレビュー S-2: 退避は負けた側の唯一の控えになるので、成否を見てから元の枠を変える）
 */
function backUp(to: KeyValueStore, loser: Side): { key: string; prev: string | null } | null | false {
  const best = loser.valid[0];
  const entry: [string, string] | null = best ? [SUPERSEDED_KEY, best.raw] : loser.raws[0] ? [BROKEN_KEY, loser.raws[0][1]] : null;
  if (!entry) return null;
  const [key, value] = entry;
  let prev: string | null;
  try {
    prev = read(to, key);
  } catch {
    return false;
  }
  try {
    if (to.set(key, value) && read(to, key) === value) return { key, prev };
  } catch {
    /* 下で戻す */
  }
  try {
    if (prev === null) to.remove(key);
    else to.set(key, prev);
  } catch {
    /* 無視 */
  }
  return false;
}

/** 今の保存先の 2 枠を元の値に戻す（取り消し）。例外は無視する */
function restore(to: KeyValueStore, before: Map<string, string | null>): void {
  for (const [k, v] of before) {
    try {
      if (v === null) to.remove(k);
      else to.set(k, v);
    } catch {
      /* 無視 */
    }
  }
}

/**
 * @returns none: 以前の保存先に枠がない／moved: 今の保存先が空なので移して以前の枠を消した／
 *          replaced: 両方にあり、以前の保存先のほうが新しいので今の保存先に写して以前の枠を消した（BL-115）／
 *          kept: 両方にあり、今の保存先を残して以前の枠を消した／held: 両方にあるが何も変えなかった（新しい版・移行の失敗の枠・
 *          有効な枠がない・kept で退避できない）／
 *          failed: 読めない・書けない・読み戻しが合わない（以前の枠は消さず、今の保存先は元に戻す）
 */
export function moveLegacySlots(from: KeyValueStore, to: KeyValueStore): LegacyMove {
  const before = new Map<string, string | null>();
  try {
    const old: Raws = [];
    for (const k of KEYS) {
      const v = read(from, k);
      if (v !== null) old.push([k, v]);
    }
    if (old.length === 0) return 'none';
    const cur: Raws = [];
    for (const k of KEYS) {
      const v = read(to, k);
      before.set(k, v);
      if (v !== null) cur.push([k, v]);
    }
    let result: LegacyMove;
    let copy: Raws;
    let loser: Side | null = null;
    if (cur.length === 0) {
      result = 'moved';
      copy = old; // 今までどおり、検証せずにそのまま写す（読み込みの検証は slots.ts）
    } else {
      const legacy = inspect(old);
      const current = inspect(cur);
      const l = legacy.valid[0];
      const c = current.valid[0];
      if (legacy.hold || current.hold || (!l && !c)) return 'held';
      const legacyWins = !!l && (!c || l.seq > c.seq || (l.seq === c.seq && l.savedAt > c.savedAt));
      if (legacyWins) {
        result = 'replaced';
        copy = legacy.valid.map((v): [string, string] => [v.key, v.raw]); // 壊れた枠は写さない
        loser = current;
      } else {
        result = 'kept';
        copy = [];
        loser = legacy;
      }
    }
    // 退避を先に行う。できなければ元の枠を変えない（replaced は failed で次の起動にやり直す。kept は以前の枠を残す。
    // kept で残すと症状 (b) は残りうるが、進行が消えるよりよい。PR #89 のレビュー S-2）
    if (loser) {
      const b = backUp(to, loser);
      if (b === false) return result === 'replaced' ? 'failed' : 'held';
      if (b) before.set(b.key, b.prev); // 後で写しに失敗したら、退避も元に戻す
    }
    if (copy.length > 0) {
      const keep = new Set(copy.map(([k]) => k));
      for (const [k, v] of copy) {
        if (!to.set(k, v) || read(to, k) !== v) throw new Error('write-back mismatch');
      }
      // 写さなかった今の保存先の枠（負けた側の古い枠）は消す。残すと 2 枠の seq が混ざる
      for (const k of KEYS) if (!keep.has(k) && before.get(k) !== null) to.remove(k);
    }
    for (const [k] of old) from.remove(k);
    return result;
  } catch {
    restore(to, before); // 途中まで書いた枠を取り消す（片方だけ移った状態を残さない）
    return 'failed';
  }
}
