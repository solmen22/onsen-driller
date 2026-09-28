// 状態の持ち主と通知（arch §7）。UI へは 5Hz か dispatch の直後に通知し、描画へはイベントの列を渡す
import { dispatch, type Action, type ActionResult, type GameEvent, type GameState } from '../core/index.ts';

export type ViewEvent = GameEvent | { type: 'Hits'; n: number; fromTap: boolean };

export class GameStore {
  state: GameState;
  version = 0;
  private readonly subs = new Set<() => void>();
  private viewQueue: ViewEvent[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  dispatch(a: Action): ActionResult {
    const hitsBefore = this.state.stats.hits;
    const r = dispatch(this.state, a);
    const hits = this.state.stats.hits - hitsBefore;
    if (hits > 0) this.viewQueue.push({ type: 'Hits', n: hits, fromTap: a.type === 'tap' });
    this.pushEvents(r.events);
    this.notify();
    return r;
  }

  pushEvents(evs: readonly ViewEvent[]): void {
    for (const e of evs) this.viewQueue.push(e);
    if (this.viewQueue.length > 500) this.viewQueue.splice(0, this.viewQueue.length - 500);
  }

  /** 描画が毎フレーム呼ぶ。たまったイベントを受け取って空にする */
  drainView(): ViewEvent[] {
    const q = this.viewQueue;
    this.viewQueue = [];
    return q;
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  notify(): void {
    this.version++;
    for (const fn of this.subs) fn();
  }
}
