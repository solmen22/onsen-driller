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

  it('TS-044-13（CEO 決定 2026-10-18〔H-1 の案 a〕で期待を変更）: 買える改良を押すと buy が 1 回で、同じ位置のまま購入済み（押せない）になる。組の入れ替えは次に T3 を開いたとき。購入済みを押しても何も起きない。コインの減り＝表示のコスト', () => {
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
    // 開いている間は同じ位置（上の組）のまま購入済み
    expect(rowIds(m.get('upgrades-available'))).toEqual([id('vibroBit')]);
    expect(m.get(id('vibroBit')).dataset['state']).toBe('maxed');
    expect(m.q('upgrades-bought')).toBeNull();
    expect((m.get(id('vibroBit')) as HTMLButtonElement).disabled).toBe(true);
    // 購入済みを押しても何も起きない（disabled なので click が届かない。core も maxed で断る）
    const c1 = m.store.state.run.coins.toString();
    m.click(id('vibroBit'));
    expect(m.store.state.run.coins.toString()).toBe(c1);
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    // 次に T3 を開くと、購入済みの組に移る
    m.click('tab-1');
    m.click('tab-3');
    expect(rowIds(m.get('upgrades-bought'))).toEqual([id('vibroBit')]);
    expect(m.get('upgrades-available').dataset['count']).toBe('0');
  });

  it('H-1（案 a）: 買える改良が 2 つ並んでいるとき、上の行を素早く 2 回押しても、下の改良は買わない（指の下に別の改良が来ない）', () => {
    const s = stateWith({ depth: 52, coins: VIBRO + SIEVE });
    m = mount({ state: s });
    m.click('tab-3');
    expect(rowIds(m.get('upgrades-available'))).toEqual([id('vibroBit'), id('sieve')]);
    const firstRow = (): HTMLElement => m!.get('upgrades-available').querySelector<HTMLElement>('button[data-testid^="buy-upgrade-"]')!;
    // 押して描画まで流す（m.run の act。素の click と notify だけでは、2 回目の前に描画が反映されない。PR #72 の再レビューの S-4）
    m.run(() => firstRow().click());
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    // 2 回目の前: 1 行目はまだ振動ビットで、購入済み（押せない）。下の選鉱ざるは 2 行目のまま
    expect(firstRow().dataset['testid']).toBe(id('vibroBit'));
    expect(firstRow().dataset['state']).toBe('maxed');
    expect(rowIds(m.get('upgrades-available'))).toEqual([id('vibroBit'), id('sieve')]);
    // 2 回目も同じ位置（1 行目）を押す
    m.run(() => firstRow().click());
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    expect(m.get(id('sieve')).dataset['state']).toBe('affordable');
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
    expect(e.textContent).toContain('Unlocks at 40m (28m to go)');
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
    // 開いている間は同じ位置のまま（全部 maxed）。開き直すと購入済みの組に移り、「すべての改良を買いました」
    expect(m.get('upgrades-available').dataset['count']).toBe(String(UPGRADES.length));
    for (const u of UPGRADES) expect(m.get(id(u.id)).dataset['state']).toBe('maxed');
    m.click('tab-1');
    m.click('tab-3');
    expect(m.get('upgrades-available').dataset['count']).toBe('0');
    expect(m.get('upgrades-bought').dataset['count']).toBe(String(UPGRADES.length));
    expect(m.get('upgrades-none').textContent).toBe('All upgrades bought');
  });

  it('解放したものを全部買い、まだ未解放があるときは「解放した改良はすべて買いました」と次の改良', () => {
    const s = stateWith({ depth: 60 });
    s.run.upgrades = ['vibroBit', 'sieve'];
    m = mount({ state: s });
    m.click('tab-3');
    expect(m.get('upgrades-none').textContent).toBe('You have bought every unlocked upgrade');
    expect(m.q('upgrades-next')).not.toBeNull();
  });

  it('S-1: 未発見の源泉のポンプが条件のときは「〇m で〇〇を見つけ、ポンプ Lv N で解放（あと 〇m）」（Lv 0/25 と出さない）', () => {
    // 最深 230m・二酸化炭素泉・塩化物泉は Lv25 以上（湯もみ板 2 つは解放）。硫黄泉（250m）は未発見 → 残る未解放は湯もみ板（硫黄泉）だけ
    const s = stateWith({ depth: 230, pumps: { simple: 30, co2: 25, salt: 25 }, bath: 3 });
    for (const lang of ['ja', 'en'] as const) {
      m = mount({ state: s, lang });
      m.click('tab-3');
      const n = m.get('upgrades-next');
      expect(n.dataset['id']).toBe('yumomiSulfur');
      expect(n.dataset['unfound']).toBe('true');
      expect(n.textContent).toContain(lang === 'ja' ? '250m で硫黄泉を見つけ、ポンプ Lv 25 で解放（あと 20m）' : 'Find Sulfur spring at 250m, then pump Lv 25 (20m to go)');
      expect(n.textContent).not.toContain('0/25');
      m.unmount();
      m = null;
    }
    // 見つけた後は「Lv 今/目標」
    const s2 = stateWith({ depth: 260, pumps: { simple: 30, co2: 25, salt: 25, sulfur: 3 }, bath: 4 });
    m = mount({ state: s2, lang: 'ja' });
    m.click('tab-3');
    expect(m.get('upgrades-next').dataset['unfound']).toBe('false');
    expect(m.get('upgrades-next').textContent).toContain('硫黄泉のポンプ Lv 3/25 で解放');
  });

  it('TS-044-20（H-2・Q-51）: 冒頭の説明は、T3 を開いた時点でまだ 1 つも買っていないとき（解放 0 を含む）だけ出す。開いている間に最初の 1 つを買っても消さず、次に開いたときに消す', () => {
    m = mount({ state: stateWith({ depth: 10 }) });
    m.click('tab-3');
    expect(m.q('upgrades-intro')).not.toBeNull();
    m.unmount();
    m = mount({ state: stateWith({ depth: 60 }) });
    m.click('tab-3');
    expect(m.q('upgrades-intro')).not.toBeNull();
    m.unmount();
    const s = stateWith({ depth: 60 });
    s.run.upgrades = ['vibroBit'];
    m = mount({ state: s });
    m.click('tab-3');
    expect(m.q('upgrades-intro')).toBeNull();
    m.unmount();
    // 開いたまま最初の 1 つを買う → 説明は残る（行を上に詰めない。PR #72 の再レビューの Must）→ 開き直すと消える
    m = mount({ state: stateWith({ depth: 60, coins: VIBRO }) });
    m.click('tab-3');
    expect(m.q('upgrades-intro')).not.toBeNull();
    m.click(id('vibroBit'));
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    expect(m.q('upgrades-intro')).not.toBeNull();
    m.click('tab-1');
    m.click('tab-3');
    expect(m.q('upgrades-intro')).toBeNull();
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

describe('改良のタブの「！」（新しい改良の解放。CEO 2026-10-18。消え方は T2 と同じ）', () => {
  const unlockTo = (mm: Mounted, depth: number): void =>
    mm.run((st) => {
      st.state.run.maxDepth = Math.max(st.state.run.maxDepth, depth);
      st.notify();
    });

  it('解放で「！」（文字と aria-label つき）。T3 を開くと消え、T1 に戻っても消えたまま。次の解放でまた立つ。T3 を開いている間は立たない', () => {
    m = mount({ state: stateWith({ depth: 30 }) });
    const tab = (): HTMLElement => m!.get('tab-3');
    expect(tab().dataset['alert']).toBeUndefined();
    unlockTo(m, 40); // 振動ビット（40m）
    expect(tab().dataset['alert']).toBe('true');
    const mark = tab().querySelector<HTMLElement>('.tab-alert');
    expect(mark?.textContent).toBe('!');
    expect(mark?.getAttribute('aria-label')).toBeTruthy();
    // 湯宿のタブには出ない
    expect(m.get('tab-2').dataset['alert']).toBeUndefined();
    m.click('tab-3');
    expect(tab().dataset['alert']).toBeUndefined();
    unlockTo(m, 50); // T3 を開いている間の解放（選鉱ざる）
    expect(tab().dataset['alert']).toBeUndefined();
    m.click('tab-1');
    expect(tab().dataset['alert']).toBeUndefined();
    unlockTo(m, 70); // 宿帳
    expect(tab().dataset['alert']).toBe('true');
    m.key({ key: '3', code: 'Digit3' }); // キーで開いても消える
    expect(tab().dataset['alert']).toBeUndefined();
  });

  it('起動・読み込みの直後に解放済みのものでは立たない。保存しない（作り直すと消えている）。買っても（解放は増えない）立たない', () => {
    const s = stateWith({ depth: 60, coins: VIBRO * 10 });
    m = mount({ state: s });
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
    m.run((st) => st.dispatch({ type: 'buy', item: 'upgrade:vibroBit', qty: 1 }));
    expect(m.store.state.run.upgrades).toEqual(['vibroBit']);
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
    unlockTo(m, 70);
    expect(m.get('tab-3').dataset['alert']).toBe('true');
    m.unmount();
    m = mount({ state: s });
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
  });

  it('ポンプの条件での解放でも立つ（のれん: 単純温泉のポンプ Lv5）', () => {
    m = mount({ state: stateWith({ depth: 35, pumps: { simple: 4 }, bath: 1 }) });
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
    m.run((st) => {
      st.state.run.springs.simple = { pump: 5 };
      st.notify();
    });
    expect(m.get('tab-3').dataset['alert']).toBe('true');
  });

  it('S-3: 転生で戻った後に、もう一度解放したときも立つ（BL-021 の前なので状態を直接戻す。BL-021 の PR では本物の転生の action で同じことを確かめる）', () => {
    m = mount({ state: stateWith({ depth: 30 }) });
    unlockTo(m, 40);
    expect(m.get('tab-3').dataset['alert']).toBe('true');
    m.click('tab-3');
    m.click('tab-1');
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
    // 周回を戻す（転生の代わり）: 解放はなくなるので立たない
    m.run((st) => {
      st.state.run.maxDepth = 0;
      st.state.run.depth = 0;
      st.state.run.upgrades = [];
      st.state.run.springs = {};
      st.notify();
    });
    expect(m.get('tab-3').dataset['alert']).toBeUndefined();
    // 同じ改良をもう一度解放すると立つ（一度見た改良でも、戻った後の再解放は新しい解放として数える）
    unlockTo(m, 40);
    expect(m.get('tab-3').dataset['alert']).toBe('true');
  });
});
