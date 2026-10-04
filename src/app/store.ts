// 状態の持ち主と通知（arch §7。BL-010）。
// - UI へは 200ms（5Hz）ごと（ループが tick を呼ぶ）か dispatch の直後に通知する
// - 描画へはイベントの列（drainView）を渡す。テスト用フックへは直近のイベント（events）を残す
import {
  advance,
  dispatch,
  stampGuestsSeen,
  step,
  type AdvanceOptions,
  type ActionResult,
  type GameEvent,
  type GameState,
} from '../core/index.ts';

/** 描画だけが使う一時的なイベント（打撃の数。タップ由来かどうかで反応の計測をする） */
export type ViewEvent = GameEvent | { type: 'Hits'; n: number; fromTap: boolean };

export interface StoreOptions {
  /** UI へ通知する間隔（既定 200ms） */
  uiIntervalMs?: number;
  /** 購読者が投げた例外の受け取り先（既定は console.error） */
  onError?: (e: unknown) => void;
}

/** テスト用フックの events() が返す件数の既定と、保持する件数（Q-16） */
export const EVENTS_DEFAULT_LIMIT = 100;
export const EVENTS_KEEP = 500;
const VIEW_QUEUE_MAX = 500;
/** 通知の時刻の比較の許容（ms。loop.ts の TIME_EPS_MS と同じ値） */
const NOTIFY_EPS_MS = 1e-6;

export class GameStore {
  state: GameState;
  /** 通知のたびに 1 増える */
  version = 0;
  /** ループがステップを進めた回数と、最後に進めたフレームの単調時計（描画の補間用） */
  stepSerial = 0;
  lastStepAt = 0;
  /** 保存の状態（app/autosave が更新する。UI の save-warning。ok 以外の間は表示する） */
  saveStatus: 'ok' | 'failing' | 'unavailable' = 'ok';
  private readonly subs = new Set<() => void>();
  /** ドメインイベントの購読者（onEvents） */
  private readonly eventSubs = new Set<(evs: readonly GameEvent[]) => void>();
  private viewQueue: ViewEvent[] = [];
  private readonly recent: GameEvent[] = [];
  private readonly uiIntervalMs: number;
  private readonly onError: (e: unknown) => void;
  private nextNotifyAt: number | null = null;
  /** 壁時計（初来訪の時刻を図鑑に入れる。startLoop が app の時計をつなぐ。つながっていなければ時刻は 0＝不明のまま） */
  private wallNow: (() => number) | null = null;

  constructor(state: GameState, opts: StoreOptions = {}) {
    this.state = state;
    this.uiIntervalMs = opts.uiIntervalMs ?? 200;
    this.onError = opts.onError ?? ((e) => console.error(e));
  }

  /** アクションを実行し、すぐに通知する */
  dispatch(a: unknown): ActionResult {
    const hitsBefore = this.state.stats.hits;
    const r = dispatch(this.state, a);
    const hits = this.state.stats.hits - hitsBefore;
    if (hits > 0) this.pushView({ type: 'Hits', n: hits, fromTap: true });
    this.pushEvents(r.events);
    this.notify();
    return r;
  }

  /** ループから: 固定ステップを 1 回進める（通知は tick でまとめて行う） */
  step(dtMs: number, nowMono?: number): GameEvent[] {
    const hitsBefore = this.state.stats.hits;
    const evs = step(this.state, dtMs, []);
    const hits = this.state.stats.hits - hitsBefore;
    if (hits > 0) this.pushView({ type: 'Hits', n: hits, fromTap: false });
    this.pushEvents(evs);
    this.stepSerial++;
    if (nowMono !== undefined) this.lastStepAt = nowMono;
    return evs;
  }

  /** テスト用フック・オフラインから: ロジックだけを進め、起きたイベントを返す */
  advance(ms: number, opts: Omit<AdvanceOptions, 'out'> = {}): GameEvent[] {
    const hitsBefore = this.state.stats.hits;
    const evs = advance(this.state, ms, { ...opts, out: [] });
    const hits = this.state.stats.hits - hitsBefore;
    if (hits > 0) this.pushView({ type: 'Hits', n: hits, fromTap: false });
    this.pushEvents(evs);
    this.stepSerial++;
    this.notify();
    return evs;
  }

  /** 状態を差し替える（読み込み・テスト用フックの seed・setState）。描画の列は捨てる */
  replaceState(s: GameState): void {
    this.state = s;
    this.viewQueue = [];
    this.stepSerial++;
    this.notify();
  }

  /** ループが毎フレーム呼ぶ。200ms ごとに通知する（固定の間隔。遅れたら次の間隔から数え直す） */
  tick(nowMono: number): void {
    if (this.nextNotifyAt === null) {
      this.nextNotifyAt = nowMono + this.uiIntervalMs;
      return;
    }
    // 足し合わせたフレーム時刻の浮動小数の誤差で 200ms にわずかに届かないことがあるので、1ns の許容を入れる
    if (nowMono + NOTIFY_EPS_MS < this.nextNotifyAt) return;
    this.nextNotifyAt += this.uiIntervalMs;
    if (nowMono >= this.nextNotifyAt) this.nextNotifyAt = nowMono + this.uiIntervalMs;
    this.notify();
  }

  /** 壁時計をつなぐ（app/loop.ts の startLoop が app の時計で呼ぶ。テスト用フックの setClock もこの時計に効く） */
  useWallClock(wallNow: () => number): void {
    this.wallNow = wallNow;
  }

  /** イベントを記録する（描画の列・フックの events）。お客さんの初来訪があれば、その時刻を図鑑に入れる（BL-017） */
  pushEvents(evs: readonly GameEvent[]): void {
    if (this.wallNow && evs.some((e) => e.type === 'GuestArrived' && e.first)) stampGuestsSeen(this.state, evs, this.wallNow());
    for (const e of evs) {
      this.pushView(e);
      this.recent.push(e);
    }
    if (this.recent.length > EVENTS_KEEP) this.recent.splice(0, this.recent.length - EVENTS_KEEP);
    if (evs.length === 0) return;
    for (const fn of this.eventSubs) {
      try {
        fn(evs);
      } catch (e) {
        this.onError(e);
      }
    }
  }

  /**
   * 起きたドメインイベントを受け取る（ステップ・アクション・フックの付与のたびに、起きた順の配列で呼ぶ）。
   * app の副作用（CrazyGames の happytime など。BL-057）に使う。1 つが例外を投げても、ほかには届ける。戻り値で購読をやめる
   */
  onEvents(fn: (evs: readonly GameEvent[]) => void): () => void {
    this.eventSubs.add(fn);
    return () => this.eventSubs.delete(fn);
  }

  private pushView(e: ViewEvent): void {
    this.viewQueue.push(e);
    if (this.viewQueue.length > VIEW_QUEUE_MAX) this.viewQueue.splice(0, this.viewQueue.length - VIEW_QUEUE_MAX);
  }

  /** 保存の状態を変えて通知する（変わらなければ何もしない） */
  setSaveStatus(st: 'ok' | 'failing' | 'unavailable'): void {
    if (this.saveStatus === st) return;
    this.saveStatus = st;
    this.notify();
  }

  /** 描画が毎フレーム呼ぶ。たまったイベントを受け取って空にする */
  drainView(): ViewEvent[] {
    const q = this.viewQueue;
    this.viewQueue = [];
    return q;
  }

  /** 直近のイベント（古い順。最後が最新）。テスト用フックの events(limit) */
  events(limit: number = EVENTS_DEFAULT_LIMIT): GameEvent[] {
    const n = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : EVENTS_DEFAULT_LIMIT;
    return n === 0 ? [] : this.recent.slice(-n);
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  /** 購読者へ通知する（1 つが例外を投げても、ほかには届ける） */
  notify(): void {
    this.version++;
    for (const fn of this.subs) {
      try {
        fn();
      } catch (e) {
        this.onError(e);
      }
    }
  }
}
