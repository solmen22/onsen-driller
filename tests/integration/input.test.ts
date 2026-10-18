// BL-012: app/input.ts（DOM のポインタ・キーボード → アクション）を Node の EventTarget と偽のタイマーで確かめる
// （TS-012-19・20、Q-04(c)(d)(e)・Q-05。jsdom は使わない）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInput, type InputController } from '../../src/app/input.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState } from '../../src/core/index.ts';

/** フォーカスを持てる要素の代わり（blur で document のフォーカスを body に戻す） */
class FakeEl {
  blurs = 0;
  readonly tagName: string;
  private readonly owner: FakeDoc;
  constructor(tagName: string, owner: FakeDoc) {
    this.tagName = tagName;
    this.owner = owner;
  }
  focus(): void {
    this.owner.activeElement = this;
  }
  blur(): void {
    this.blurs++;
    if (this.owner.activeElement === this) this.owner.activeElement = this.owner.body;
  }
}

class FakeDoc extends EventTarget {
  hidden = false;
  visibilityState = 'visible';
  readonly body: FakeEl = new FakeEl('BODY', this);
  activeElement: FakeEl | null = this.body;
}

/** window の代わり。focus() は押した枠（iframe）へのフォーカスの移動（BUG-1）。呼ばれた回数と、そのときの打撃数を記録する */
class FakeWin extends EventTarget {
  focusCalls: number[] = [];
  private readonly hitsNow: () => number;
  constructor(hitsNow: () => number) {
    super();
    this.hitsNow = hitsNow;
  }
  focus(): void {
    this.focusCalls.push(this.hitsNow());
  }
}

/** type のイベントを作る（code・repeat・isPrimary・target などを自分のプロパティとして持たせる） */
function ev(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  return e;
}

let stage: EventTarget;
let win: FakeWin;
let doc: FakeDoc;
let store: GameStore;
let input: InputController;
let firstInputs = 0;

beforeEach(() => {
  vi.useFakeTimers();
  stage = new EventTarget();
  win = new FakeWin(() => store.state.stats.hits);
  doc = new FakeDoc();
  store = new GameStore(createInitialState(1));
  firstInputs = 0;
  input = setupInput({ stage, win, doc }, store, { onFirstInput: () => firstInputs++ });
});
afterEach(() => {
  input.dispose();
  vi.useRealTimers();
});

const hits = (): number => store.state.stats.hits;
const holdOn = (): boolean => store.state.input.hold;

describe('押した瞬間に 1 打、300ms で長押し（Q-04(c)）', () => {
  it('pointerdown で 1 打。299ms ではまだ長押しでなく、300ms で長押しになる', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(hits()).toBe(1);
    vi.advanceTimersByTime(299);
    expect(holdOn()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(holdOn()).toBe(true);
    expect(input.holding).toBe(true);
  });
  it('300ms 未満で離すとタップ 1 回だけ', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    vi.advanceTimersByTime(200);
    stage.dispatchEvent(ev('pointerup'));
    vi.advanceTimersByTime(1000);
    store.advance(2000);
    expect(hits()).toBe(1);
    expect(holdOn()).toBe(false);
  });
  it('2 秒押し続けると約 8 打（1 ＋ 1.7 秒 × 4 ＋ 0.5）', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    vi.advanceTimersByTime(300);
    store.advance(1700);
    stage.dispatchEvent(ev('pointerup'));
    expect(hits()).toBe(8);
  });
  it('pointerdown の preventDefault と最初の入力の通知（1 回だけ）', () => {
    const e = ev('pointerdown', { isPrimary: true });
    stage.dispatchEvent(e);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(e.defaultPrevented).toBe(true);
    expect(firstInputs).toBe(1);
  });
  it('TS-012-21 2 本目の指（isPrimary=false）は打撃にしない', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: false }));
    expect(hits()).toBe(0);
  });
});

describe('TS-012-19 長押しの終わらせ方（ポインタ・blur・非表示・pagehide）', () => {
  const enders: [string, () => void][] = [
    ['pointerup', () => stage.dispatchEvent(ev('pointerup'))],
    ['pointerleave', () => stage.dispatchEvent(ev('pointerleave'))],
    ['pointercancel', () => stage.dispatchEvent(ev('pointercancel'))],
    ['lostpointercapture', () => stage.dispatchEvent(ev('lostpointercapture'))],
    ['window blur', () => win.dispatchEvent(ev('blur'))],
    ['pagehide', () => win.dispatchEvent(ev('pagehide'))],
    [
      'visibilitychange（hidden）',
      () => {
        doc.hidden = true;
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(ev('visibilitychange'));
      },
    ],
    ['入力の無効化（広告の再生中）', () => input.setBlocked('ad', true)],
  ];
  for (const [name, end] of enders) {
    it(`${name} で長押しが終わり、5 秒進めても打撃が増えない`, () => {
      stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
      vi.advanceTimersByTime(300);
      expect(holdOn()).toBe(true);
      end();
      expect(holdOn()).toBe(false);
      const h = hits();
      store.advance(5000);
      expect(hits()).toBe(h);
    });
  }
  it('長押しになる前に終わらせると、タイマーも取り消される（後から長押しにならない）', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    vi.advanceTimersByTime(100);
    win.dispatchEvent(ev('blur'));
    vi.advanceTimersByTime(1000);
    expect(holdOn()).toBe(false);
  });
  it('visibilitychange でも表示中（visible）なら終わらない', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    vi.advanceTimersByTime(300);
    doc.dispatchEvent(ev('visibilitychange'));
    expect(holdOn()).toBe(true);
  });
});

describe('Ctrl・Alt・Meta と組み合わせた Space・矢印は掘らず、preventDefault もしない（PM の指摘）', () => {
  it('Ctrl+Space・Alt+Space・Meta+Space は打撃にも長押しにもならない。修飾なしの Space は今までどおり', () => {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      const e = ev('keydown', { code: 'Space', [mod]: true });
      win.dispatchEvent(e);
      expect(e.defaultPrevented, mod).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(hits(), mod).toBe(0);
      expect(holdOn(), mod).toBe(false);
      win.dispatchEvent(ev('keyup', { code: 'Space', [mod]: true }));
    }
    const arrow = ev('keydown', { code: 'ArrowLeft', altKey: true });
    win.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(false); // Alt+← の「戻る」を止めない
    win.dispatchEvent(ev('keydown', { code: 'Space', shiftKey: true }));
    expect(hits()).toBe(1); // Shift は修飾に数えない（今までどおり掘る）
  });
});

describe('長押しは押し始めたポインタの終わりだけで終わる（レビュー N-8）', () => {
  it('指 1 で長押し中に、指 2 の pointerup・pointerleave では終わらず、指 1 の pointerup で終わる', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true, pointerId: 1 }));
    vi.advanceTimersByTime(300);
    expect(holdOn()).toBe(true);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: false, pointerId: 2 }));
    stage.dispatchEvent(ev('pointerup', { pointerId: 2 }));
    stage.dispatchEvent(ev('pointerleave', { pointerId: 2 }));
    expect(holdOn()).toBe(true);
    stage.dispatchEvent(ev('pointerup', { pointerId: 1 }));
    expect(holdOn()).toBe(false);
  });
  it('長押しになる前に指 2 を離しても、指 1 の長押しは 300ms でなる', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true, pointerId: 7 }));
    vi.advanceTimersByTime(100);
    stage.dispatchEvent(ev('pointercancel', { pointerId: 8 }));
    vi.advanceTimersByTime(200);
    expect(holdOn()).toBe(true);
  });
});

describe('Space（Q-04(d)・Q-05）と TS-012-20', () => {
  it('Space の keydown で 1 打、300ms で長押し、keyup で終わる。preventDefault される', () => {
    const down = ev('keydown', { code: 'Space' });
    win.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(hits()).toBe(1);
    vi.advanceTimersByTime(300);
    expect(holdOn()).toBe(true);
    const up = ev('keyup', { code: 'Space' });
    win.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(holdOn()).toBe(false);
  });
  it('自動リピート（repeat: true）の keydown は打撃にも長押しの判定にも使わない（preventDefault だけ）', () => {
    win.dispatchEvent(ev('keydown', { code: 'Space' }));
    const rep = ev('keydown', { code: 'Space', repeat: true });
    for (let i = 0; i < 10; i++) win.dispatchEvent(rep);
    expect(rep.defaultPrevented).toBe(true);
    expect(hits()).toBe(1);
  });
  it('TS-012-20: keyup が来ないまま blur で長押しが終わる', () => {
    win.dispatchEvent(ev('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(300);
    expect(holdOn()).toBe(true);
    win.dispatchEvent(ev('blur'));
    expect(holdOn()).toBe(false);
    const h = hits();
    store.advance(5000);
    expect(hits()).toBe(h);
  });
  it('矢印キーは preventDefault するが掘らない。ほかのキー（Tab など）は止めない', () => {
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const e = ev('keydown', { code });
      win.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    const tab = ev('keydown', { code: 'Tab' });
    win.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(hits()).toBe(0);
  });
  it('フォーカスのあるボタンでも Space は掘削に使い、preventDefault する', () => {
    const e = ev('keydown', { code: 'Space', target: { tagName: 'BUTTON' } });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(hits()).toBe(1);
  });
  it('編集できる要素（input・textarea・select・contenteditable）では何もしない', () => {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      for (const code of ['Space', 'ArrowDown']) {
        const e = ev('keydown', { code, target });
        win.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
      }
    }
    expect(hits()).toBe(0);
  });
  it('入力を止めている間は Space で掘らない（preventDefault は続ける）', () => {
    input.setBlocked('ad', true);
    const e = ev('keydown', { code: 'Space' });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(hits()).toBe(0);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(hits()).toBe(0);
  });
});

describe('BUG-1 ステージを押すと、押した枠（ポータルの iframe）にフォーカスを移す', () => {
  // pointerdown の preventDefault で互換の mousedown が出ず、その既定の動作（フォーカスの移動）が起きなかった。
  // 実際のブラウザで親ページがスクロールしないことは e2e の TS-012-18 (b)（iframe の中でステージを押す）で確かめる
  it('pointerdown で打撃の前に window.focus() を呼び（preventDefault は続ける）、その後の Space で掘れて preventDefault される', () => {
    const down = ev('pointerdown', { isPrimary: true, pointerId: 1 });
    stage.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(win.focusCalls).toEqual([0]); // 1 回だけ、打撃（hits 1）の前に
    expect(hits()).toBe(1);
    stage.dispatchEvent(ev('pointerup', { pointerId: 1 }));

    const space = ev('keydown', { code: 'Space', target: doc.activeElement });
    win.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(hits()).toBe(2);
    win.dispatchEvent(ev('keyup', { code: 'Space' }));
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const e = ev('keydown', { code, target: doc.activeElement });
      win.dispatchEvent(e);
      expect(e.defaultPrevented, code).toBe(true);
    }
    expect(hits()).toBe(2);
  });
  it('押すたびにフォーカスを移す（親ページを触った後にまた押しても枠に戻る）', () => {
    for (let i = 0; i < 3; i++) {
      stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
      stage.dispatchEvent(ev('pointerup'));
    }
    expect(win.focusCalls).toHaveLength(3);
  });
  it('フォーカスのある要素（HUD のボタン）からフォーカスを外す。body には何もしない', () => {
    const btn = new FakeEl('BUTTON', doc);
    btn.focus();
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(btn.blurs).toBe(1);
    expect(doc.activeElement).toBe(doc.body);
    stage.dispatchEvent(ev('pointerup'));
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(doc.body.blurs).toBe(0);
    expect(btn.blurs).toBe(1);
  });
  it('編集できる要素（読み込みのテキスト欄）にフォーカスがあっても、ステージを押せば外れて Space で掘れる', () => {
    const ta = new FakeEl('TEXTAREA', doc);
    ta.focus();
    const typed = ev('keydown', { code: 'Space', target: doc.activeElement });
    win.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false); // 文字として入る（Q-05）
    expect(hits()).toBe(0);
    win.dispatchEvent(ev('keyup', { code: 'Space', target: doc.activeElement }));

    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    stage.dispatchEvent(ev('pointerup'));
    expect(ta.blurs).toBe(1);
    expect(hits()).toBe(1);
    const space = ev('keydown', { code: 'Space', target: doc.activeElement });
    win.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(hits()).toBe(2);
  });
  it('フォーカスを移した後も、長押し（300ms）と Ctrl・Alt・Meta の規則は変わらない', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true, pointerId: 3 }));
    vi.advanceTimersByTime(299);
    expect(holdOn()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(holdOn()).toBe(true);
    for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
      const e = ev('keydown', { code: 'Space', [mod]: true, target: doc.activeElement });
      win.dispatchEvent(e);
      expect(e.defaultPrevented, mod).toBe(false);
    }
    expect(hits()).toBe(1);
    expect(holdOn()).toBe(true); // フォーカスの移動や修飾キーで長押しは終わらない
    stage.dispatchEvent(ev('pointerup', { pointerId: 3 }));
    expect(holdOn()).toBe(false);
    expect(win.focusCalls).toHaveLength(1);
  });
  it('入力を止めている間・2 本目の指では preventDefault もフォーカスの移動もしない（ブラウザの既定の動作に任せる）', () => {
    const btn = new FakeEl('BUTTON', doc);
    btn.focus();
    input.setBlocked('ad', true);
    const off = ev('pointerdown', { isPrimary: true });
    stage.dispatchEvent(off);
    expect(off.defaultPrevented).toBe(false);
    input.setBlocked('ad', false);
    const second = ev('pointerdown', { isPrimary: false });
    stage.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(win.focusCalls).toEqual([]);
    expect(btn.blurs).toBe(0);
    expect(hits()).toBe(0);
  });
  it('focus のない window・activeElement のない document、focus・blur が例外を投げても掘削は続ける', () => {
    const s2 = new EventTarget();
    const plain = setupInput({ stage: s2, win: new EventTarget(), doc: new EventTarget() }, store);
    s2.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    s2.dispatchEvent(ev('pointerup'));
    plain.dispose();
    expect(hits()).toBe(1);

    const s3 = new EventTarget();
    const badWin = Object.assign(new EventTarget(), {
      focus: () => {
        throw new Error('focus denied');
      },
    });
    const badDoc = Object.assign(new EventTarget(), {
      body: null,
      activeElement: {
        blur: () => {
          throw new Error('blur failed');
        },
      },
    });
    const bad = setupInput({ stage: s3, win: badWin, doc: badDoc }, store);
    const down = ev('pointerdown', { isPrimary: true });
    // dispatchEvent はリスナーの例外を呼び出し元に投げない。例外が漏れると打撃が入らず hits が 1 のままになり、
    // Vitest も未処理のエラーで落ちる（それで確かめる。PR #7 のレビュー N-2）
    s3.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    bad.dispose();
    expect(hits()).toBe(2);
  });
});

describe('UI のパネルの押下も「最初の入力」', () => {
  it('window の pointerdown（捕捉）で 1 回だけ通知し、打撃にはしない', () => {
    win.dispatchEvent(ev('pointerdown'));
    win.dispatchEvent(ev('pointerdown'));
    expect(firstInputs).toBe(1);
    expect(hits()).toBe(0);
  });
});

describe('理由ごとに入力を止める（setBlocked。BL-046・BL-059 共通。TS-046-14・TS-059-03 の前段）', () => {
  it('広告とモーダルが重なると、両方が外れるまで掘れない（同じ理由を二重に立てても 1 つ）', () => {
    input.setBlocked('ad', true);
    input.setBlocked('modal', true);
    input.setBlocked('modal', true);
    input.setBlocked('ad', false);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(hits()).toBe(0);
    input.setBlocked('modal', false);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(hits()).toBe(1);
  });
  it('止めた時点で長押しが終わり、長押しのタイマーも効かない', () => {
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    input.setBlocked('modal', true);
    vi.advanceTimersByTime(1000);
    expect(holdOn()).toBe(false);
    expect(hits()).toBe(1);
  });
  it('モーダルの表示中: ボタンが対象の Space は preventDefault しない（ボタンを押せる）。ボタン以外の Space・矢印は preventDefault し、掘らない', () => {
    input.setBlocked('modal', true);
    const btn = new FakeEl('BUTTON', doc);
    const onBtn = ev('keydown', { code: 'Space', target: btn });
    win.dispatchEvent(onBtn);
    expect(onBtn.defaultPrevented).toBe(false);
    const upBtn = ev('keyup', { code: 'Space', target: btn });
    win.dispatchEvent(upBtn);
    expect(upBtn.defaultPrevented).toBe(false);
    const div = new FakeEl('DIV', doc);
    const onBody = ev('keydown', { code: 'Space', target: div });
    win.dispatchEvent(onBody);
    expect(onBody.defaultPrevented).toBe(true);
    const arrow = ev('keydown', { code: 'ArrowDown', target: btn });
    win.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(hits()).toBe(0);
  });
  it('広告だけで止めているときは、ボタンが対象の Space も今までどおり preventDefault する（モーダルの外は Q-05 のまま）', () => {
    input.setBlocked('ad', true);
    const btn = new FakeEl('BUTTON', doc);
    const e = ev('keydown', { code: 'Space', target: btn });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const up = ev('keyup', { code: 'Space', target: btn });
    win.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
  });
});
