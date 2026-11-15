// @vitest-environment jsdom
// BL-045 の T4（転生タブ）と転生の確認の画面（M3）を、本物の store・core とつないで jsdom で確かめる
// （TS-021-06・07・14・21・22・23・40 (a)。Q-47 (a)(d)(g)(h)(j)(k)。TL-A の約束: 確定は dispatch → 閉じる、隠れたら onDismiss、値は prestigeView から）
// - 数値（解放の深さ・獲得量・チケット・木のコスト）は content と core の prestigeView から読む（BL-034 で数値を変えても赤にならない）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { PERK_BY_ID, PERKS } from '../../src/content/perks.ts';
import { depthForGain, num, prestigeView, type GameState } from '../../src/core/index.ts';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import { dismissPrestigeConfirm, isPrestigeConfirmOpen, onPrestigeConfirmChange } from '../../src/ui/overlay/prestige-confirm.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

const P = PARAMS.prestige;
let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  dismissPrestigeConfirm(); // 閉じ忘れを次のテストに持ち越さない
});

/** 周回の最深 d・セーブ全体の最深 best の状態 */
function at(d: number, extra: (s: GameState) => void = () => {}): GameState {
  const s = stateWith({ depth: d });
  extra(s);
  return s;
}

const openT4 = (s: GameState, lang: 'en' | 'ja' = 'en'): Mounted => {
  m = mount({ state: s, lang });
  m.click('tab-4');
  return m;
};

describe('T4 の表示（TS-021-06・07・40 (a)。Q-47 (a)(h)(k)）', () => {
  it('Q-47 (a): セーブ全体の最深が解放の深さ前なら、案内だけ（「150m で解放」「あと 〇m」・説明）。ボタン・木は出さない', () => {
    openT4(at(40));
    expect(m!.get('panel-prestige').dataset['state']).toBe('locked');
    expect(m!.get('prestige-locked').textContent).toContain(`${P.unlockDepth}m`);
    expect(m!.get('prestige-locked-left').textContent).toContain(`${P.unlockDepth - 40}m`);
    expect(m!.q('btn-prestige')).toBeNull();
    expect(m!.q('perk-tree')).toBeNull();
  });

  it('TS-021-06: 解放の深さちょうどで押せて、得られる湯の華（data-value）が出る。深さが増えると通知で表示が追いつく', () => {
    const s = at(P.unlockDepth);
    openT4(s);
    const btn = m!.get('btn-prestige') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(m!.get('prestige-gain').dataset['value']).toBe(String(prestigeView(s).gain.toNumber()));
    // 次に増える深さ（基本 +1）と、そこまでの m（UI で引き算しない。prestigeView の値）
    const next = m!.get('prestige-next');
    expect(next.dataset['left']).toBe(String(prestigeView(s).metersToNextGain));
    expect(next.textContent).toContain(`${depthForGain(prestigeView(s).gainBase + 1)}m`);
    // 深さが増える → 通知で追いつく
    const d2 = depthForGain(prestigeView(s).gainBase + 1);
    m!.run((st) => {
      st.state.run.depth = d2;
      st.state.run.maxDepth = d2;
      st.notify();
    });
    expect(m!.get('prestige-gain').dataset['value']).toBe(String(prestigeView(m!.store.state).gain.toNumber()));
    expect(Number(m!.get('prestige-gain').dataset['value'])).toBeGreaterThan(prestigeView(s).gain.toNumber() - 1);
  });

  it('TS-021-07: 転生の後（セーブ全体の最深は解放の深さ以上・周回の最深 0）は中身が出たまま、ボタンは押せず「あと 150m」', () => {
    const s = at(0, (x) => {
      x.stats.bestDepth = 160;
    });
    openT4(s);
    expect(m!.get('panel-prestige').dataset['state']).toBe('open');
    const btn = m!.get('btn-prestige') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(m!.get('prestige-next').dataset['left']).toBe(String(P.unlockDepth));
    // 押しても確認の画面は開かない
    m!.click('btn-prestige');
    expect(m!.q('modal-prestige')).toBeNull();
    expect(isPrestigeConfirmOpen()).toBe(false);
  });

  it('推奨（TS-021-40 (a)）: 基準に届くと prestige-recommended、届く前は目安（prestige-guide）。基準が Infinity（壊れたセーブ）なら目安も出さない', () => {
    const below = at(depthForGain(P.recommendGain) - 1);
    openT4(below);
    expect(m!.q('prestige-recommended')).toBeNull();
    expect(m!.get('prestige-guide').textContent).toContain(String(P.recommendGain));
    m!.unmount();
    openT4(at(depthForGain(P.recommendGain)));
    expect(m!.q('prestige-recommended')).not.toBeNull();
    expect(m!.q('prestige-guide')).toBeNull();
    m!.unmount();
    openT4(
      at(300, (x) => {
        x.meta.lastPrestigeGain = num('1e400');
      }),
    );
    expect(prestigeView(m!.store.state).recommendAt).toBe(Number.POSITIVE_INFINITY);
    expect(m!.q('prestige-recommended')).toBeNull();
    expect(m!.q('prestige-guide')).toBeNull();
  });

  it('Q-47 (h): 目利き（×1.5）を取っていると「+最終（目利き +上乗せ）」を分けて出し、足し算が合う', () => {
    const s = at(300, (x) => {
      x.meta.perks = ['travelFunds', 'loupe', 'connoisseur'];
      x.meta.yunohana.lifetime = num(100);
      x.meta.yunohana.spent = num(63);
    });
    openT4(s);
    const v = prestigeView(s);
    expect(v.gainBonus).toBeGreaterThan(0);
    expect(m!.get('prestige-gain').dataset['value']).toBe(String(v.gainBase + v.gainBonus));
    expect(m!.get('prestige-gain').textContent).toContain(`+${v.gainBonus}`);
  });

  it('Q-47 (g): その周回で初めて推奨に届いたら tab-4 に点（「！」とは別）。T4 を開くと消え、同じ周回では出し直さない', () => {
    const s = at(depthForGain(P.recommendGain) - 1);
    m = mount({ state: s });
    expect(m.q('tab-4-dot')).toBeNull();
    m.run((st) => {
      const d = depthForGain(P.recommendGain);
      st.state.run.depth = d;
      st.state.run.maxDepth = d;
      st.notify();
    });
    expect(m.q('tab-4-dot')).not.toBeNull();
    expect(m.get('tab-4').dataset['alert']).toBeUndefined(); // 「！」ではない
    m.click('tab-4');
    expect(m.q('tab-4-dot')).toBeNull();
    m.click('tab-1');
    m.notify();
    expect(m.q('tab-4-dot')).toBeNull();
  });
});

describe('湯の華の木（T4。BL-022 の画面）', () => {
  it('3 系統のまとまりに定義の順で 12 ノード。取れるものを押すと takePerk で取り、使える湯の華が減る。前提のないノードの状態は文字でも出る', () => {
    const s = at(160, (x) => {
      x.meta.yunohana.lifetime = num(20);
    });
    openT4(s);
    for (const b of ['dig', 'inn', 'guest'] as const) {
      const ids = [...m!.get(`perk-branch-${b}`).querySelectorAll<HTMLElement>('button[data-testid^="perk-"]')].map((e) => e.dataset['testid']);
      expect(ids).toEqual(PERKS.filter((p) => p.branch === b).map((p) => `perk-${p.id}`));
    }
    expect(m!.get('perk-available').dataset['value']).toBe('20');
    expect(m!.get('perk-nightDig').dataset['state']).toBe('locked');
    expect(m!.get('perk-nightDig').textContent).toContain(en['perk.sharpBlade']);
    expect(m!.get('perk-famousSpring').dataset['state']).toBe('locked');
    m!.click('perk-sharpBlade');
    expect(m!.store.state.meta.perks).toEqual(['sharpBlade']);
    expect(m!.get('perk-sharpBlade').dataset['state']).toBe('owned');
    expect((m!.get('perk-sharpBlade') as HTMLButtonElement).disabled).toBe(true);
    expect(m!.get('perk-available').dataset['value']).toBe(String(20 - PERK_BY_ID.sharpBlade.cost));
    expect(m!.get('perk-nightDig').dataset['state']).toBe('available');
    // 足りないものは押せない
    expect((m!.get('perk-shortcut') as HTMLButtonElement).disabled).toBe(true);
    // 次の周回から効くノードは文字で出す
    expect(m!.get('perk-heirloomPick').textContent).toContain(en['perk.nextRun']);
  });
});

describe('転生の確認の画面（TS-021-14・21・22・23。Q-47 (d)(j)）', () => {
  it('TS-021-22: 開いている間は止める（openPrestigeConfirm）。1 段目の取り消し・Esc・背景・× と、2 段目の取り消しでは転生しない。2 段目の確定だけが転生する', () => {
    const seen: boolean[] = [];
    const off = onPrestigeConfirmChange((o) => seen.push(o));
    try {
      openT4(at(200));
      const before = m!.store.state.meta.prestiges;
      for (const how of ['cancel', 'esc', 'backdrop', 'x', 'step2-cancel'] as const) {
        m!.click('btn-prestige');
        expect(m!.q('modal-prestige')).not.toBeNull();
        expect(isPrestigeConfirmOpen()).toBe(true);
        if (how === 'cancel') m!.click('prestige-cancel');
        else if (how === 'esc') m!.key({ key: 'Escape' }, 'keydown', m!.get('modal-prestige'));
        else if (how === 'backdrop') m!.click('modal-prestige-backdrop');
        else if (how === 'x') m!.click('modal-prestige-x');
        else {
          m!.click('prestige-confirm-1');
          expect(m!.q('prestige-confirm-2')).not.toBeNull();
          m!.click('prestige-cancel');
        }
        expect(m!.q('modal-prestige')).toBeNull();
        expect(isPrestigeConfirmOpen()).toBe(false);
        expect(m!.store.state.meta.prestiges).toBe(before);
      }
      expect(seen).toEqual([true, false, true, false, true, false, true, false, true, false]);
      m!.click('btn-prestige');
      m!.click('prestige-confirm-1');
      m!.click('prestige-confirm-2');
      expect(m!.store.state.meta.prestiges).toBe(before + 1);
      expect(m!.q('modal-prestige')).toBeNull();
      expect(isPrestigeConfirmOpen()).toBe(false);
    } finally {
      off();
    }
  });

  it('TL-A の約束: 確定は「dispatch → 閉じる」の順（PrestigeDone を受けた時点では、まだ確認の画面が開いている）', () => {
    openT4(at(200));
    const order: string[] = [];
    const offEv = m!.store.onEvents((evs) => {
      if (evs.some((e) => e.type === 'PrestigeDone')) order.push(`dispatch(open=${isPrestigeConfirmOpen()})`);
    });
    const off = onPrestigeConfirmChange((o) => {
      if (!o) order.push('close');
    });
    try {
      m!.click('btn-prestige');
      m!.click('prestige-confirm-1');
      m!.click('prestige-confirm-2');
      expect(order).toEqual(['dispatch(open=true)', 'close']);
    } finally {
      off();
      offEv();
    }
  });

  it('TS-021-21: 2 段目の確定を素早く 5 回押しても、確定と取り消しをほぼ同時に押しても、転生は 1 回だけ', () => {
    openT4(at(200, (x) => {
      x.meta.tickets = 0;
    }));
    const spy = vi.spyOn(m!.store, 'dispatch');
    m!.click('btn-prestige');
    m!.click('prestige-confirm-1');
    const ok = m!.get('prestige-confirm-2');
    const cancel = m!.get('prestige-cancel');
    m!.run(() => {
      for (let i = 0; i < 5; i++) ok.click();
      cancel.click();
    });
    expect(spy.mock.calls.filter(([a]) => (a as { type: string }).type === 'prestige')).toHaveLength(1);
    expect(m!.store.state.meta.prestiges).toBe(1);
    expect(m!.store.state.meta.tickets).toBe(PARAMS.tickets.prestige);
  });

  it('タブが隠れた（dismissPrestigeConfirm）ら onDismiss で画面が消え、転生しない。開き直すと今の値を見せる（決定 0010 の 14 (b)）', () => {
    openT4(at(200));
    m!.click('btn-prestige');
    m!.run(() => dismissPrestigeConfirm());
    expect(m!.q('modal-prestige')).toBeNull();
    expect(m!.store.state.meta.prestiges).toBe(0);
    m!.run((st) => {
      st.state.run.depth = 300;
      st.state.run.maxDepth = 300;
      st.notify();
    });
    m!.click('btn-prestige');
    expect(m!.get('prestige-confirm-gain').dataset['value']).toBe(String(prestigeView(m!.store.state).gain.toNumber()));
  });

  it('PR #91 のレビュー N-1: 確認の画面が開いたまま T4 が外れても（アンマウント）、止める理由が残らない', () => {
    openT4(at(200));
    m!.click('btn-prestige');
    expect(isPrestigeConfirmOpen()).toBe(true);
    m!.unmount();
    m = null;
    expect(isPrestigeConfirmOpen()).toBe(false);
  });

  it('PR #91 のレビュー N-2: 開いたまま状態が変わると、確認の画面の値が prestigeView に追従する（保持した値を見せない）', () => {
    openT4(at(200));
    m!.click('btn-prestige');
    m!.run((st) => {
      st.state.run.depth = 300;
      st.state.run.maxDepth = 300;
      st.notify();
    });
    expect(m!.get('prestige-confirm-gain').dataset['value']).toBe(String(prestigeView(m!.store.state).gain.toNumber()));
  });

  it('TS-021-23: 得られるもの（湯の華・累計・全生産の倍率・チケット）・なくなるもの・残るものを出し、数字は prestigeView のまま。確定した後の状態と一致する（ja・en）', () => {
    for (const lang of ['ja', 'en'] as const) {
      const dict = lang === 'ja' ? ja : en;
      const s = at(300, (x) => {
        x.meta.yunohana.lifetime = num(9);
        x.meta.tickets = 3;
      });
      const v = prestigeView(s);
      openT4(s, lang);
      m!.click('btn-prestige');
      expect(m!.get('prestige-confirm-gain').dataset['value']).toBe(String(v.gain.toNumber()));
      expect(m!.get('prestige-confirm-gain').textContent).toContain(`+${v.gain.toNumber()}`);
      expect(m!.get('prestige-lifetime').textContent).toContain(`9`);
      expect(m!.get('prestige-lifetime').textContent).toContain(String(v.lifetimeAfter.toNumber()));
      // 全生産 +18% → +90%（湯の華 1 つで +2%。値は prestigeView の倍率）
      const pctNow = Math.round((v.multNow.toNumber() - 1) * 100);
      const pctAfter = Math.round((v.multAfter.toNumber() - 1) * 100);
      expect(m!.get('prestige-mult').textContent).toContain(`+${pctNow}%`);
      expect(m!.get('prestige-mult').textContent).toContain(`+${pctAfter}%`);
      expect(m!.get('prestige-tickets').dataset['value']).toBe(String(v.ticketsAdded));
      expect(m!.get('prestige-lose').textContent).toBe(dict['prestige.confirm.loseList']);
      expect(m!.get('prestige-keep').textContent).toBe(dict['prestige.confirm.keepList']);
      m!.click('prestige-confirm-1');
      m!.click('prestige-confirm-2');
      const after = m!.store.state;
      expect(after.meta.yunohana.lifetime.toNumber()).toBe(v.lifetimeAfter.toNumber());
      expect(after.meta.tickets).toBe(3 + v.ticketsAdded);
      expect(prestigeView(after).multNow.toNumber()).toBeCloseTo(v.multAfter.toNumber(), 12);
      m!.unmount();
      m = null;
    }
  });

  it('TS-021-14・Q-47 (d): チケット 8 枚なら上限の案内なし、9 枚は「1 枚しか入りません」、10 枚は「入りません」（0 枚でも出す）。コインに替えるとは書かない', () => {
    const max = PARAMS.tickets.max;
    for (const [have, text] of [
      [max - 2, null],
      [max - 1, en['prestige.confirm.ticketCap'].replace('{n}', '1')],
      [max, en['prestige.confirm.ticketCapNone']],
    ] as const) {
      openT4(at(200, (x) => {
        x.meta.tickets = have;
      }));
      m!.click('btn-prestige');
      const cap = m!.q('prestige-ticket-cap');
      if (text === null) expect(cap).toBeNull();
      else {
        expect(cap!.textContent).toBe(text);
        expect(cap!.textContent.toLowerCase()).not.toContain('coin');
        // 確定のボタン（1 段目の「次へ」）より前に出る
        expect(cap!.compareDocumentPosition(m!.get('prestige-confirm-1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      m!.click('prestige-cancel');
      m!.unmount();
      m = null;
    }
  });
});

describe('確認の画面の地形の選択（BL-024 の terrainChoices。gdd §5-8）', () => {
  it('初期は今の地形。1 回目の転生では火山のふもとが選べ、海辺は「あと 1 回の転生で解放」で押せない。選んだ地形で転生する', () => {
    openT4(at(200));
    const spy = vi.spyOn(m!.store, 'dispatch');
    m!.click('btn-prestige');
    expect(m!.get('terrain-mountain').getAttribute('aria-pressed')).toBe('true');
    expect(m!.get('terrain-mountain').dataset['state']).toBe('selected');
    expect(m!.get('prestige-terrain').dataset['value']).toBe('mountain');
    expect(m!.get('terrain-volcano').dataset['state']).toBe('selectable');
    const sea = m!.get('terrain-seaside') as HTMLButtonElement;
    expect(sea.dataset['state']).toBe('locked');
    expect(sea.disabled).toBe(true);
    expect(sea.textContent).toContain(en['terrain.locked'].replace('{n}', '1'));
    expect(m!.get('terrain-volcano').textContent).toContain(en['terrain.shallow'].split('{springs}')[1]!.trim());
    m!.click('terrain-volcano');
    expect(m!.get('terrain-volcano').getAttribute('aria-pressed')).toBe('true');
    expect(m!.get('terrain-volcano').dataset['state']).toBe('selected');
    expect(m!.get('terrain-mountain').dataset['state']).toBe('selectable');
    m!.click('prestige-confirm-1');
    m!.click('prestige-confirm-2');
    expect(spy.mock.calls.map(([a]) => a)).toContainEqual({ type: 'prestige', terrain: 'volcano' });
    expect(m!.store.state.run.terrain).toBe('volcano');
  });

  it('地形を変えなければ terrain を渡さない（今の地形のまま）', () => {
    openT4(at(200));
    const spy = vi.spyOn(m!.store, 'dispatch');
    m!.click('btn-prestige');
    m!.click('prestige-confirm-1');
    m!.click('prestige-confirm-2');
    expect(spy.mock.calls.map(([a]) => a)).toContainEqual({ type: 'prestige' });
    expect(m!.store.state.run.terrain).toBe('mountain');
  });
});

describe('確認の画面の木の振り直し（BL-022 の受け入れ基準「振り直すと使った湯の華が全部戻り、費用はかからない」）', () => {
  it('「全部戻す」で使った分が全部戻り、選び直した木で転生する。前提を外すと、それを前提にするノードも戻る', () => {
    const s = at(200, (x) => {
      x.meta.perks = ['sharpBlade', 'nightDig'];
      x.meta.yunohana.lifetime = num(20);
      x.meta.yunohana.spent = num(15);
    });
    const gain = prestigeView(s).gain.toNumber();
    openT4(s);
    m!.click('btn-prestige');
    m!.click('prestige-respec');
    expect(m!.get('plan-available').dataset['value']).toBe(String(20 + gain - 15));
    // 前提（研いだ刃）を戻すと、夜なべ掘りも戻る
    m!.click('plan-sharpBlade');
    expect(m!.get('plan-sharpBlade').dataset['state']).not.toBe('owned');
    expect(m!.get('plan-nightDig').dataset['state']).toBe('locked');
    m!.click('plan-yumori');
    expect(m!.get('plan-yumori').dataset['state']).toBe('owned');
    m!.click('prestige-respec-reset');
    expect(m!.get('plan-available').dataset['value']).toBe(String(20 + gain));
    m!.click('plan-travelFunds');
    m!.click('prestige-confirm-1');
    m!.click('prestige-confirm-2');
    const after = m!.store.state;
    expect(after.meta.perks).toEqual(['travelFunds']);
    expect(after.meta.yunohana.spent.toNumber()).toBe(PERK_BY_ID.travelFunds.cost);
    expect(after.meta.yunohana.lifetime.toNumber()).toBe(20 + gain);
    // 旅の支度金は次の周回の始めから（コイン 500）
    expect(after.run.coins.toNumber()).toBeGreaterThanOrEqual(500);
  });

  it('振り直しを開いても木を変えなければ、今の木のまま転生する（perks を渡さない）', () => {
    const s = at(200, (x) => {
      x.meta.perks = ['sharpBlade'];
      x.meta.yunohana.lifetime = num(10);
      x.meta.yunohana.spent = num(5);
    });
    openT4(s);
    const spy = vi.spyOn(m!.store, 'dispatch');
    m!.click('btn-prestige');
    m!.click('prestige-respec');
    m!.click('prestige-confirm-1');
    m!.click('prestige-confirm-2');
    expect(spy.mock.calls.map(([a]) => a)).toContainEqual({ type: 'prestige' });
    expect(m!.store.state.meta.perks).toEqual(['sharpBlade']);
  });
});
