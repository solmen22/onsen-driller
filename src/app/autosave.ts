// 保存の契機（arch §11・Q-11。BL-027）: 15 秒ごと、visibilitychange（hidden）、pagehide、転生の後・広告の前（saveNow）。
// - 録画モード・読み取り専用のときは保存しない（isSuppressed）
// - 保存は同期の 1 回の処理。処理中に別の保存が求められたら、終わった後に 1 回だけ行う（途中に割り込まない。TS-027-16）
// - hidden と pagehide が続けて来たら 2 回書く（内容が同じでも省かない）
// ブラウザがなくても確かめられるように、EventTarget とタイマーを引数で受け取る（tests/integration/autosave.test.ts）
import type { GameState } from '../core/index.ts';
import type { SaveSlots, SaveStatus } from '../save/slots.ts';

export type SaveReason = 'interval' | 'hidden' | 'pagehide' | 'prestige' | 'ad' | 'manual';

export interface AutosaveTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface AutosaveDeps {
  slots: Pick<SaveSlots, 'save' | 'status'>;
  getState: () => GameState;
  /** pagehide を受ける（window） */
  win: EventTarget;
  /** visibilitychange を受ける（document） */
  doc: EventTarget & { readonly hidden?: boolean; readonly visibilityState?: string };
  timers?: AutosaveTimers;
  intervalMs?: number;
  /** 録画モード・読み取り専用など、保存しない条件 */
  isSuppressed?: () => boolean;
  /** 保存の状態が変わった（UI の save-warning） */
  onStatus?: (s: SaveStatus) => void;
  /** 保存を試みた（記録・テスト用） */
  onSave?: (reason: SaveReason, ok: boolean) => void;
}

export interface Autosave {
  /** すぐ保存する（転生の後・広告の前など）。保存しなかったら false */
  saveNow(reason: SaveReason): boolean;
  dispose(): void;
}

export const AUTOSAVE_INTERVAL_MS = 15_000;

const defaultTimers: AutosaveTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof globalThis.setInterval>),
};

export function startAutosave(d: AutosaveDeps): Autosave {
  const timers = d.timers ?? defaultTimers;
  let saving = false;
  let pending: SaveReason | null = null;
  let lastStatus: SaveStatus = d.slots.status;

  const run = (reason: SaveReason): boolean => {
    if (d.isSuppressed?.()) return false;
    if (saving) {
      pending = reason; // 終わった後に 1 回だけ
      return false;
    }
    saving = true;
    let ok = false;
    try {
      let r: SaveReason | null = reason;
      while (r !== null) {
        pending = null;
        ok = d.slots.save(d.getState());
        d.onSave?.(r, ok);
        const st = d.slots.status;
        if (st !== lastStatus) {
          lastStatus = st;
          d.onStatus?.(st);
        }
        r = pending;
      }
    } catch {
      ok = false; // 保存の失敗はゲームを止めない
    } finally {
      saving = false;
    }
    return ok;
  };

  const interval = timers.setInterval(() => run('interval'), d.intervalMs ?? AUTOSAVE_INTERVAL_MS);
  const onVisibility = (): void => {
    if (d.doc.hidden === true || d.doc.visibilityState === 'hidden') run('hidden');
  };
  const onPageHide = (): void => {
    run('pagehide');
  };
  d.doc.addEventListener('visibilitychange', onVisibility);
  d.win.addEventListener('pagehide', onPageHide);

  return {
    saveNow: run,
    dispose() {
      timers.clearInterval(interval);
      d.doc.removeEventListener('visibilitychange', onVisibility);
      d.win.removeEventListener('pagehide', onPageHide);
    },
  };
}
