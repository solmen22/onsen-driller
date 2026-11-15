// @vitest-environment jsdom
// BL-049 チュートリアル 8 段（gdd §12）: 契機・済み・二度と出さない・設定で消す・画面を止めない
import { afterEach, describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { createInitialState, dispatch, num } from '../../src/core/index.ts';
import { isModalOpen } from '../../src/ui/overlay/modal-state.ts';
import { TUTORIAL_STEPS, tutorialNow } from '../../src/ui/tutorial/tutorial-view.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const step = (): string | undefined => m!.q('tutorial-bubble')?.dataset['step'];

describe('core の {type:"tutorial"}（BL-049）', () => {
  it('step は済んだ段の番号を上げるだけ（下げない）。dismissed で消す・戻す。正しくない値は invalid で状態を変えない', () => {
    const s = createInitialState(1);
    expect(dispatch(s, { type: 'tutorial', step: 3 }).ok).toBe(true);
    expect(s.tutorial.step).toBe(3);
    expect(dispatch(s, { type: 'tutorial', step: 2 }).ok).toBe(true);
    expect(s.tutorial.step).toBe(3);
    for (const bad of [{ type: 'tutorial' }, { type: 'tutorial', step: 0 }, { type: 'tutorial', step: PARAMS.tutorial.steps + 1 }, { type: 'tutorial', step: 1.5 }, { type: 'tutorial', dismissed: 'yes' }]) {
      expect(dispatch(s, bad)).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(s.tutorial.step).toBe(3);
    expect(dispatch(s, { type: 'tutorial', dismissed: true }).ok).toBe(true);
    expect(s.tutorial.dismissed).toBe(true);
  });

  it('転生でも残る（周回をまたぐ）', () => {
    const s = stateWith({ depth: 200 });
    s.tutorial.step = 5;
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.tutorial.step).toBe(5);
  });
});

describe('今出す段（tutorialNow）', () => {
  it('段の数は PARAMS.tutorial.steps（8）と同じで、番号は 1 から順', () => {
    expect(TUTORIAL_STEPS.map((d) => d.no)).toEqual(Array.from({ length: PARAMS.tutorial.steps }, (_, i) => i + 1));
  });

  it('新しいゲームは段 1（指の印）。1 打で済み、コイン 3 で段 2、ツルハシで段 3、10m で段 4 …と進む。先の段の契機を満たしたら手前は飛ばす', () => {
    const s = createInitialState(1);
    expect(tutorialNow(s)?.no).toBe(1);
    s.stats.hits = 1;
    expect(tutorialNow(s)).toBeNull(); // 済み（書かない。出さないだけ）
    s.run.coins = num(3);
    expect(tutorialNow(s)?.no).toBe(2);
    s.run.drill.tool = 1;
    expect(tutorialNow(s)?.no).toBe(3); // ツルハシを買った（段 2 は飛ばす）
    s.run.autoDig.on = true;
    expect(tutorialNow(s)).toBeNull();
    s.run.maxDepth = 10;
    expect(tutorialNow(s)?.no).toBe(4);
    s.stats.bestDepth = 150;
    expect(tutorialNow(s)?.no).toBe(8);
    expect(tutorialNow(s)?.alertTab).toBe(4);
    s.tutorial.step = 8;
    expect(tutorialNow(s)).toBeNull();
  });

  it('済んだ段より前の契機は見ない（二度と出さない）。設定で消したら・転生の後は何も出さない', () => {
    const s = stateWith({ depth: 40, coins: 100, tool: 1, pumps: { simple: 1 } });
    s.tutorial.step = 5;
    expect(tutorialNow(s)).toBeNull();
    s.tutorial.step = 0;
    expect(tutorialNow(s)?.no).toBe(5);
    s.tutorial.dismissed = true;
    expect(tutorialNow(s)).toBeNull();
    // 転生の後（2 周目以降）は出さない（道具・コインが戻っても段 2・3 を出し直さない）
    s.tutorial.dismissed = false;
    s.meta.prestiges = 1;
    expect(tutorialNow(s)).toBeNull();
  });
});

describe('表示（Tutorial）', () => {
  it('起動直後に指の印（tutorial-finger）。モーダルにしない（modal-state に数えない）。1 打で消える。UI は状態を書かない（段の番号はそのまま）', () => {
    m = mount();
    expect(m.q('tutorial-finger')).not.toBeNull();
    expect(isModalOpen()).toBe(false);
    m.run((st) => st.dispatch({ type: 'tap' }));
    m.notify();
    expect(m.q('tutorial-finger')).toBeNull();
    expect(m.store.state.tutorial.step).toBe(0);
  });

  it('段 2: ツルハシ（buy-tool）を光らせ、吹き出しを出す。OK で済み、二度と出ない', () => {
    const s = stateWith({ coins: 5 });
    s.stats.hits = 1;
    s.tutorial.step = 1;
    m = mount({ state: s });
    expect(step()).toBe('2');
    expect(m.get('buy-tool').getAttribute('data-tutorial-glow')).toBe('true');
    m.click('tutorial-ok');
    expect(m.store.state.tutorial.step).toBe(2);
    expect(m.q('tutorial-bubble')).toBeNull();
    expect(m.get('buy-tool').hasAttribute('data-tutorial-glow')).toBe(false);
  });

  it('段 3: ツルハシを買うと段 3（自動掘り）に移り、自動掘りをオンにすると消える', () => {
    const s = stateWith({ coins: 5 });
    s.stats.hits = 1;
    s.tutorial.step = 1;
    m = mount({ state: s });
    m.click('buy-tool');
    expect(step()).toBe('3');
    expect(m.get('toggle-auto-dig').getAttribute('data-tutorial-glow')).toBe('true');
    m.click('toggle-auto-dig');
    m.notify();
    expect(m.q('tutorial-bubble')).toBeNull();
    expect(m.get('toggle-auto-dig').hasAttribute('data-tutorial-glow')).toBe(false);
  });

  it('段 8: 転生タブに「！」と説明。T5 の設定（setting-tutorial）で消すと何も出ず、戻すと出る', () => {
    const s = stateWith({ depth: 160 });
    s.tutorial.step = 7;
    m = mount({ state: s });
    expect(step()).toBe('8');
    expect(m.get('tab-4').dataset['alert']).toBe('true');
    m.click('tab-5');
    expect(m.get('setting-tutorial').dataset['value']).toBe('on');
    m.click('setting-tutorial');
    expect(m.store.state.tutorial.dismissed).toBe(true);
    expect(m.q('tutorial-bubble')).toBeNull();
    expect(m.get('tab-4').dataset['alert']).toBeUndefined();
    m.click('setting-tutorial');
    expect(step()).toBe('8');
  });
});
