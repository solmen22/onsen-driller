// 2 枠保存（arch §11 の「2 枠の規則」・Q-11・Q-23。BL-027）。ストレージは platform.storage を受け取る（DOM に触らない）
// 1. 空のストレージの最初の保存は a・seq 1。以後「今の正（最後に有効と確かめた枠）」と反対の枠に、seq＝有効な枠の最大の seq＋1 で書く
// 2. 起動時は両方の枠を検証し、有効なうち seq の大きいほう（同じなら savedAt の新しいほう、それも同じなら a）を使う。
//    seq の大きいほうが壊れていたら有効なほうから復元し、次は壊れていた枠に書く（1. の規則でそうなる）
// 3. 書いた直後に読み戻し、合わなければその枠は無効のまま・正は元の枠。次の保存も同じ枠に同じ seq でやり直す
// 4. 両方の枠が壊れていたら新しいゲーム。壊れていた生の文字列を 1 つだけ save:broken に退避してから、a から書く
// 5. どちらかの枠が新しい版（newer）か、移行のコードが失敗した（migrateFailed。BL-028）なら読み取り専用（そのセッションは書かない）
// 6. 読めない枠（get が例外）が 1 つでもあれば、そのセッションは**どの枠にも書かない**（状態 unavailable。読み直さない）。
//    読めない枠を「空」とみなして新しいゲームで上書きしないため（レビュー S-1・Q-23）。有効なほうがあればそこから始める
// 保存の状態: ok ／ failing（書き込みか読み戻しの失敗。次の保存で再試行。起動時の試し書きが失敗した環境は起動時から）／
// unavailable（起動時からメモリだけ・読めない枠がある。そのセッションは再試行しない）
import type { GameState } from '../core/index.ts';
import type { KeyValueStore } from '../platform/types.ts';
import { decodeSave, encodeSave, type DecodeFail } from './codec.ts';

export const SAVE_KEYS = { a: 'onsen-driller:save:a', b: 'onsen-driller:save:b' } as const;
export const BROKEN_KEY = 'onsen-driller:save:broken';

export type SlotId = 'a' | 'b';

/** 読めない枠（保存先の例外）の印。「ない」（null）と区別する */
const UNREADABLE: unique symbol = Symbol('unreadable');
export type SaveStatus = 'ok' | 'failing' | 'unavailable';
/** 起動時に読んだ枠の結果（unreadable: 読み出しが例外。空とは区別する） */
export type SlotReport = 'empty' | 'ok' | 'unreadable' | DecodeFail;

export interface LoadResult {
  /** 読み込んだ状態（なければ null＝新しいゲーム） */
  state: GameState | null;
  /** 使った枠 */
  from: SlotId | null;
  slots: Record<SlotId, SlotReport>;
  /** 新しい版のセーブがあった（読み取り専用。案内の表示は S3 の BL-028） */
  readOnly: boolean;
  /** 両方の枠が壊れていたので新しいゲームにした（生の文字列を save:broken に退避。案内は S2 の BL-046） */
  brokenReset: boolean;
  /** 読み込みで直したフィールド */
  corrected: string[];
}

export interface SaveSlotsOptions {
  appVersion: string;
  /** 壁時計（savedAt。UTC の ms） */
  now: () => number;
  /** 起動時からストレージがない（メモリだけ）。状態は unavailable になり、書かない */
  unavailable?: boolean;
}

const OTHER: Record<SlotId, SlotId> = { a: 'b', b: 'a' };

/** 壊れた文字列から seq らしき値を拾う（退避する枠を選ぶだけに使う。読めなければ -1） */
function looseSeq(raw: string | null): number {
  if (!raw) return -1;
  const m = /"seq"\s*:\s*(\d{1,15})/.exec(raw.slice(0, 200));
  return m?.[1] ? Number(m[1]) : -1;
}

/** 読めたが検証に落ちた枠（空・有効・読めない・新しい版は含めない） */
const isBroken = (r: SlotReport): boolean => r !== 'empty' && r !== 'ok' && r !== 'unreadable' && r !== 'newer' && r !== 'migrateFailed';

export class SaveSlots {
  private readonly storage: KeyValueStore;
  private readonly opts: SaveSlotsOptions;
  /** 有効と確かめた枠の seq（無効・未確認は null） */
  private readonly valid: Record<SlotId, number | null> = { a: null, b: null };
  /** 今の正（最後に有効と確かめた枠） */
  private current: SlotId | null = null;
  private statusValue: SaveStatus;
  private readOnlyValue = false;
  /** load() を済ませたか（読む前に書くと既存のセーブを上書きするので、それまでは書かない。レビュー N-3） */
  private loaded = false;
  /** 書いた回数（テスト・記録用） */
  writes = 0;

  constructor(storage: KeyValueStore, opts: SaveSlotsOptions) {
    this.storage = storage;
    this.opts = opts;
    // 起動時の試し書きが失敗した（読めるが書けない。V2・V4）なら、起動時から failing（案内を出し、15 秒ごとに再試行。S-2）
    this.statusValue = opts.unavailable ? 'unavailable' : storage.writeProbe === 'failed' ? 'failing' : 'ok';
  }

  get status(): SaveStatus {
    return this.statusValue;
  }
  get readOnly(): boolean {
    return this.readOnlyValue;
  }
  /** 次に書く枠と seq（テスト・記録用） */
  nextTarget(): { slot: SlotId; seq: number } {
    const slot: SlotId = this.current === null ? 'a' : OTHER[this.current];
    const max = Math.max(this.valid.a ?? 0, this.valid.b ?? 0);
    return { slot, seq: Math.min(Number.MAX_SAFE_INTEGER, max + 1) };
  }

  /**
   * 枠を読む（ない → null、読めない〔例外〕→ UNREADABLE）。文字列以外（「ない」を undefined で返す保存先）は null にそろえる
   * （以前は例外の印に undefined を使っていたので、undefined を返す保存先では空の枠が「読めない」になり保存が止まった。S1 再レビュー A-N1）
   */
  private read(slot: SlotId): string | null | typeof UNREADABLE {
    try {
      const v: unknown = this.storage.get(SAVE_KEYS[slot]);
      return typeof v === 'string' ? v : null;
    } catch {
      return UNREADABLE;
    }
  }

  /** 起動時の読み込み（両方の枠を検証する）。例外を投げない */
  load(): LoadResult {
    this.loaded = true;
    const raws: Record<SlotId, string | null> = { a: null, b: null };
    const report: Record<SlotId, SlotReport> = { a: 'empty', b: 'empty' };
    const found: { slot: SlotId; state: GameState; seq: number; savedAt: number; corrected: string[] }[] = [];
    for (const slot of ['a', 'b'] as const) {
      const raw = this.read(slot);
      if (raw === UNREADABLE) {
        report[slot] = 'unreadable';
        continue;
      }
      raws[slot] = raw;
      if (raw === null) continue;
      const r = decodeSave(raw);
      if (r.ok) {
        report[slot] = 'ok';
        this.valid[slot] = r.env.seq;
        found.push({ slot, state: r.state, seq: r.env.seq, savedAt: r.env.savedAt, corrected: r.corrected });
      } else {
        report[slot] = r.reason;
        if (r.reason === 'newer' || r.reason === 'migrateFailed') this.readOnlyValue = true; // 移行の失敗もこちらの誤り。直したビルドで読めるよう上書きしない（PR #87 のレビュー S-1）
      }
    }
    // 読めない枠がある: そのセッションはどの枠にも書かない（seq の大小が分からず、新しい控えかもしれない。Q-23）
    const unreadable = report.a === 'unreadable' || report.b === 'unreadable';
    if (unreadable) this.statusValue = 'unavailable';
    found.sort((x, y) => y.seq - x.seq || y.savedAt - x.savedAt || (x.slot === 'a' ? -1 : 1));
    const best = found[0];
    // 読み取り専用（新しい版がある）・読めない枠があるときは「壊れていたので新しく始めた」ではない（退避もしない。レビュー N-4）
    const brokenBoth = !best && !this.readOnlyValue && !unreadable && (['a', 'b'] as const).some((s) => isBroken(report[s]));
    if (brokenBoth && this.statusValue !== 'unavailable') {
      // 上書きする前に、壊れていた生の文字列のうち seq の大きそうなほう（読めなければ a）を 1 つだけ退避する
      const pick: SlotId = looseSeq(raws.b) > looseSeq(raws.a) || raws.a === null ? 'b' : 'a';
      const raw = raws[pick];
      if (raw !== null) {
        try {
          this.storage.set(BROKEN_KEY, raw); // 容量不足なら諦める
        } catch {
          /* 無視 */
        }
      }
    }
    this.current = best?.slot ?? null;
    return {
      state: best?.state ?? null,
      from: best?.slot ?? null,
      slots: report,
      readOnly: this.readOnlyValue,
      brokenReset: brokenBoth,
      corrected: best?.corrected ?? [],
    };
  }

  /**
   * 保存する（1 回の同期の処理）。書いた直後に読み戻して一致を確かめる。
   * 読み込みの前・読み取り専用・unavailable のときは書かずに false。例外を投げない
   */
  save(state: GameState): boolean {
    if (!this.loaded || this.readOnlyValue || this.statusValue === 'unavailable') return false;
    const { slot, seq } = this.nextTarget();
    let text: string;
    try {
      text = encodeSave(state, seq, this.opts.now(), this.opts.appVersion);
    } catch {
      this.statusValue = 'failing';
      return false;
    }
    let ok: boolean;
    try {
      this.writes++;
      ok = this.storage.set(SAVE_KEYS[slot], text) && this.storage.get(SAVE_KEYS[slot]) === text;
    } catch {
      ok = false;
    }
    if (ok) {
      this.valid[slot] = seq;
      this.current = slot;
      this.statusValue = 'ok';
    } else {
      // 書いた枠は無効のまま。正は元の枠（次も同じ枠に同じ seq でやり直す）
      this.valid[slot] = null;
      this.statusValue = 'failing';
    }
    return ok;
  }
}
