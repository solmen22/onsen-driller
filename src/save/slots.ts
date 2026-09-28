// 2 枠保存（arch §11 の「2 枠の規則」・Q-11。BL-027）。ストレージは platform.storage を受け取る（DOM に触らない）
// 1. 空のストレージの最初の保存は a・seq 1。以後「今の正（最後に有効と確かめた枠）」と反対の枠に、seq＝有効な枠の最大の seq＋1 で書く
// 2. 起動時は両方の枠を検証し、有効なうち seq の大きいほう（同じなら savedAt の新しいほう、それも同じなら a）を使う。
//    seq の大きいほうが壊れていたら有効なほうから復元し、次は壊れていた枠に書く（1. の規則でそうなる）
// 3. 書いた直後に読み戻し、合わなければその枠は無効のまま・正は元の枠。次の保存も同じ枠に同じ seq でやり直す
// 4. 両方の枠が壊れていたら新しいゲーム。壊れていた生の文字列を 1 つだけ save:broken に退避してから、a から書く
// 5. どちらかの枠が新しい版（newer）なら読み取り専用（そのセッションは書かない）
// 保存の状態: ok ／ failing（書き込みか読み戻しの失敗。次の保存で再試行）／ unavailable（起動時からメモリだけ。再試行しない）
import type { GameState } from '../core/index.ts';
import type { KeyValueStore } from '../platform/types.ts';
import { decodeSave, encodeSave, type DecodeFail } from './codec.ts';

export const SAVE_KEYS = { a: 'onsen-driller:save:a', b: 'onsen-driller:save:b' } as const;
export const BROKEN_KEY = 'onsen-driller:save:broken';

export type SlotId = 'a' | 'b';
export type SaveStatus = 'ok' | 'failing' | 'unavailable';
/** 起動時に読んだ枠の結果 */
export type SlotReport = 'empty' | 'ok' | DecodeFail;

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

export class SaveSlots {
  private readonly storage: KeyValueStore;
  private readonly opts: SaveSlotsOptions;
  /** 有効と確かめた枠の seq（無効・未確認は null） */
  private readonly valid: Record<SlotId, number | null> = { a: null, b: null };
  /** 今の正（最後に有効と確かめた枠） */
  private current: SlotId | null = null;
  private statusValue: SaveStatus;
  private readOnlyValue = false;
  /** 書いた回数（テスト・記録用） */
  writes = 0;

  constructor(storage: KeyValueStore, opts: SaveSlotsOptions) {
    this.storage = storage;
    this.opts = opts;
    this.statusValue = opts.unavailable ? 'unavailable' : 'ok';
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

  private read(slot: SlotId): string | null {
    try {
      return this.storage.get(SAVE_KEYS[slot]);
    } catch {
      return null;
    }
  }

  /** 起動時の読み込み（両方の枠を検証する）。例外を投げない */
  load(): LoadResult {
    const raws: Record<SlotId, string | null> = { a: this.read('a'), b: this.read('b') };
    const report: Record<SlotId, SlotReport> = { a: 'empty', b: 'empty' };
    const found: { slot: SlotId; state: GameState; seq: number; savedAt: number; corrected: string[] }[] = [];
    for (const slot of ['a', 'b'] as const) {
      const raw = raws[slot];
      if (raw === null) continue;
      const r = decodeSave(raw);
      if (r.ok) {
        report[slot] = 'ok';
        this.valid[slot] = r.env.seq;
        found.push({ slot, state: r.state, seq: r.env.seq, savedAt: r.env.savedAt, corrected: r.corrected });
      } else {
        report[slot] = r.reason;
        if (r.reason === 'newer') this.readOnlyValue = true;
      }
    }
    found.sort((x, y) => y.seq - x.seq || y.savedAt - x.savedAt || (x.slot === 'a' ? -1 : 1));
    const best = found[0];
    const brokenBoth = !best && (['a', 'b'] as const).some((s) => report[s] !== 'empty' && report[s] !== 'newer');
    if (brokenBoth && !this.readOnlyValue && this.statusValue !== 'unavailable') {
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
   * 読み取り専用・unavailable のときは書かずに false。例外を投げない
   */
  save(state: GameState): boolean {
    if (this.readOnlyValue || this.statusValue === 'unavailable') return false;
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
