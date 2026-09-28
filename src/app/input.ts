// 入力（arch §7。Q-04・Q-05。BL-012）: ステージの DOM のポインタとキーボードを受けてアクションにする。Phaser の入力系は使わない
// - 押した瞬間に 1 打（タップ）。300ms 押し続けると長押し（毎秒 4 打）。Space も同じ（自動リピートの keydown は使わない）
// - 長押しは pointerup・pointercancel・pointerleave・lostpointercapture、ウィンドウの blur、visibilitychange（hidden）、
//   pagehide、Space の keyup、入力の無効化（広告の再生中）で終わる。長押しのタイマーも取り消す
// - 押し始めたポインタ以外（2 本目の指など。isPrimary=false）は打撃にしない。長押しは押し始めたポインタの終わりだけで終える（N-8）
// - Space と矢印キーは、編集できる要素（input・textarea・select・contenteditable）が対象のとき以外は必ず preventDefault する。
//   フォーカスのあるボタンも Space では押さない（キーボードでボタンを押すのは Enter）
// - Ctrl・Alt・Meta と組み合わせたキーは、掘削にも preventDefault にも使わない（ブラウザ・OS のショートカット）
// ブラウザがなくても確かめられるように、EventTarget と タイマーを引数で受け取る（tests/integration/input.test.ts）
import { PARAMS } from '../content/params.ts';

export interface InputSink {
  dispatch(a: { type: 'tap'; count: number } | { type: 'hold'; on: boolean }): unknown;
}

export interface InputTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface InputEnv {
  /** ステージ（キャンバスの親要素）。ここのポインタで掘る（地上を含むキャンバス全体。Q-04(f)） */
  stage: EventTarget;
  /** キーボード・blur・pagehide を受ける（window） */
  win: EventTarget;
  /** visibilitychange を受ける（document）。hidden か visibilityState で非表示を判定する */
  doc: EventTarget & { readonly hidden?: boolean; readonly visibilityState?: string };
  timers?: InputTimers;
}

export interface InputOptions {
  /** 最初の入力（ステージでも UI のパネルでも。Poki の gameplayStart。S2 の lifecycle へ） */
  onFirstInput?: () => void;
  /** 打撃にした押下の時刻（性能の計測用。event.timeStamp） */
  onPress?: (timeStamp: number) => void;
  holdDelayMs?: number;
}

export interface InputController {
  /** 入力を止める（広告の再生中など）。止めると長押しも終わる */
  setEnabled(on: boolean): void;
  readonly holding: boolean;
  dispose(): void;
}

const defaultTimers: InputTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

interface KeyLike {
  code?: string;
  repeat?: boolean;
  target?: unknown;
  timeStamp?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  preventDefault(): void;
}
interface PointerLike {
  isPrimary?: boolean;
  pointerId?: number;
  timeStamp?: number;
  preventDefault(): void;
}

/** Ctrl・Alt・Meta（⌘）と組み合わせたキーか（ブラウザ・OS のショートカットなので、掘削にも preventDefault にも使わない） */
const withModifier = (e: KeyLike): boolean => e.ctrlKey === true || e.altKey === true || e.metaKey === true;

/** 編集できる要素か（そこでは Space・矢印を扱わない。Q-05） */
export function isEditableTarget(t: unknown): boolean {
  if (typeof t !== 'object' || t === null) return false;
  const el = t as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const isHidden = (doc: InputEnv['doc']): boolean => doc.hidden === true || doc.visibilityState === 'hidden';

export function setupInput(env: InputEnv, sink: InputSink, opts: InputOptions = {}): InputController {
  const timers = env.timers ?? defaultTimers;
  const holdDelayMs = opts.holdDelayMs ?? PARAMS.input.holdDelayMs;
  let enabled = true;
  let first = true;
  let holdTimer: unknown = null;
  let holding = false;
  let keyDown = false;
  /** 長押しを始めたポインタ（その終わりだけで長押しを終える。2 本目の指を離しても終えない。レビュー N-8） */
  let activePointer: number | null = null;
  const offs: (() => void)[] = [];
  const on = <E>(t: EventTarget, type: string, fn: (e: E) => void, capture = false): void => {
    const h = (e: Event): void => fn(e as unknown as E);
    t.addEventListener(type, h, capture);
    offs.push(() => t.removeEventListener(type, h, capture));
  };

  const firstInput = (): void => {
    if (!first) return;
    first = false;
    opts.onFirstInput?.();
  };
  const endHold = (): void => {
    if (holdTimer !== null) {
      timers.clearTimeout(holdTimer);
      holdTimer = null;
    }
    keyDown = false;
    if (holding) {
      holding = false;
      sink.dispatch({ type: 'hold', on: false });
    }
  };
  const press = (timeStamp: number | undefined): void => {
    firstInput();
    if (timeStamp !== undefined) opts.onPress?.(timeStamp);
    sink.dispatch({ type: 'tap', count: 1 });
    if (holding) return; // すでに長押し中（別の手段で押した）
    if (holdTimer !== null) timers.clearTimeout(holdTimer);
    holdTimer = timers.setTimeout(() => {
      holdTimer = null;
      if (!enabled) return;
      holding = true;
      sink.dispatch({ type: 'hold', on: true });
    }, holdDelayMs);
  };

  on<PointerLike>(env.stage, 'pointerdown', (e) => {
    if (!enabled || e.isPrimary === false) return;
    e.preventDefault();
    activePointer = typeof e.pointerId === 'number' ? e.pointerId : null;
    press(e.timeStamp);
  });
  const endPointer = (e: PointerLike): void => {
    if (activePointer !== null && typeof e.pointerId === 'number' && e.pointerId !== activePointer) return; // ほかの指の終わり
    activePointer = null;
    endHold();
  };
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) on<PointerLike>(env.stage, type, endPointer);

  on<KeyLike>(env.win, 'keydown', (e) => {
    if (isEditableTarget(e.target)) return;
    const code = e.code ?? '';
    // Ctrl・Alt・Meta との組み合わせは掘削に使わず、ブラウザ・OS に任せる（PM の指摘。Ctrl+Space の入力切り替えなど）
    if (withModifier(e)) return;
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault(); // ポータルの枠をスクロールさせない
    if (code !== 'Space' || !enabled || e.repeat === true || keyDown) return;
    keyDown = true;
    press(e.timeStamp);
  });
  on<KeyLike>(env.win, 'keyup', (e) => {
    if (e.code !== 'Space') return;
    if (!isEditableTarget(e.target)) e.preventDefault(); // フォーカスのあるボタンを Space で押さない
    endHold();
  });
  on(env.win, 'blur', endHold);
  on(env.win, 'pagehide', endHold);
  on(env.doc, 'visibilitychange', () => {
    if (isHidden(env.doc)) endHold();
  });
  // UI のパネルを押したときも「最初の入力」とみなす
  on(env.win, 'pointerdown', firstInput, true);

  return {
    setEnabled(v) {
      enabled = v;
      if (!v) endHold();
    },
    get holding() {
      return holding;
    },
    dispose() {
      endHold();
      for (const off of offs.splice(0)) off();
    },
  };
}
