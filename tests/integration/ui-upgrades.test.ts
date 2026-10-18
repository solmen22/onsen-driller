// @vitest-environment jsdom
// BL-044 の T3: 改良タブを、本物の store・core とつないで jsdom で確かめる（TS-044-12〜15・17。PR #62 のレビューの手触り H-2・H-3）
// - 数値（コスト・倍率・解放の条件）は content から読む（BL-034 で数値を変えても赤にならない。TS-018-16）
import { afterEach, describe, expect, it } from 'vitest';
import { UPGRADE_BY_ID, UPGRADES, type UpgradeId } from '../../src/content/upgrades.ts';
import { buyQuote, num, secondsUntil, toStr } from '../../src/core/index.ts';
import { buyTestId } from '../../src/ui/panels/buy-view.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const VIBRO = UPGRADE_BY_ID.vibroBit.cost;
const SIEVE = UPGRADE_BY_ID.sieve.cost;
const id = (u: UpgradeId): string => buyTestId(`upgrade:${u}`);
const rowIds = (group: HTMLElement): string[] => [...group.querySelectorAll<HTMLElement>('[data-testid^="buy-upgrade-"]')].map((e) => e.dataset['testid']!).filter((x) => !/-(name|effect|cost|eta|done)$/.test(x));

describe('T3 の並び（TS-044-12〜15）', () => {
  it('TS-044-12: 未購入（解放済み）が上・購入済みが下、どちらも内容定義の順。未解放は行を出さず「次の改良」を 1 行。状態は data-state と文字で', () => {
    // 最深 60m: vibroBit（40m）・sieve（50m）が解放。vibroBit は購入済み。sieve は足りない。ほかは未解放
    const s = stateWith({ depth: 60, coins: SIEVE - 1 });
    s.run.upgrades = ['vibroBit'];
    m = mount({ state: s });
    m.click('tab-3');
    expect(m.get('panel-upgrades').dataset['state']).toBe('open');
    expect(rowIds(m.get('upgrades-available'))).toEqual([id('sieve')]);
    expect(rowIds(m.get('upgrades-bought'))).toEqual([id('vibroBit')]);
    expect(m.get(id('sieve')).dataset['state']).toBe('insufficient');
    const bought = m.get(id('vibroBit')) as HTMLButtonElement;
    expect(bought.dataset['state']).toBe('maxed');
    expect(bought.disabled).toBe(true);
    expect(m.get(`${id('vibroBit')}-done`).textContent).toBe('Bought');
    // 未解放の改良の行はない
    for (const u of UPGRADES) if (!['vibroBit', 'sieve'].includes(u.id)) expect(m.q(id(u.id))).toBeNull();
    // 「次の改良」は 1 行だけ
    expect(m.root.querySelectorAll('[data-testid="upgrades-next"]')).toHaveLength(1);
    expect(m.q('upgrades-empty')).toBeNull();
    // 改良には購入数（qty-toggle）を出さない（Q-38 (e)）。レベルの表示もない（一度きり）
    expect(m.q('qty-toggle')).toBeNull();
    expect(m.q(`${id('sieve')}-level`)).toBeNull();
    expect(m.q(`${id('sieve')}-qty`)).toBeNull();
  });

  it('TS-044-13: 買える改良を押すと buy が 1 回で、同じ描画で購入済みの組に移って押せなくなる。購入済みを押しても何も起きない。コインの減り＝表示のコスト', () => {
    const s = stateWith({ depth: 45, coins: VIBRO + 7 });
    m = mount({ state: s });
    m.click('tab-3');
    const b = m.get(id('vibroBit'));
    expect(b.dataset['state']).toBe('affordable');
    const shown = Number(b.dataset['cost']);
    expect(shown).toBe(VIBRO);
    const c0 = m.store.state.run.coins.toNumber();
    m.click(id('vibroBit'));
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    expect(c0 - m.store.state.run.coins.toNumber()).toBeCloseTo(shown, 9);
    expect(rowIds(m.get('upgrades-bought'))).toEqual([id('vibroBit')]);
    expect(m.q('upgrades-available')?.dataset['count']).toBe('0');
    expect((m.get(id('vibroBit')) as HTMLButtonElement).disabled).toBe(true);
    // 購入済みを押しても何も起きない（disabled なので click が届かない。core も maxed で断る）
    const c1 = m.store.state.run.coins.toString();
    m.click(id('vibroBit'));
    expect(m.store.state.run.coins.toString()).toBe(c1);
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
  });

  it('TS-044-14: コインが増えて買える・買えないが変わっても、行の順番は内容定義のまま（data-state と文字だけが変わる）', () => {
    // vibroBit（安い方が先）と sieve。コインを sieve だけ買える額にはできないので、vibroBit の下・間・上で 3 回描く
    const s = stateWith({ depth: 60, coins: 0 });
    m = mount({ state: s });
    m.click('tab-3');
    const order0 = rowIds(m.get('upgrades-available'));
    expect(order0).toEqual([id('vibroBit'), id('sieve')]);
    const states: string[][] = [];
    for (const c of [VIBRO - 1, VIBRO, SIEVE + VIBRO]) {
      m.run((st) => {
        st.state.run.coins = num(c);
        st.notify();
      });
      expect(rowIds(m.get('upgrades-available'))).toEqual(order0);
      states.push(order0.map((x) => m!.get(x).dataset['state']!));
    }
    expect(states).toEqual([
      ['insufficient', 'insufficient'],
      ['affordable', 'insufficient'],
      ['affordable', 'affordable'],
    ]);
  });

  it('TS-044-15: 1 つも解放されていない（最深 40m 未満）ときは一覧を出さず、upgrades-empty に最初の条件を出す。崩れない', () => {
    m = mount({ state: stateWith({ depth: 12 }) });
    m.click('tab-3');
    expect(m.get('panel-upgrades').dataset['state']).toBe('empty');
    expect(m.q('upgrades-available')).toBeNull();
    expect(m.q('upgrades-bought')).toBeNull();
    const e = m.get('upgrades-empty');
    expect(e.dataset['id']).toBe('vibroBit');
    expect(e.dataset['kind']).toBe('depth');
    expect(e.dataset['target']).toBe(String(40));
    expect(e.dataset['current']).toBe('12');
    expect(e.textContent).toContain('Unlocks at 40 m (28 m to go)');
  });
});

describe('ひと目で分かる行（PR #62 のレビューの H-2・H-3）', () => {
  it('H-3: 各行に名前と効果（content の倍率から作る。T2 と同じ語彙）。買った後も効果を出す', () => {
    const s = stateWith({ depth: 60, coins: 0 });
    s.run.upgrades = ['sieve'];
    for (const lang of ['ja', 'en'] as const) {
      m = mount({ state: s, lang });
      m.click('tab-3');
      const mult = (u: UpgradeId): number => (UPGRADE_BY_ID[u].effect as { mult: number }).mult;
      expect(m.get(`${id('vibroBit')}-name`).textContent).toBe(lang === 'ja' ? '振動ビット' : 'Vibrating bit');
      expect(m.get(`${id('vibroBit')}-effect`).textContent).toBe(lang === 'ja' ? `ドリル威力 ×${mult('vibroBit')}` : `Drill power ×${mult('vibroBit')}`);
      // 購入済みの行も効果を出す（何が効いているか分かるように）
      expect(m.get(`${id('sieve')}-effect`).textContent).toBe(lang === 'ja' ? `鉱石の価値 ×${mult('sieve')}` : `Ore value ×${mult('sieve')}`);
      m.unmount();
      m = null;
    }
  });

  it('H-2: 足りない改良の行に「あと N 秒」（secondsUntil。ほかの購入と同じ表示）。収入 0 なら「あと N コイン」', () => {
    // 単純温泉を枠に入れて入湯料がある状態（収入 > 0）
    const s = stateWith({ depth: 60, pumps: { simple: 5 }, bath: 1, coins: 0 });
    m = mount({ state: s });
    m.click('tab-3');
    const eta = m.get(`${id('vibroBit')}-eta`);
    const sec = secondsUntil(m.store.state, num(VIBRO));
    expect(sec).not.toBeNull();
    expect(eta.dataset['seconds']).toBe(String(sec));
    expect(eta.dataset['lack']).toBe(toStr(num(VIBRO)));
    m.unmount();
    // 収入 0（源泉なし・自動掘削機なし）
    m = mount({ state: stateWith({ depth: 60, coins: 0 }) });
    m.click('tab-3');
    const eta0 = m.get(`${id('vibroBit')}-eta`);
    expect(eta0.dataset['seconds']).toBeUndefined();
    expect(eta0.textContent).toMatch(/coins? short|to go/);
  });

  it('次の改良は、条件の進みがいちばん大きい未解放の改良（ポンプの条件は「Lv 今/目標」）', () => {
    // 最深 60m（vibroBit・sieve 解放）。単純温泉のポンプ Lv4（のれんは Lv5 で解放 → 4/5 = 0.8）。宿帳は 70m（60/70 ≈ 0.86）→ 宿帳
    const s = stateWith({ depth: 60, pumps: { simple: 4 }, bath: 1 });
    m = mount({ state: s });
    m.click('tab-3');
    expect(m.get('upgrades-next').dataset['id']).toBe('ledger');
    m.unmount();
    // ポンプ Lv4・最深 52m（52/70 ≈ 0.74 < 0.8）→ のれん。文に今の Lv と目標
    m = mount({ state: stateWith({ depth: 52, pumps: { simple: 4 }, bath: 1 }), lang: 'ja' });
    m.click('tab-3');
    const n = m.get('upgrades-next');
    expect(n.dataset['id']).toBe('noren');
    expect(n.dataset['kind']).toBe('pump');
    expect(n.textContent).toContain('次の改良「のれん」');
    expect(n.textContent).toContain('全入湯料 ×');
    expect(n.textContent).toContain('単純温泉のポンプ Lv 4/5 で解放');
  });

  it('全部買うと「次の改良」は出ない。表示と購入は同じ buyQuote（全 12 行の data-state・data-cost）', () => {
    const s = stateWith({ depth: 300, pumps: { simple: 30, co2: 30, salt: 30, sulfur: 30, iron: 30 }, bath: 10, coins: 0 });
    s.run.coins = num(UPGRADE_BY_ID.polisher.cost);
    m = mount({ state: s });
    m.click('tab-3');
    for (const u of UPGRADES) {
      const q = buyQuote(m.store.state, `upgrade:${u.id}`, 1);
      const b = m.get(id(u.id));
      expect([u.id, b.dataset['state']]).toEqual([u.id, q.state]);
      expect(b.dataset['cost']).toBe(toStr(q.n > 0 ? q.cost : q.nextCost));
    }
    expect(m.q('upgrades-next')).toBeNull();
    m.run((st) => {
      st.state.run.upgrades = UPGRADES.map((u) => u.id);
      st.notify();
    });
    expect(m.q('upgrades-next')).toBeNull();
    expect(m.get('upgrades-available').dataset['count']).toBe('0');
    expect(m.get('upgrades-bought').dataset['count']).toBe(String(UPGRADES.length));
  });
});

describe('TS-044-17 言語の切り替え', () => {
  it('T3 の文言は t() から出て、言語を切り替えた次の描画で変わる（キー名の文字列が出ない）', () => {
    const s = stateWith({ depth: 60, coins: 0 });
    m = mount({ state: s, lang: 'ja' });
    m.click('tab-3');
    const ja = m.get('panel-upgrades').textContent ?? '';
    expect(ja).toContain('まだ買っていない改良');
    expect(ja).not.toMatch(/upgrades?\.\w+/);
    m.click('tab-5');
    m.click('lang-toggle');
    m.click('tab-3');
    const en = m.get('panel-upgrades').textContent ?? '';
    expect(en).toContain('Not bought yet');
    expect(en).not.toMatch(/upgrades?\.\w+/);
  });
});
