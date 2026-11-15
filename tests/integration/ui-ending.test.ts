// @vitest-environment jsdom
// BL-023: エンディングのカード（簡易版）を App で出す・飛ばす（Q-55 (d)(e)(f)）。TS-ID は scenarios/BL-023_legendary-ending.md
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createRewardHooks } from '../../src/app/rewards.ts';
import { GameStore } from '../../src/app/store.ts';
import { num } from '../../src/core/index.ts';
import { t } from '../../src/i18n/index.ts';
import { endingCardClosed, isEndingCardRequested, onEndingCardClosed, showEndingCard } from '../../src/ui/overlay/ending-card.ts';
import { isModalOpen } from '../../src/ui/overlay/modal-state.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  endingCardClosed(); // 次のテストに出したままのカードを残さない
});

const show = (): void => {
  void act(() => showEndingCard());
};

describe('TS-023-10 カードの表示と飛ばし方（Q-55 (e)）', () => {
  it('出すと modal-ending（見出しと文言）が出て「飛ばす」にフォーカス。掘削の入力は止まる（モーダルに数える）', () => {
    m = mount();
    expect(m.q('modal-ending')).toBeNull();
    show();
    const card = m.get('modal-ending');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.textContent).toContain(t('ending.title'));
    expect(card.textContent).toContain(t('ending.body'));
    expect(document.activeElement).toBe(m.get('ending-skip'));
    expect(isModalOpen()).toBe(true);
  });

  it('「飛ばす」・Enter・Space・Esc で閉じる（app に 1 回だけ知らせる）。ja・en の文言', () => {
    for (const lang of ['ja', 'en'] as const)
      for (const how of ['click', 'Enter', ' ', 'Escape'] as const) {
        m = mount({ lang });
        let closed = 0;
        const off = onEndingCardClosed(() => closed++);
        show();
        expect(m.get('ending-skip').textContent).toBe(t('ending.skip'));
        if (how === 'click') m.click('ending-skip');
        else m.key({ key: how });
        expect([m.q('modal-ending'), closed, isEndingCardRequested()], `${lang} ${how}`).toEqual([null, 1, false]);
        expect(isModalOpen()).toBe(false);
        off();
        m.unmount();
        m = null;
      }
  });

  it('キーの自動リピート（掘るために押していた Space など）とカードの外のタップでは閉じない', () => {
    m = mount();
    show();
    for (const key of [' ', 'Enter', 'Escape']) m.key({ key, repeat: true });
    m.click('modal-ending-backdrop');
    m.key({ key: 'a' });
    expect(m.q('modal-ending')).not.toBeNull();
  });
});

describe('TS-023-16（画面の分）おかえりが出ている間は、閉じた後にカード（Q-55 (d)）', () => {
  it('pendingOffline があるとおかえりが先。受け取って閉じたらカードが出る', () => {
    const s = stateWith({ seed: 1 });
    s.run.pendingOffline = { coins: num(5000), ms: 8 * 3_600_000 };
    const store = new GameStore(s, { onError: (e) => { throw e; } });
    m = mount({ store, ctx: { rewards: createRewardHooks(store) } });
    show();
    expect(m.q('modal-welcome')).not.toBeNull();
    expect(m.q('modal-ending')).toBeNull();
    m.click('welcome-claim');
    expect(m.q('modal-welcome')).toBeNull();
    expect(m.q('modal-ending')).not.toBeNull();
  });
});
