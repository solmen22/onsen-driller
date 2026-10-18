// トーストの並び（BL-046。Q-37 (c)。TS-046-08・11）
// - 同時に最大 3 つ。それぞれ出てから 2 秒で消える。4 つ目以降は待ち行列に入り、空きができたら来た順に出る（どれも 2 秒は見える）
// - 同じ種類・同じ中身（kind と key が同じ）が待ち行列にあれば重ねて足さない
// ブラウザがなくても確かめられるように、タイマーを引数で受け取る
export type ToastKind = 'guest' | 'save' | 'achievement' | 'ad';

export interface Toast {
  id: number;
  kind: ToastKind;
  /** 重ねて足さないための中身の名前（例 お客さんの ID） */
  key: string;
  /** 表示に使う値（文言は表示のときに引く。言語の切り替えに追いつくため） */
  data: Readonly<Record<string, string | number | boolean>>;
}

export interface ToastTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const TOAST_MS = 2000;
export const TOAST_MAX = 3;

const defaultTimers: ToastTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

export class ToastQueue {
  private shown: Toast[] = [];
  private waiting: Toast[] = [];
  private readonly timers: ToastTimers;
  private readonly onChange: (visible: readonly Toast[]) => void;
  private readonly handles = new Map<number, unknown>();
  private nextId = 1;

  constructor(onChange: (visible: readonly Toast[]) => void, timers: ToastTimers = defaultTimers) {
    this.onChange = onChange;
    this.timers = timers;
  }

  get visible(): readonly Toast[] {
    return this.shown;
  }

  get pending(): readonly Toast[] {
    return this.waiting;
  }

  push(kind: ToastKind, key: string, data: Toast['data'] = {}): void {
    if (this.waiting.some((x) => x.kind === kind && x.key === key)) return;
    const toast: Toast = { id: this.nextId++, kind, key, data };
    if (this.shown.length < TOAST_MAX) this.show(toast);
    else this.waiting.push(toast);
  }

  dispose(): void {
    for (const h of this.handles.values()) this.timers.clearTimeout(h);
    this.handles.clear();
    this.shown = [];
    this.waiting = [];
  }

  private show(toast: Toast): void {
    this.shown = [...this.shown, toast];
    this.handles.set(
      toast.id,
      this.timers.setTimeout(() => this.expire(toast.id), TOAST_MS),
    );
    this.onChange(this.shown);
  }

  private expire(id: number): void {
    this.handles.delete(id);
    this.shown = this.shown.filter((x) => x.id !== id);
    const next = this.waiting.shift();
    if (next) this.show(next);
    else this.onChange(this.shown);
  }
}
