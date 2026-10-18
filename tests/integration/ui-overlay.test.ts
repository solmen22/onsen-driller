// @vitest-environment jsdom
// BL-046: ご褒美のシート・おかえり・確認・トースト・読み取り専用の案内を jsdom で確かめる
// （シナリオ org/30_quality/test-designer/scenarios/BL-046_sheets-modals.md の TS-046-01〜17。18 は e2e〔BL-103〕）。
// 見た目の大きさの比較（3 つのボタンの rect）・44px・pointer-events は e2e（BL-074・BL-103）
import { h } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInput } from '../../src/app/input.ts';
import { makePersistSettings, saveDisplay } from '../../src/app/save-display.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../src/app/settings.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState, type GameState } from '../../src/core/index.ts';
import { t } from '../../src/i18n/index.ts';
import type { KeyValueStore, RewardPlacement, RewardResult } from '../../src/platform/types.ts';
import type { UiContext } from '../../src/ui/hooks/use-game.ts';
import { boostView, mss } from '../../src/ui/overlay/boost-view.ts';
import { ConfirmModal } from '../../src/ui/overlay/ConfirmModal.tsx';
import { isModalOpen, onModalChange } from '../../src/ui/overlay/modal-state.ts';
import { TOAST_MS, ToastQueue } from '../../src/ui/overlay/toast-queue.ts';
import { WelcomeModal, type WelcomeChoice } from '../../src/ui/overlay/WelcomeModal.tsx';
import { stateWith } from '../support/states.ts';
import { mount, uiPlatform, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  vi.useRealTimers();
});

const NOW = 1_000_000_000_000;

/** 動画（BL-059 の口）とチケット（BL-058 の口）をつないだ Ctx。requestReward の結果は resolve で返す */
function wired(opts: { video?: boolean; ticketHook?: boolean } = {}) {
  const calls = { useBoostTicket: 0, requests: [] as RewardPlacement[] };
  let resolve: ((r: RewardResult) => void) | null = null;
  const platform = uiPlatform('crazygames');
  let available = opts.video ?? true;
  platform.ads.rewardedAvailable = () => available;
  const ctx: Partial<UiContext> = {
    platform,
    requestReward: (p) => {
      calls.requests.push(p);
      return new Promise<RewardResult>((r) => {
        resolve = r;
      });
    },
    ...(opts.ticketHook === false
      ? {}
      : { rewards: { useBoostTicket: () => void calls.useBoostTicket++, claimOffline: () => undefined, grantAd: () => undefined } }),
  };
  return {
    ctx,
    calls,
    setAvailable: (v: boolean) => {
      available = v;
    },
    finish: async (r: RewardResult) => {
      await act(async () => {
        resolve?.(r);
        await Promise.resolve();
      });
    },
  };
}

const withTickets = (n: number, base: GameState = createInitialState(1)): GameState => {
  base.meta.tickets = n;
  return base;
};

const pointerdown = (el: Element): void => {
  void act(() => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  });
};

/** 背景を押して離す（pointerdown → click）。閉じるのは click（PR #32 のレビューの S-1） */
const tap = (el: Element): void => {
  pointerdown(el);
  void act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('ご褒美のシート（R2・R3）', () => {
  it('TS-046-01 動画が使える・チケット 3 枚: btn-boost でシートが開き、動画（アイコン付き）・チケット（枚数）・閉じるが同じ部品で並ぶ', () => {
    const w = wired();
    m = mount({ state: withTickets(3), ctx: w.ctx, wallNow: () => NOW });
    expect(m.get('btn-boost').dataset['state']).toBe('ready');
    m.click('btn-boost');
    const sheet = m.get('sheet-reward');
    expect(sheet.getAttribute('role')).toBe('dialog');
    const ids = ['sheet-video', 'sheet-ticket', 'sheet-close'];
    for (const id of ids) expect(m.get(id).className, id).toBe('sheet-btn');
    expect(m.get('sheet-video').querySelector('.video-icon')).not.toBeNull();
    expect(m.get('sheet-ticket').textContent).toContain('×3');
    expect(m.get('sheet-ticket').hasAttribute('disabled')).toBe(false);
  });

  it('TS-046-02 鉱脈が出ている: chip-vein で R3 のシート（動画ですぐ開ける・自分で叩く・閉じる）。自分で叩くはシートを閉じる', () => {
    const w = wired();
    const s = createInitialState(1);
    s.run.vein.active = { depth: 3, hits: 0, expiresAtMs: 60_000 };
    m = mount({ state: s, ctx: w.ctx, wallNow: () => NOW });
    m.click('chip-vein');
    expect(m.get('sheet-reward').querySelector('[data-placement="R3"]')).not.toBeNull();
    for (const id of ['sheet-video', 'sheet-hits', 'sheet-close']) expect(m.get(id).className, id).toBe('sheet-btn');
    expect(m.q('sheet-ticket')).toBeNull();
    m.click('sheet-hits');
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('TS-046-02 ご褒美の口がない間（BL-058・059 の前）は、鉱脈のチップは S1 と同じく押せない', () => {
    const s = createInitialState(1);
    s.run.vein.active = { depth: 3, hits: 0, expiresAtMs: 60_000 };
    m = mount({ state: s });
    expect(m.get('chip-vein').hasAttribute('disabled')).toBe(true);
    expect(m.get('chip-vein').dataset['state']).toBe('unavailable');
  });

  it('TS-046-03 動画が使えない: R2・R3 とも動画のボタンが出ない。チケット・自分で叩く・閉じるは残る', () => {
    const w = wired({ video: false });
    const s = withTickets(1);
    s.run.vein.active = { depth: 3, hits: 0, expiresAtMs: 60_000 };
    m = mount({ state: s, ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    expect(m.q('sheet-video')).toBeNull();
    expect(m.q('sheet-ticket')).not.toBeNull();
    expect(m.q('sheet-close')).not.toBeNull();
    m.click('sheet-close');
    m.click('chip-vein');
    expect(m.q('sheet-video')).toBeNull();
    expect(m.q('sheet-hits')).not.toBeNull();
  });

  it('TS-046-04 チケット 0 枚: 表示したまま押せない（disabled・aria-disabled・×0）。押しても何も起きない', () => {
    const w = wired();
    m = mount({ state: withTickets(0), ctx: w.ctx, wallNow: () => NOW });
    expect(m.get('btn-boost').dataset['state']).toBe('ready'); // 動画を出せるので ready（Q-37 (a)）
    m.click('btn-boost');
    const b = m.get('sheet-ticket');
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.textContent).toContain('×0');
    expect(b.className).toBe('sheet-btn');
    m.click('sheet-ticket');
    expect(w.calls.useBoostTicket).toBe(0);
    expect(m.q('sheet-reward')).not.toBeNull();
  });

  it('TS-046-04 チケット 1 枚: すばやく 2 回押しても useBoost(ticket) は 1 回だけ届き、シートが閉じる', () => {
    const w = wired({ video: false });
    m = mount({ state: withTickets(1), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    const b = m.get('sheet-ticket');
    void act(() => {
      b.click();
      b.click();
    });
    expect(w.calls.useBoostTicket).toBe(1);
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('Q-41 (b)(d) 要求中は閉じない（閉じる・Esc・×・背景が効かない）。失敗で ad-unavailable をシートの中に出し、読み直して false なら動画を隠す', async () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    expect(m.get('sheet-video').dataset.kind).toBe('video');
    expect(m.get('sheet-video').dataset.state).toBeUndefined();
    m.click('sheet-video');
    expect(w.calls.requests).toEqual(['R2']);
    expect(m.get('sheet-video').dataset.state).toBe('loading'); // TS-059-01（印は Q-38 (h)。BL-059）
    expect(m.get('sheet-close').hasAttribute('disabled')).toBe(true);
    expect(m.get('sheet-ticket').hasAttribute('disabled')).toBe(true);
    m.key({ key: 'Escape' }, 'keydown', m.get('sheet-reward'));
    m.click('sheet-reward-x');
    tap(m.get('sheet-reward-backdrop'));
    expect(m.q('sheet-reward')).not.toBeNull();
    w.setAvailable(false);
    await w.finish('failed');
    expect(m.get('ad-unavailable').textContent).toBe(t('ad.unavailable'));
    expect(m.get('ad-unavailable').getAttribute('role')).toBe('status');
    expect(m.q('sheet-video')).toBeNull();
    expect(m.get('sheet-close').hasAttribute('disabled')).toBe(false);
    expect(m.q('toast')).toBeNull(); // トーストにしない
  });

  it('Q-41 動画の結果が rewarded ならシートを閉じる', async () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    m.click('sheet-video');
    await w.finish('rewarded');
    expect(m.q('sheet-reward')).toBeNull();
  });
});

describe('btn-boost の状態（TS-046-05。Q-37 (a)）', () => {
  it('m:ss は秒の切り上げ（299,000ms → 4:59、299,001ms → 5:00、0 → 0:00）', () => {
    expect(mss(299_000)).toBe('4:59');
    expect(mss(299_001)).toBe('5:00');
    expect(mss(870_000)).toBe('14:30');
    expect(mss(0)).toBe('0:00');
  });

  it('優先は active → cooldown → unavailable → ready。unavailable は動画もチケットも使えないときだけ', () => {
    const s = withTickets(0);
    expect(boostView(s, NOW, true, true)).toEqual({ state: 'ready', time: null });
    expect(boostView(s, NOW, false, true)).toEqual({ state: 'unavailable', time: null });
    s.meta.tickets = 1;
    expect(boostView(s, NOW, false, true).state).toBe('ready');
    expect(boostView(s, NOW, false, false).state).toBe('unavailable'); // チケットの口（BL-058）がない
    s.run.boost.readyAtWallMs = NOW + 870_000;
    expect(boostView(s, NOW, false, false)).toEqual({ state: 'cooldown', time: '14:30' });
    s.run.boost.remainingMs = 299_000;
    expect(boostView(s, NOW, false, false)).toEqual({ state: 'active', time: '4:59' });
  });

  it('active: 残り時間と ×2 を出し、押せず、押してもシートは開かない。aria-label に状態と時間', () => {
    const w = wired();
    const s = withTickets(2);
    s.run.boost.remainingMs = 299_001;
    s.run.boost.readyAtWallMs = NOW + 899_001; // 使った直後（休みの中。休みが明けていれば core で使えるので ready）
    m = mount({ state: s, ctx: w.ctx, wallNow: () => NOW });
    const b = m.get('btn-boost');
    expect(b.dataset['state']).toBe('active');
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.textContent).toContain('5:00');
    expect(b.textContent).toContain('×2');
    expect(b.getAttribute('aria-label')).toContain('5:00');
    m.click('btn-boost');
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('cooldown: 再使用までの時間（m:ss）を出して押せない', () => {
    const w = wired();
    const s = withTickets(2);
    s.run.boost.readyAtWallMs = NOW + 870_000;
    m = mount({ state: s, ctx: w.ctx, wallNow: () => NOW });
    const b = m.get('btn-boost');
    expect(b.dataset['state']).toBe('cooldown');
    expect(b.textContent).toContain('14:30');
    expect(b.getAttribute('aria-label')).toContain('14:30');
    expect(b.hasAttribute('disabled')).toBe(true);
  });

  it('ご褒美の口がない間（BL-058・059 の前）は unavailable で、S1 と同じ「準備中」の文字', () => {
    m = mount();
    const b = m.get('btn-boost');
    expect(b.dataset['state']).toBe('unavailable');
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(b.textContent).toContain(t('hud.boostSoon'));
  });
});

describe('おかえり（M1。TS-046-06・07）', () => {
  const mountWelcome = (ctx: Partial<UiContext>, tickets: number, ticketHook = true) => {
    const got: WelcomeChoice[] = [];
    m = mount({ state: withTickets(tickets), ctx, node: h(WelcomeModal, { amount: '1,234', onClaim: (c) => got.push(c), ticketHook }) });
    return got;
  };

  it('TS-046-06 受け取る・動画を見て ×2（アイコン）・チケットで ×2。受け取るは 1 タップで 1 回だけ', () => {
    const w = wired();
    const got = mountWelcome(w.ctx, 2);
    expect(m?.get('welcome-video').querySelector('.video-icon')).not.toBeNull();
    expect(m?.get('welcome-ticket').hasAttribute('disabled')).toBe(false);
    const claim = m?.get('welcome-claim') as HTMLElement;
    void act(() => {
      claim.click();
      claim.click();
    });
    expect(got).toEqual(['claim']);
  });

  it.each([
    ['Esc', (mm: Mounted) => mm.key({ key: 'Escape' }, 'keydown', mm.get('modal-welcome'))],
    ['×', (mm: Mounted) => mm.click('modal-welcome-x')],
    ['背景', (mm: Mounted) => tap(mm.get('modal-welcome-backdrop'))],
  ])('TS-046-06 %s で閉じても「受け取る」（×1）と同じ', (_name, close) => {
    const got = mountWelcome(wired().ctx, 1);
    close(m as Mounted);
    expect(got).toEqual(['claim']);
  });

  it('TS-046-07 動画が使えない・チケット 0 枚・要求中でも「受け取る」は押せる。動画なしなら動画のボタンは出ない', () => {
    const noVideo = wired({ video: false });
    let got = mountWelcome(noVideo.ctx, 0);
    expect(m?.q('welcome-video')).toBeNull();
    expect(m?.get('welcome-ticket').hasAttribute('disabled')).toBe(true);
    m?.click('welcome-claim');
    expect(got).toEqual(['claim']);
    m?.unmount();

    const w = wired();
    got = mountWelcome(w.ctx, 0);
    m?.click('welcome-video');
    expect(w.calls.requests).toEqual(['R1']);
    expect(m?.get('welcome-video').dataset.state).toBe('loading'); // BL-059（印は Q-38 (h)）
    expect(m?.get('welcome-claim').hasAttribute('disabled')).toBe(false);
    m?.click('welcome-claim');
    expect(got).toEqual(['claim']);
  });

  it('TS-046-07 チケットの口（BL-058）がない間は、チケットで ×2 は押せない', () => {
    mountWelcome(wired().ctx, 3, false);
    expect(m?.get('welcome-ticket').hasAttribute('disabled')).toBe(true);
  });
});

describe('トースト（TS-046-08〜11）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('TS-046-08 初来訪だけ出す（first:false では出さない）。1,999ms では見え、2,000ms で消える', () => {
    m = mount();
    m.run((st) => st.pushEvents([{ type: 'GuestArrived', guest: 'tanuki', first: false }]));
    expect(m.q('toast')).toBeNull();
    m.run((st) => st.pushEvents([{ type: 'GuestArrived', guest: 'tanuki', first: true }]));
    expect(m.get('toast').dataset['kind']).toBe('guest');
    expect(m.get('toast').textContent).toContain(t('guest.tanuki'));
    void act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(m.q('toast')).not.toBeNull();
    void act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(m.q('toast')).toBeNull();
  });

  it('TS-046-08 温泉チケット +1 は、チケットの付与の口（BL-058）があるときだけ同じトーストに出す', () => {
    m = mount({ ctx: wired().ctx, wallNow: () => NOW });
    m.run((st) => st.pushEvents([{ type: 'GuestArrived', guest: 'tanuki', first: true }]));
    expect(m.get('toast').textContent).toContain(t('toast.ticket'));
    m.unmount();
    m = mount();
    m.run((st) => st.pushEvents([{ type: 'GuestArrived', guest: 'tanuki', first: true }]));
    expect(m.get('toast').textContent).not.toContain(t('toast.ticket'));
  });

  it('TS-046-09 ok → failing のたびに 1 回（計 2 回）。failing が続く間は出し直さない。save-warning は failing の間ずっと', () => {
    m = mount();
    let shown = 0;
    const count = (): void => {
      if (m?.q('toast')?.dataset['kind'] === 'save') shown++;
    };
    m.run((st) => st.setSaveStatus('failing'));
    count();
    expect(m.get('save-warning').dataset['state']).toBe('failing');
    void act(() => {
      vi.advanceTimersByTime(15_000);
    });
    m.run((st) => st.setSaveStatus('failing'));
    m.notify();
    expect(m.q('toast')).toBeNull();
    m.run((st) => st.setSaveStatus('ok'));
    expect(m.q('save-warning')).toBeNull();
    m.run((st) => st.setSaveStatus('failing'));
    count();
    expect(shown).toBe(2);
  });

  it.each(['failing', 'unavailable', 'readonly'] as const)('TS-046-10 起動時から %s ならトーストを出さない（save-warning は起動直後から）', (st) => {
    const store = new GameStore(createInitialState(1));
    store.setSaveStatus(st);
    m = mount({ store });
    expect(m.get('save-warning').dataset['state']).toBe(st);
    for (let i = 0; i < 4; i++) {
      void act(() => {
      vi.advanceTimersByTime(15_000);
    });
      m.run((s) => s.setSaveStatus(st));
    }
    expect(m.q('toast')).toBeNull();
  });

  it('TS-046-11 同時に最大 3 つ・4 つ目以降は待ち行列で来た順・同じ中身は待ち行列に重ねない・どれも 2 秒は見える', () => {
    const seen: string[][] = [];
    const q = new ToastQueue((v) => seen.push(v.map((x) => x.key)));
    q.push('guest', 'tanuki');
    q.push('guest', 'monkey');
    q.push('guest', 'capybara');
    q.push('save', 'failing');
    q.push('save', 'failing'); // 待ち行列に同じ中身 → 足さない
    q.push('guest', 'fox');
    expect(q.visible.map((x) => x.key)).toEqual(['tanuki', 'monkey', 'capybara']);
    expect(q.pending.map((x) => x.key)).toEqual(['failing', 'fox']);
    vi.advanceTimersByTime(TOAST_MS);
    expect(q.visible.map((x) => x.key)).toEqual(['failing', 'fox']);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(q.visible.map((x) => x.key)).toEqual(['failing', 'fox']);
    vi.advanceTimersByTime(1);
    expect(q.visible).toEqual([]);
    q.dispose();
  });

  it('TS-046-11 トーストの入れ物は role="status"・aria-live="polite"（押せないことは CSS の pointer-events: none。e2e で）', () => {
    m = mount();
    const box = m.get('toasts');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-live')).toBe('polite');
  });
});

describe('確認（M3。TS-046-12）', () => {
  it.each([
    ['Esc', (mm: Mounted) => mm.key({ key: 'Escape' }, 'keydown', mm.get('modal-confirm'))],
    ['×', (mm: Mounted) => mm.click('modal-confirm-x')],
    ['背景', (mm: Mounted) => tap(mm.get('modal-confirm-backdrop'))],
    ['いいえ', (mm: Mounted) => mm.click('confirm-cancel')],
  ])('%s は取り消し（はいの操作をしない）', (_name, close) => {
    const got: string[] = [];
    m = mount({ node: h(ConfirmModal, { title: 'T', message: 'M', onOk: () => got.push('ok'), onCancel: () => got.push('cancel') }) });
    close(m);
    expect(got).toEqual(['cancel']);
  });
  it('「はい」だけが操作を行う（1 回だけ）', () => {
    const got: string[] = [];
    m = mount({ node: h(ConfirmModal, { title: 'T', message: 'M', onOk: () => got.push('ok'), onCancel: () => got.push('cancel') }) });
    const ok = m.get('confirm-ok');
    void act(() => {
      ok.click();
      ok.click();
    });
    expect(got).toEqual(['ok']);
  });
});

describe('ダイアログの属性・フォーカス・入力（TS-046-13・14）', () => {
  it('TS-046-13 role・aria-modal・aria-labelledby。開くと本体にフォーカス（ボタンにはない）。Tab は中で回る。閉じると btn-boost に戻る', () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    const boost = m.get('btn-boost');
    void act(() => boost.focus());
    m.click('btn-boost');
    const d = m.get('sheet-reward');
    expect(d.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(d.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe(t('sheet.boost.title'));
    expect(document.activeElement).toBe(d);
    expect(d.getAttribute('tabindex')).toBe('-1');
    // 本体から Tab → 最初のボタン（×）。最後のボタンから Tab → 最初に戻る
    m.key({ key: 'Tab' }, 'keydown', d);
    expect(document.activeElement).toBe(m.get('sheet-reward-x'));
    void act(() => m?.get('sheet-close').focus());
    m.key({ key: 'Tab' }, 'keydown', m.get('sheet-close'));
    expect(document.activeElement).toBe(m.get('sheet-reward-x'));
    m.key({ key: 'Tab', shiftKey: true }, 'keydown', m.get('sheet-reward-x'));
    expect(document.activeElement).toBe(m.get('sheet-close'));
    m.key({ key: 'Escape' }, 'keydown', d);
    expect(m.q('sheet-reward')).toBeNull();
    expect(document.activeElement).toBe(m.get('btn-boost'));
  });

  it('TS-046-14 表示中は 1〜5（タブ）・Shift（購入数）が効かない。閉じると戻る', () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    expect(isModalOpen()).toBe(true);
    m.key({ key: '2', code: 'Digit2' });
    expect(m.get('tab-1').getAttribute('aria-selected')).toBe('true');
    m.key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    expect(m.get('qty-toggle').dataset['qty']).toBe('1');
    m.click('sheet-close');
    expect(isModalOpen()).toBe(false);
    m.key({ key: '2', code: 'Digit2' });
    expect(m.get('tab-2').getAttribute('aria-selected')).toBe('true');
  });

  it('TS-046-14 表示中は掘削の入力を止める（main.ts と同じ結線: onModalChange → setBlocked(modal)）。閉じるための押下は打撃にならず、閉じた後の次の押下から掘れる', () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    const stage = new EventTarget();
    const input = setupInput({ stage, win: new EventTarget(), doc: new EventTarget() }, m.store);
    const off = onModalChange((open) => input.setBlocked('modal', open));
    const press = (): void => {
      const e = new Event('pointerdown', { cancelable: true });
      Object.defineProperty(e, 'isPrimary', { value: true });
      stage.dispatchEvent(e);
    };
    const hits = (): number => m?.store.state.stats.hits ?? -1;
    m.click('btn-boost');
    press();
    expect(hits()).toBe(0);
    pointerdown(m.get('sheet-reward-backdrop')); // 押しただけでは閉じない（S-1。タッチで後ろに click が抜けないように）
    expect(m.q('sheet-reward')).not.toBeNull();
    tap(m.get('sheet-reward-backdrop')); // 背景（ステージに重なる）を押して離すと閉じる
    expect(m.q('sheet-reward')).toBeNull();
    expect(hits()).toBe(0);
    press();
    expect(hits()).toBe(1);
    off();
    input.dispose();
  });
});

describe('要求中・失敗の後のフォーカスと Esc（PR #32 のレビューの S-2。TS-046-13 の追加）', () => {
  it('動画を押す → ボタンが disabled になりフォーカスが落ちても、本体に戻る。失敗の後に Esc（フォーカスは外）で閉じる', async () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    const d = m.get('sheet-reward');
    const video = m.get('sheet-video');
    void act(() => video.focus());
    m.click('sheet-video'); // 要求中: 動画のボタンは disabled
    expect(video.hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(d); // disabled のボタンに残さず本体へ
    void act(() => d.blur()); // ブラウザがフォーカスを body に落とした状態を作る
    expect(document.activeElement).toBe(document.body);
    w.setAvailable(false);
    await w.finish('failed'); // 失敗の後の描画で本体に戻る
    expect(document.activeElement).toBe(d);
    void act(() => d.blur());
    m.key({ key: 'Escape' }, 'keydown', document.body); // フォーカスが外（body）でも Esc で閉じる
    expect(m.q('sheet-reward')).toBeNull();
  });

  it('要求中にフォーカスが外（body）にあるときの Esc は閉じない。Tab は中のボタンに戻す', () => {
    const w = wired();
    m = mount({ state: withTickets(2), ctx: w.ctx, wallNow: () => NOW });
    m.click('btn-boost');
    const d = m.get('sheet-reward');
    m.click('sheet-video');
    void act(() => d.blur());
    m.key({ key: 'Escape' }, 'keydown', document.body);
    expect(m.q('sheet-reward')).not.toBeNull(); // Q-41 (b)
    void act(() => d.blur());
    m.key({ key: 'Tab' }, 'keydown', document.body);
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('読み取り専用のセッション（Q-26。TS-046-15〜17）', () => {
  it('TS-046-15 表示の状態は readonly が最優先（autosave が failing・ok・unavailable を通知しても readonly のまま）', () => {
    for (const st of ['ok', 'failing', 'unavailable'] as const) {
      expect(saveDisplay(st, true)).toBe('readonly');
      expect(saveDisplay(st, false)).toBe(st);
    }
  });

  it('TS-046-16 読み取り専用の間は設定のキーに書かない（0 回）。通常は 1 回書く', () => {
    const writes: string[] = [];
    const storage: KeyValueStore = {
      get: () => null,
      set: (k) => {
        writes.push(k);
        return true;
      },
      remove: () => {},
      kind: 'local',
    };
    const settings = { ...DEFAULT_SETTINGS, lang: 'ja' as const };
    let ro = true;
    const persist = makePersistSettings(storage, settings, () => ro);
    expect(persist()).toBe(false);
    expect(writes).toEqual([]);
    ro = false;
    expect(persist()).toBe(true);
    expect(writes).toEqual([SETTINGS_KEY]);
  });

  it.each(['ja', 'en'] as const)('TS-046-17 最初の描画から save-warning が readonly・role=status・閉じるボタンなし・文言は save.newerVersion（%s）', (lang) => {
    const store = new GameStore(createInitialState(1));
    store.setSaveStatus('readonly');
    m = mount({ store, lang });
    const w = m.get('save-warning');
    expect(w.dataset['state']).toBe('readonly');
    expect(w.getAttribute('role')).toBe('status');
    expect(w.querySelector('button')).toBeNull();
    expect(w.textContent).toBe(t('save.newerVersion'));
  });
});

describe('既存の HUD の項目を壊していない', () => {
  it('stateWith の状態でも btn-boost・save-warning の扱いは変わらない', () => {
    m = mount({ state: stateWith({ tool: 1 }) });
    expect(m.get('btn-boost').dataset['state']).toBe('unavailable');
    expect(m.q('save-warning')).toBeNull();
    expect(m.q('toast')).toBeNull();
  });
});
