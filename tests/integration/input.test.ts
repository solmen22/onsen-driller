// BL-012: app/input.ts（DOM のポインタ・キーボード → アクション）を Node の EventTarget と偽のタイマーで確かめる
// （TS-012-19・20、Q-04(c)(d)(e)・Q-05。jsdom は使わない）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInput, type InputController } from '../../src/app/input.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState } from '../../src/core/index.ts';

class FakeDoc extends EventTarget {
  hidden = false;
  visibilityState = 'visible';
}

/** type のイベントを作る（code・repeat・isPrimary・target などを自分のプロパティとして持たせる） */
function ev(type: string, props: Record<string, unknown> = {}): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  return e;
}

let stage: EventTarget;
let win: EventTarget;
let doc: FakeDoc;
let store: GameStore;
let input: InputController;
let firstInputs = 0;

beforeEach(() => {
  vi.useFakeTimers();
  stage = new EventTarget();
  win = new EventTarget();
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
  it('2 本目の指（isPrimary=false）は打撃にしない', () => {
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
    ['入力の無効化（広告の再生中）', () => input.setEnabled(false)],
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
    input.setEnabled(false);
    const e = ev('keydown', { code: 'Space' });
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(hits()).toBe(0);
    stage.dispatchEvent(ev('pointerdown', { isPrimary: true }));
    expect(hits()).toBe(0);
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
