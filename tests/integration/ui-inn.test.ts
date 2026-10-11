// @vitest-environment jsdom
// BL-044: 湯宿タブ T2 を、本物の store・core とつないで jsdom で確かめる（TS-044-01〜11。T3〔TS-044-12〜15〕は BL-018 の後）
import { afterEach, describe, expect, it } from 'vitest';
import { bathView, buyQuote, refreshGuests, toStr } from '../../src/core/index.ts';
import { hasText } from '../../src/i18n/index.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const found = (mm: Mounted, id: string) => mm.run((st) => st.pushEvents([{ type: 'SpringFound', spring: id as 'simple', depth: 30 }]));

describe('30m の前と「！」（TS-044-01〜03）', () => {
  it('TS-044-01: 源泉がなければ中身を出さず案内だけ。「！」もない。T1 に戻れる', () => {
    m = mount({ state: stateWith({ depth: 29 }) });
    m.click('tab-2');
    expect(m.get('panel-inn').dataset['state']).toBe('locked');
    expect(m.q('inn-locked')).not.toBeNull();
    expect(m.q('inn-slot-0')).toBeNull();
    expect(m.q('buy-bath')).toBeNull();
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
    m.key({ key: '2', code: 'Digit2' });
    m.click('tab-1');
    expect(m.q('panel-dig')).not.toBeNull();
  });

  it('TS-044-02: SpringFound で「！」（文字と aria-label つき）。T2 を開くと消え、T1 に戻っても消えたまま。次の発見でまた立つ。T2 を開いている間は立たない', () => {
    const s = stateWith({ depth: 30, pumps: { simple: 1 } });
    m = mount({ state: s });
    found(m, 'simple');
    const tab = m.get('tab-2');
    expect(tab.dataset['alert']).toBe('true');
    const mark = tab.querySelector<HTMLElement>('.tab-alert');
    expect(mark?.textContent).toBe('!');
    expect(mark?.getAttribute('aria-label')).toBeTruthy();
    m.click('tab-2');
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
    expect(m.get('panel-inn').dataset['state']).toBe('open');
    found(m, 'simple'); // T2 を開いている間
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
    m.click('tab-1');
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
    found(m, 'co2');
    expect(m.get('tab-2').dataset['alert']).toBe('true');
    // 保存しない: 作り直すと消えている
    m.unmount();
    m = mount({ state: s });
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
  });

  it('TS-044-03: 条件は源泉の発見（深さではない）。① 最深 30m・源泉なし → 隠す ② 図鑑に源泉（転生の後）→ 見せる ③ 湯船だけ → 隠す', () => {
    m = mount({ state: stateWith({ depth: 0, maxDepth: 30 }) });
    m.click('tab-2');
    expect(m.get('panel-inn').dataset['state']).toBe('locked');
    m.unmount();

    const after = stateWith({ depth: 0 });
    after.collection.springsSeen = ['simple'];
    m = mount({ state: after });
    m.click('tab-2');
    expect(m.get('panel-inn').dataset['state']).toBe('open');
    expect(m.get('inn-slot-0').dataset['spring']).toBe('');
    expect(m.get('inn-spring-simple').dataset['found']).toBe('false');
    m.unmount();

    const bathOnly = stateWith({ depth: 10 });
    bathOnly.run.bath.level = 3;
    m = mount({ state: bathOnly });
    m.click('tab-2');
    expect(m.get('panel-inn').dataset['state']).toBe('locked');
  });
});

describe('T2 の中身と入れ替え（TS-044-04〜07）', () => {
  // 単純温泉 Lv8（枠 0）・二酸化炭素泉 Lv12（未接続）・湯船 Lv5（枠 2 つ）
  const make = () => {
    const s = stateWith({ depth: 90, pumps: { simple: 8, co2: 12 }, coins: 0 });
    s.run.bath.level = 5;
    s.run.bath.slots = ['simple', null];
    refreshGuests(s, []);
    return s;
  };

  it('TS-044-04: 枠・源泉とポンプ・湯船のレベル・お客さんがそろい、値は selectors と同じ（日本語・英語）', () => {
    for (const lang of ['ja', 'en'] as const) {
      const s = make();
      m = mount({ state: s, lang });
      // 状態は mount の後に読む（refreshGuests でタヌキが来ている）
      m.click('tab-2');
      const bv = bathView(m.store.state);
      expect(m.get('inn-slot-0').dataset['spring']).toBe('simple');
      expect(m.get('inn-slot-1').dataset['spring']).toBe('');
      expect(m.get('inn-slot-0').textContent).toContain(lang === 'ja' ? '全入湯料 ×1.2' : 'All bath income ×1.2');
      expect(m.q('inn-slot-2')).toBeNull();
      expect(bv.slotCount).toBe(2);
      expect(m.get('inn-spring-simple').dataset['found']).toBe('true');
      expect(m.get('inn-spring-co2').dataset['found']).toBe('true');
      expect(m.get('inn-spring-salt').dataset['found']).toBe('false');
      expect(m.q('buy-pump-simple')).not.toBeNull();
      expect(m.q('buy-pump-co2')).not.toBeNull();
      expect(m.q('buy-pump-salt')).toBeNull(); // 未発見はポンプのボタンを出さない（TS-044-07 ④）
      const bath = m.get('inn-bath');
      expect(bath.dataset['level']).toBe('5');
      expect(bath.dataset['nextSlot']).toBe(String(bv.nextSlotLevel));
      expect(bath.textContent).toContain('25%');
      expect(m.get('buy-bath').dataset['cost']).toBe(toStr(buyQuote(m.store.state, 'bath', 1).nextCost));
      expect(m.get('inn-guest-tanuki').dataset['present']).toBe('true');
      expect(m.root.textContent).not.toMatch(/guest\.|inn\.|effect\.|ui\./); // キー名がそのまま出ない
      m.unmount();
      m = null;
    }
  });

  it('TS-044-05: 源泉を選んで枠を押すと assignSlot が 1 回。dispatch の直後の描画で枠・入湯料が変わる。コインは変わらない', () => {
    m = mount({ state: make() });
    m.click('tab-2');
    const coins = m.store.state.run.coins.toString();
    const sent: unknown[] = [];
    const orig = m.store.dispatch.bind(m.store);
    m.store.dispatch = (a) => {
      sent.push(a);
      return orig(a);
    };
    m.click('inn-spring-co2');
    expect(m.get('inn-spring-co2').getAttribute('aria-pressed')).toBe('true');
    m.click('inn-slot-1');
    expect(sent).toEqual([{ type: 'assignSlot', slot: 1, spring: 'co2' }]);
    expect(m.get('inn-slot-1').dataset['spring']).toBe('co2');
    expect(m.get('inn-slot-1').textContent).toContain('Drill power ×1.5');
    expect(m.get('inn-spring-co2').getAttribute('aria-pressed')).toBe('false');
    expect(m.store.state.run.coins.toString()).toBe(coins);
  });

  it('TS-044-06: すでに枠にある源泉を別の枠に入れると入れ替わる。同じ源泉が 2 つの枠に出ない', () => {
    const s = make();
    s.run.bath.slots = ['simple', 'co2'];
    m = mount({ state: s });
    m.click('tab-2');
    m.click('inn-spring-simple');
    m.click('inn-slot-1');
    expect(m.get('inn-slot-0').dataset['spring']).toBe('co2');
    expect(m.get('inn-slot-1').dataset['spring']).toBe('simple');
  });

  it('TS-044-07: 選ばずに枠を押す・Esc・同じ源泉をもう一度・タブの切り替えでは assignSlot を送らない', () => {
    m = mount({ state: make() });
    m.click('tab-2');
    const sent: unknown[] = [];
    const orig = m.store.dispatch.bind(m.store);
    m.store.dispatch = (a) => {
      sent.push(a);
      return orig(a);
    };
    m.click('inn-slot-1'); // ① 選ばずに
    m.click('inn-spring-co2');
    m.key({ key: 'Escape', code: 'Escape' }); // ② Esc
    expect(m.get('inn-spring-co2').getAttribute('aria-pressed')).toBe('false');
    m.click('inn-slot-1');
    m.click('inn-spring-co2');
    m.click('inn-spring-co2'); // 同じ源泉をもう一度
    expect(m.get('inn-spring-co2').getAttribute('aria-pressed')).toBe('false');
    m.click('inn-slot-1');
    m.click('inn-spring-co2');
    m.click('tab-1'); // タブの切り替え
    m.click('tab-2');
    expect(m.get('inn-spring-co2').getAttribute('aria-pressed')).toBe('false');
    m.click('inn-slot-1');
    expect(sent).toEqual([]);
    expect(m.get('inn-slot-1').dataset['spring']).toBe('');
  });
});

describe('購入・湯船・お客さん（TS-044-08〜11）', () => {
  it('TS-044-08・09: T2 に購入数の切り替えがあり、buy-bath で枠が増えると同じ描画で新しい空きの枠が出る', () => {
    const s = stateWith({ depth: 40, pumps: { simple: 1 }, coins: 1e9 });
    s.run.bath.level = 4;
    s.run.bath.slots = ['simple'];
    m = mount({ state: s });
    m.click('tab-2');
    expect(m.q('qty-toggle')).not.toBeNull();
    expect(m.q('inn-slot-1')).toBeNull();
    m.click('buy-bath');
    expect(m.store.state.run.bath.level).toBe(5);
    expect(m.get('inn-slot-1').dataset['spring']).toBe('');
    expect(m.get('inn-slot-0').dataset['spring']).toBe('simple');
    expect(m.get('inn-bath').dataset['nextSlot']).toBe(String(bathView(m.store.state).nextSlotLevel));
  });

  it('TS-044-10: お客さんの状態を文字と data-state で出す（present・noSpring・notSlotted・levelShort）', () => {
    const s = stateWith({ depth: 160, pumps: { simple: 3, co2: 8, salt: 5 } });
    s.run.bath.level = 5;
    s.run.bath.slots = ['simple', 'co2'];
    refreshGuests(s, []);
    m = mount({ state: s });
    m.click('tab-2');
    const st = (id: string) => m?.get(`inn-guest-${id}`).dataset['state'];
    expect(st('tanuki')).toBe('present');
    expect(st('monkey')).toBe('levelShort');
    expect(m.get('inn-guest-monkey-state').textContent).toBe('Lv 8/10');
    expect(st('capybara')).toBe('notSlotted');
    expect(st('fox')).toBe('noSpring');
    expect(m.get('inn-guest-fox').dataset['present']).toBe('false');
    for (const id of ['tanuki', 'monkey', 'capybara', 'fox']) expect(m.get(`inn-guest-${id}-state`).textContent?.length).toBeGreaterThan(0);
  });

  it('TS-044-11: 辞書に名前のないお客さんの行は出さない（キー名の文字列も出さない）', () => {
    const s = stateWith({ depth: 40, pumps: { simple: 1 } });
    m = mount({ state: s });
    m.click('tab-2');
    for (const id of ['cat', 'redPanda']) {
      expect(m.q(`inn-guest-${id}`) !== null).toBe(hasText(`guest.${id}`));
    }
    expect(m.root.textContent).not.toContain('guest.');
  });
});
