// 入力（arch §7。Q-04・Q-05。BL-012）: ステージの DOM のポインタとキーボードを受けてアクションにする。Phaser の入力系は使わない
// - 押した瞬間に 1 打（タップ）。300ms 押し続けると長押し（毎秒 4 打）。Space も同じ（自動リピートの keydown は使わない）
// - 長押しは pointerup・pointercancel・pointerleave・lostpointercapture、ウィンドウの blur、visibilitychange（hidden）、
//   pagehide、Space の keyup、入力の無効化（広告の再生中）で終わる。長押しのタイマーも取り消す
// - 押し始めたポインタ以外（2 本目の指など。isPrimary=false）は打撃にしない。長押しは押し始めたポインタの終わりだけで終える（N-8）
// - Space と矢印キーは、編集できる要素（input・textarea・select・contenteditable）が対象のとき以外は必ず preventDefault する。
//   フォーカスのあるボタンも Space では押さない（キーボードでボタンを押すのは Enter）
// - Ctrl・Alt・Meta と組み合わせたキーは、掘削にも preventDefault にも使わない（ブラウザ・OS のショートカット）
// - ステージの pointerdown は preventDefault するので、互換の mousedown とその既定の動作（押したフレームへのフォーカスの移動・
//   フォーカスのある要素からフォーカスを外す）が起きない。これを自分で行う（BUG-1・BL-100。ポータルの iframe の中でステージを押した後の
//   Space・矢印キーが親ページに届いてスクロールし、掘れなかった）
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
  /** キーボード・blur・pagehide を受ける（window）。ステージを押したら focus() で押した枠にフォーカスを移す（BUG-1） */
  win: EventTarget & { focus?: () => void };
  /**
   * visibilitychange を受ける（document）。hidden か visibilityState で非表示を判定する。
   * ステージを押したら activeElement（body 以外）からフォーカスを外す（BUG-1）
   */
  doc: EventTarget & { readonly hidden?: boolean; readonly visibilityState?: string; readonly activeElement?: unknown; readonly body?: unknown };
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

/**
 * ステージを押したときに、ブラウザの mousedown の既定の動作と同じフォーカスの移動を行う（BUG-1）。
 * 1. window.focus(): 押した枠（ポータルの iframe）にフォーカスを移す。以後のキーはゲームに届き、preventDefault できる。
 *    利用者の操作（pointerdown）の中で呼ぶので、別オリジンの iframe でも許される。Phaser の autoFocus と同じ
 *    （Phaser は mousedown・touchstart で window.focus() を呼ぶ。本作は Phaser の入力を使わない）
 * 2. フォーカスのある要素（HUD のボタンなど。body 以外）からフォーカスを外す（押した後の Enter でボタンを押さない。
 *    読み込みのテキスト欄〔S3 の BL-029〕にフォーカスがあっても、ステージを押せば Space で掘れる）
 * どちらも失敗してよい（掘削は続ける）
 */
function focusGame(env: InputEnv): void {
  try {
    env.win.focus?.();
  } catch {
    // フォーカスを移せない環境でも掘削は続ける
  }
  const active = env.doc.activeElement as { blur?: unknown } | null | undefined;
  if (typeof active !== 'object' || active === null || active === env.doc.body || typeof active.blur !== 'function') return;
  try {
    (active.blur as () => void)();
  } catch {
    // 同上
  }
}

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
    focusGame(env); // preventDefault で起きなくなるフォーカスの移動を自分で行う（BUG-1）
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
