// @vitest-environment jsdom
// BL-043: useGame・購入ボタン・T1・タブ・購入数を、本物の store・core とつないで jsdom で確かめる
// （TS-043-01・03・04・06〜08・10〜12・14・15。中・低の 02・05・13・16 も軽いのでここで流す）
import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { buyQuote, createInitialState, num, stateHash, sub, sumGeometric, type GameState } from '../../src/core/index.ts';
import { PARAMS } from '../../src/content/params.ts';
import { TOOLS } from '../../src/content/tools.ts';
import { useGame } from '../../src/ui/hooks/use-game.ts';
import { stateWith } from '../support/states.ts';
import { mount, type Mounted } from '../support/ui.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const data = (el: HTMLElement, k: string): string | undefined => el.dataset[k];
const drillSum = (n: number, owned = 0) => sumGeometric(n, PARAMS.drill.c0, PARAMS.drill.r, owned);

describe('useGame（TS-043-01・02）', () => {
  it('購読した値が変わったときだけ描き直す: コインの部品は変わるたびに、ドリルのレベルの部品は 1 回も描き直さない', () => {
    const renders = { coins: 0, level: 0 };
    function Coins() {
      const c = useGame((s) => s.run.coins.toString());
      renders.coins++;
      return h('span', { 'data-testid': 'c' }, c);
    }
    function Level() {
      const l = useGame((s) => s.run.drill.level);
      renders.level++;
      return h('span', { 'data-testid': 'l' }, l);
    }
    m = mount({ state: stateWith(), node: h('div', null, h(Coins, null), h(Level, null)) });
    const base = { ...renders };
    m.run((st) => st.tick(0));
    // 1 秒: 100ms ごとにコインだけが変わり、ループと同じく 200ms ごとに通知（5Hz。dispatch はしない）
    let lastCoins = m.get('c').textContent;
    let changed = 0;
    for (let t = 100; t <= 1000; t += 100) {
      m.run((st) => {
        st.state.run.coins = st.state.run.coins.add(1);
        st.tick(t);
      });
      const now = m.get('c').textContent;
      if (now !== lastCoins) changed++;
      lastCoins = now;
    }
    expect(changed).toBeGreaterThan(0);
    expect(renders.coins - base.coins).toBe(changed); // 変わったときだけ
    expect(renders.coins - base.coins).toBeLessThanOrEqual(5); // 5Hz 以内（TS-043-02）
    expect(renders.level - base.level).toBe(0);
  });
  it('props が変わった描画では、次の通知を待たずに今の selector の値を出す（×1 → ×10 ですぐにコストが変わる）', () => {
    m = mount({ state: stateWith({ coins: 1000 }) });
    const cost1 = data(m.get('buy-drill'), 'cost');
    m.click('qty-toggle');
    expect(num(data(m.get('buy-drill'), 'cost')).eq(drillSum(10))).toBe(true);
    expect(data(m.get('buy-drill'), 'cost')).not.toBe(cost1);
  });
});

describe('T1 の中身と購入ボタンの表示（TS-043-03・11）', () => {
  it('新しいゲーム: ドリル・自動掘削機・道具の進化に -name・-level・-cost・-effect がある。道具は次の段の名前・見た目のプレビュー', () => {
    m = mount({ state: createInitialState(1) });
    expect(m.q('panel-dig')).not.toBeNull();
    for (const id of ['buy-drill', 'buy-auto-digger', 'buy-tool']) {
      for (const part of ['name', 'level', 'cost', 'effect']) expect(m.q(`${id}-${part}`), `${id}-${part}`).not.toBeNull();
    }
    expect(m.get('buy-drill-level').textContent).toBe('Lv 0');
    expect(m.get('buy-drill-effect').textContent).toBe('Power ×2'); // Lv0 → Lv1 で威力 1 → 2
    expect(m.get('buy-auto-digger-effect').textContent).toBe('+0.2 hits/s');
    expect(m.get('buy-tool-name').textContent).toBe('Evolve to Pickaxe');
    expect(m.get('buy-tool-level').textContent).toBe('Shovel');
    expect(m.get('buy-tool-effect').textContent).toBe('Power ×1.5, auto dig');
    const preview = m.get('buy-tool').querySelector<HTMLElement>('.tool-preview');
    expect(preview?.dataset['tool']).toBe('pickaxe');
    expect(preview?.style.backgroundImage).toContain('atlas');
    // S1 では 1 行目（ツルハシ）が 3 コイン
    expect(num(data(m.get('buy-tool'), 'cost')).eq(3)).toBe(true);
  });
});

describe('状態 3 種と「あと N 秒」（TS-043-04・05）', () => {
  it('ツルハシ: 2.99 で insufficient（-eta あり）、3 にすると次の通知（200ms 以内）で affordable', () => {
    const s = stateWith({ coins: 2.99, tool: 0 });
    m = mount({ state: s });
    const b = m.get('buy-tool');
    expect(data(b, 'state')).toBe('insufficient');
    expect(m.q('buy-tool-eta')).not.toBeNull();
    m.run((st) => {
      st.state.run.coins = num(3);
      st.tick(0);
      st.tick(200);
    });
    expect(data(b, 'state')).toBe('affordable');
    expect(m.q('buy-tool-eta')).toBeNull();
  });
  it('手掘りやぐら: 最深 24m で locked（「25m で解放」・押せない）、25m で insufficient か affordable', () => {
    m = mount({ state: stateWith({ tool: 1, depth: 24, coins: 10 }) });
    const b = m.get('buy-tool') as HTMLButtonElement;
    expect(data(b, 'state')).toBe('locked');
    expect(b.disabled).toBe(true);
    expect(data(m.get('buy-tool-lock'), 'depth')).toBe(String(TOOLS[2]?.unlockDepth));
    expect(m.get('buy-tool-lock').textContent).toBe('Unlocks at 25m');
    m.run((st) => {
      st.state.run.maxDepth = 25;
      st.notify();
    });
    expect(['insufficient', 'affordable']).toContain(data(b, 'state'));
    expect(b.disabled).toBe(false);
    expect(m.q('buy-tool-lock')).toBeNull();
  });
  it('収入 0 のときは時間を出さず「あと N コイン」（N＝足りない額。data-seconds なし）', () => {
    m = mount({ state: stateWith({ coins: 0 }) });
    const eta = m.get('buy-tool-eta');
    expect(eta.textContent).toBe('3 coins short');
    expect(eta.dataset['seconds']).toBeUndefined();
    expect(num(eta.dataset['lack']).eq(3)).toBe(true);
  });
  it('収入があるときは「あと N 秒」（切り上げ。HUD の毎秒の収入と同じ selector）', () => {
    // ツルハシ済み・自動掘りオンで収入が出る状態。ドリルの次のコストまでの秒数を出す
    m = mount({ state: stateWith({ coins: 0, tool: 1, autoOn: true, depth: 3 }) });
    const eta = m.get('buy-drill-eta');
    const sec = Number(eta.dataset['seconds']);
    expect(sec).toBeGreaterThan(0);
    const income = Number(m.get('hud-income').dataset['value']);
    expect(sec).toBe(Math.ceil(5 / income - 1e-9));
    expect(eta.textContent).toMatch(sec < 60 ? new RegExp(`^${sec}s to go$`) : /min to go|h to go/);
  });
});

describe('×1／×10／最大 と実際の購入（TS-043-06・07・08）', () => {
  const pressQty = (target: 1 | 10 | 'max') => {
    for (let i = 0; i < 3 && m?.get('qty-toggle').dataset['qty'] !== String(target); i++) m?.click('qty-toggle');
    expect(m?.get('qty-toggle').dataset['qty']).toBe(String(target));
  };
  it('×10 の合計ちょうど（Lv0 で約 106.60735）: 「×10」とそのコストで affordable。押すと Lv10・コイン 0（負にならない）', () => {
    const s = stateWith();
    s.run.coins = buyQuote(s, 'drill', 10).cost;
    m = mount({ state: s });
    pressQty(10);
    const b = m.get('buy-drill');
    expect(data(b, 'state')).toBe('affordable');
    expect(m.get('buy-drill-qty').textContent?.trim()).toBe('×10');
    expect(num(data(b, 'cost')).eq(drillSum(10))).toBe(true);
    expect(num(data(b, 'cost')).toNumber()).toBeCloseTo(106.60735, 4);
    m.click('buy-drill');
    expect(m.store.state.run.drill.level).toBe(10);
    expect(m.store.state.run.coins.eq(0)).toBe(true);
  });
  it('×10 に少し足りない（106.607）: insufficient で、押しても状態が変わらない', () => {
    m = mount({ state: stateWith({ coins: '106.607' }) });
    pressQty(10);
    expect(data(m.get('buy-drill'), 'state')).toBe('insufficient');
    const h0 = stateHash(m.store.state);
    m.click('buy-drill');
    expect(stateHash(m.store.state)).toBe(h0);
  });
  it('最大で 7 個ぶん＋少し: 「×7」と 7 個の合計を出し、押すと Lv7・コインの減りが表示と同じ', () => {
    const coins = drillSum(7).add(0.5);
    m = mount({ state: stateWith({ coins: coins.toString() }) });
    pressQty('max');
    const b = m.get('buy-drill');
    expect([data(b, 'state'), data(b, 'n')]).toEqual(['affordable', '7']);
    expect(m.get('buy-drill-qty').textContent?.trim()).toBe('×7');
    const shown = num(data(b, 'cost'));
    expect(shown.eq(drillSum(7))).toBe(true);
    const before = m.store.state.run.coins;
    m.click('buy-drill');
    expect(m.store.state.run.drill.level).toBe(7);
    expect(m.store.state.run.coins.eq(sub(before, shown))).toBe(true);
  });
  it('最大で 1 個も買えない: insufficient で「×0」「0 コイン」は出さず、次の 1 個のコストと目安を出す。押しても何も買わない', () => {
    m = mount({ state: stateWith({ coins: 1 }) });
    pressQty('max');
    const b = m.get('buy-drill');
    expect([data(b, 'state'), data(b, 'n')]).toEqual(['insufficient', '0']);
    expect(m.q('buy-drill-qty')).toBeNull();
    expect(num(data(b, 'cost')).eq(drillSum(1))).toBe(true);
    expect(m.get('buy-drill-cost').textContent).toBe('5 coins');
    expect(m.q('buy-drill-eta')).not.toBeNull();
    const h0 = stateHash(m.store.state);
    m.click('buy-drill');
    expect(stateHash(m.store.state)).toBe(h0);
  });
});

describe('購入数の切り替え（TS-043-10）', () => {
  it('ボタンで ×1 → ×10 → 最大 → ×1。Shift は 1 回で 1 段、自動リピートでは進まない。タブをまたいで同じ、作り直すと ×1', () => {
    m = mount();
    const q = () => m?.get('qty-toggle').dataset['qty'];
    expect(q()).toBe('1');
    m.click('qty-toggle');
    expect(q()).toBe('10');
    m.click('qty-toggle');
    expect(q()).toBe('max');
    m.click('qty-toggle');
    expect(q()).toBe('1');
    m.key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    expect(q()).toBe('10');
    for (let i = 0; i < 5; i++) m.key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, repeat: true });
    expect(q()).toBe('10');
    m.click('tab-2');
    expect(q()).toBe('10'); // T2（湯宿。BL-044）にも購入の一覧があり、購入数はタブをまたいで同じ
    m.click('tab-3');
    expect(m.q('qty-toggle')).toBeNull(); // T3 には出さない（Q-38 (e)）
    m.click('tab-1');
    expect(q()).toBe('10');
    m.unmount();
    m = mount();
    expect(q()).toBe('1');
  });
});

describe('タブ（TS-043-12・13）', () => {
  const selected = () => [1, 2, 3, 4, 5].filter((n) => m?.get(`tab-${n}`).getAttribute('aria-selected') === 'true');
  it('tab-1〜tab-5 のクリックと 1〜5 キーで切り替わり aria-selected が移る。T2 は panel-inn（BL-044）、T3〜T5 は panel-placeholder、T1 は panel-dig', () => {
    m = mount();
    expect(selected()).toEqual([1]);
    expect(m.q('panel-dig')).not.toBeNull();
    for (const n of [2, 3, 4, 5]) {
      m.click(`tab-${n}`);
      expect(selected()).toEqual([n]);
      expect(m.q(n === 2 ? 'panel-inn' : 'panel-placeholder')).not.toBeNull();
      expect(m.q('panel-dig')).toBeNull();
    }
    for (const n of [3, 1, 5, 2, 4, 1]) {
      m.key({ key: String(n), code: `Digit${n}` });
      expect(selected()).toEqual([n]);
    }
    expect(m.q('panel-dig')).not.toBeNull();
  });
  it('Ctrl＋1・Alt＋1・F1・Ctrl＋Space・Alt＋Space では切り替わらない', () => {
    m = mount();
    m.click('tab-3');
    for (const init of [
      { key: '1', code: 'Digit1', ctrlKey: true },
      { key: '1', code: 'Digit1', altKey: true },
      { key: 'F1', code: 'F1' },
      { key: ' ', code: 'Space', ctrlKey: true },
      { key: ' ', code: 'Space', altKey: true },
    ])
      m.key(init);
    expect(selected()).toEqual([3]);
  });
});

describe('二重の購入を防ぐ・道具の最後・自動掘りの解放（TS-043-14・15・16）', () => {
  it('コインがちょうど 1 個ぶん: すばやく 2 回押しても 1 個だけ買え、2 回目は状態を変えない（例外なし）', () => {
    const s = stateWith();
    s.run.coins = buyQuote(s, 'drill', 1).cost;
    m = mount({ state: s });
    const b = m.get('buy-drill');
    const results: boolean[] = [];
    const orig = m.store.dispatch.bind(m.store);
    m.store.dispatch = (a) => {
      const r = orig(a);
      results.push(r.ok);
      return r;
    };
    expect(() => {
      b.click(); // 描き直しを待たずに 2 回（50ms 以内のダブルクリックの代わり）
      b.click();
    }).not.toThrow();
    expect(results).toEqual([true, false]);
    expect(m.store.state.run.drill.level).toBe(1);
    expect(m.store.state.run.coins.eq(0)).toBe(true);
  });
  it('UI でツルハシを買うと自動掘りが locked → off になり、押すと on', () => {
    m = mount({ state: stateWith({ coins: 3 }) });
    expect(data(m.get('toggle-auto-dig'), 'state')).toBe('locked');
    m.click('buy-tool');
    expect(m.store.state.run.drill.tool).toBe(1);
    expect(data(m.get('toggle-auto-dig'), 'state')).toBe('off');
    m.click('toggle-auto-dig');
    expect(data(m.get('toggle-auto-dig'), 'state')).toBe('on');
  });
  it('道具が最後の段（伝説のドリル）: buy-tool は maxed・押せない・コストと目安は出さない。例外なし', () => {
    const s: GameState = stateWith({ tool: TOOLS.length - 1, coins: 1e15, depth: 500 });
    m = mount({ state: s });
    const b = m.get('buy-tool') as HTMLButtonElement;
    expect(data(b, 'state')).toBe('maxed');
    expect(b.disabled).toBe(true);
    expect(m.q('buy-tool-cost')).toBeNull();
    expect(m.q('buy-tool-eta')).toBeNull();
    expect(m.get('buy-tool-level').textContent).toBe('Legendary drill');
    const h0 = stateHash(m.store.state);
    expect(() => m?.click('buy-tool')).not.toThrow();
    expect(stateHash(m.store.state)).toBe(h0);
  });
});
