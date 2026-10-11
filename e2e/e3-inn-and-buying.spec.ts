// E2E E3 湯宿と購入（e2e_E3_inn-and-buying.md）。BL-074。
// PR: TS-E3-01〜05・07・08。TS-E3-06（改良タブ T3）は BL-018 のマージの後に同じ流れの最後へ足す。
// シナリオの「実装のまとめ方」のとおり、01〜05・08 は 1 つの流れ（起動 1 回）。05・07 の日本語は ja-JP の context で 1 回。
// 準備: bootGame → pause → getState の写しを直して setState（単純温泉 Lv8〔枠 0〕・二酸化炭素泉 Lv9・塩化物泉 Lv1・湯船 Lv4〔枠 1〕・
// コイン 100 万・最深 150m）。setState では来訪が黙って求め直される（イベントは出ない）ので、判定は状態と画面で行う。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type Harness } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { coinsOf, type Hooks, type SerializedState } from './support/hooks.ts';

const dict = (lang: 'ja' | 'en'): Record<string, string> =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'src', 'i18n', `${lang}.json`), 'utf8')) as Record<string, string>;

/** UI の更新（5Hz）を待つ */
const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

type Run = {
  coins: string;
  depth: number;
  maxDepth: number;
  springs: Record<string, { pump: number } | undefined>;
  bath: { level: number; slots: (string | null)[] };
  guests: string[];
};
const runOf = (s: SerializedState): Run => s.run as unknown as Run;

/** 準備の状態にする */
async function prepare(g: Hooks, coins = '1e6'): Promise<void> {
  await g.pause();
  const s = await g.getState();
  const r = runOf(s);
  r.springs = { simple: { pump: 8 }, co2: { pump: 9 }, salt: { pump: 1 } };
  r.bath = { level: 4, slots: ['simple'] };
  r.coins = coins;
  r.maxDepth = 150;
  r.depth = 150;
  const c = (s as unknown as { collection: { springsSeen: string[] } }).collection;
  c.springsSeen = ['simple', 'co2', 'salt'];
  await g.setState(s);
}

/** 購入数を q にする（qty-toggle で回す） */
async function setQty(page: Page, q: '1' | '10' | 'max'): Promise<void> {
  const t = page.getByTestId('qty-toggle');
  for (let i = 0; i < 3 && (await t.getAttribute('data-qty')) !== q; i++) {
    await t.click();
    await uiTick(page);
  }
  await expect(t).toHaveAttribute('data-qty', q);
}

const num = async (l: Locator, attr: string): Promise<number> => Number(await l.getAttribute(attr));

/** ボタンの表示（数・コスト）を読んでから押し、レベルの増分とコインの減りが表示と一致することを確かめる */
async function buyAndCheck(page: Page, g: Hooks, testId: string, levelOf: (r: Run) => number): Promise<number> {
  const btn = page.getByTestId(testId);
  await expect(btn).toHaveAttribute('data-state', 'affordable');
  const n = await num(btn, 'data-n');
  const cost = await num(btn, 'data-cost');
  const s0 = await g.getState();
  await btn.click();
  await uiTick(page);
  const s1 = await g.getState();
  expect(levelOf(runOf(s1)) - levelOf(runOf(s0)), `${testId}: レベルの増分＝表示の数（×${n}）`).toBe(n);
  expect(coinsOf(s0) - coinsOf(s1), `${testId}: コインの減り＝表示のコスト`).toBeCloseTo(cost, 6);
  return n;
}

test.describe('E3 湯宿と購入', () => {
  test('TS-E3-01〜05・08 枠 2 の解放・無料の入れ替え・お客さんの来訪と帰り・×1／×10／最大の表示と購入の一致・「あと 12 秒」（en-US）', async ({
    page,
    harness,
  }) => {
    const en = dict('en');
    const g = await bootGame(page);
    await prepare(g);
    await uiTick(page);
    await page.getByTestId('tab-2').click();
    await uiTick(page);
    await expect(page.getByTestId('panel-inn')).toHaveAttribute('data-state', 'open');
    await setQty(page, '1');

    // TS-E3-01: ×1 で湯船を Lv5 に → 枠 2（inn-slot-1 は空き）
    const evBefore = (await g.events(1000)).length;
    await buyAndCheck(page, g, 'buy-bath', (r) => r.bath.level);
    let r = runOf(await g.getState());
    expect(r.bath.level).toBe(5);
    expect((await g.events(1000)).slice(evBefore).filter((e) => e.type === 'SlotUnlocked' && e.n === 2), 'SlotUnlocked{n:2}').toHaveLength(1);
    await expect(page.getByTestId('inn-slot-1')).toBeVisible();
    expect(r.bath.slots).toEqual(['simple', null]);
    await expect(page.getByTestId('inn-slot-1')).not.toHaveAttribute('data-spring', /./);

    // TS-E3-02: 二酸化炭素泉を枠 2 へ（無料）。ニホンザルはまだ（Lv9）
    const income0 = await page.getByTestId('hud-income').getAttribute('data-value');
    const c0 = coinsOf(await g.getState());
    await page.getByTestId('inn-spring-co2').click();
    await page.getByTestId('inn-slot-1').click();
    await uiTick(page);
    r = runOf(await g.getState());
    expect(coinsOf(await g.getState()), '入れ替えは無料').toBe(c0);
    expect(r.bath.slots[1]).toBe('co2');
    await expect(page.getByTestId('inn-slot-1')).toHaveAttribute('data-spring', 'co2');
    await expect(page.getByTestId('hud-income'), '毎秒の収入が新しい値').not.toHaveAttribute('data-value', income0 ?? '');
    await expect(page.getByTestId('inn-guest-monkey')).toHaveAttribute('data-present', 'false');
    expect(r.guests).not.toContain('monkey');

    // TS-E3-03: 二酸化炭素泉を Lv10 → ニホンザルが来る。塩化物泉に入れ替えると帰る（タヌキは残る・ポンプは Lv10 のまま）
    await buyAndCheck(page, g, 'buy-pump-co2', (x) => x.springs.co2?.pump ?? 0);
    r = runOf(await g.getState());
    expect(r.springs.co2?.pump).toBe(10);
    expect(r.guests).toContain('monkey');
    await expect(page.getByTestId('inn-guest-monkey')).toHaveAttribute('data-present', 'true');
    await page.getByTestId('inn-spring-salt').click();
    await page.getByTestId('inn-slot-1').click();
    await uiTick(page);
    r = runOf(await g.getState());
    expect(r.bath.slots).toEqual(['simple', 'salt']);
    expect(r.guests, '入れ替えでニホンザルが帰る').not.toContain('monkey');
    expect(r.guests, 'タヌキは残る').toContain('tanuki');
    expect(r.springs.co2?.pump, '入れ替えで損をしない').toBe(10);
    await expect(page.getByTestId('inn-guest-monkey')).toHaveAttribute('data-present', 'false');

    // TS-E3-04: ×1・×10（切り替えボタン）・最大（Shift）で、表示の数・コストと実際の購入が一致する
    const simpleLv = (x: Run): number => x.springs.simple?.pump ?? 0;
    await setQty(page, '1');
    expect(await buyAndCheck(page, g, 'buy-pump-simple', simpleLv)).toBe(1);
    await setQty(page, '10');
    expect(await buyAndCheck(page, g, 'buy-pump-simple', simpleLv)).toBe(10);
    expect(await buyAndCheck(page, g, 'buy-bath', (x) => x.bath.level)).toBe(10);
    await page.keyboard.press('Shift');
    await uiTick(page);
    await expect(page.getByTestId('qty-toggle'), 'Shift で ×10 → 最大').toHaveAttribute('data-qty', 'max');
    const nMax = await buyAndCheck(page, g, 'buy-pump-simple', simpleLv);
    expect(nMax, '最大は今のコインで買える数（1 以上）').toBeGreaterThanOrEqual(1);
    // 足りないボタンは押しても状態が変わらない（最大で買い切った後の ×10）
    await setQty(page, '10');
    const lacking = page.locator('[data-testid^="buy-"][data-state="insufficient"]').first();
    await expect(lacking).toBeVisible();
    const h0 = await g.stateHash();
    await lacking.click({ force: true });
    await uiTick(page);
    expect(await g.stateHash(), '足りないボタンは押しても状態が変わらない').toBe(h0);

    // TS-E3-05（en-US）: 「あと 12 秒」→ 1 秒後に 11 → 足りたら affordable で -eta が消える
    await setQty(page, '1');
    await expectEta12(page, g, en);

    // TS-E3-08: 例外・console.error・errors() が 0（共通の検査はテストの終わりに harness が行う）
    await expectClean(g, harness);
  });

  test('TS-E3-05・07（ja-JP）「あと 12 秒」の日本語と、T2 の数の表記（所持とコストは同じ切り捨て。表記が同じで足りないときは「あと 0」にならない）', async ({
    harness,
  }) => {
    const ja = dict('ja');
    const page = await harness.newPage({ locale: 'ja-JP' });
    const g = await bootGame(page);
    await prepare(g);
    await uiTick(page);
    await page.getByTestId('tab-2').click();
    await uiTick(page);
    await setQty(page, '1');
    await expectEta12(page, g, ja);

    // TS-E3-07: 所持がコストのすぐ下（表記が同じになる）→ insufficient で -eta が出て、「あと 0」にならない
    // 1 万以上のコストにするため ×10 で見る
    await setQty(page, '10');
    const btn = page.getByTestId('buy-pump-co2');
    const cost = await num(btn, 'data-cost');
    expect(cost, '万の単位の表記になる大きさ').toBeGreaterThanOrEqual(1e4);
    const s = await g.getState();
    runOf(s).coins = String(cost * (1 - 1e-7));
    await g.setState(s);
    await uiTick(page);
    const head = (t: string | null): string => (t ?? '').trim().split(/\s+/)[0] ?? '';
    const coinsText = head(await page.getByTestId('hud-coins').textContent());
    const costText = head(await page.getByTestId('buy-pump-co2-cost').textContent());
    expect(coinsText, '所持とコストが同じ表記（同じ切り捨て）').toBe(costText);
    expect(coinsText, '日本語の万進').toMatch(/万$/);
    await expect(btn).toHaveAttribute('data-state', 'insufficient');
    const eta = page.getByTestId('buy-pump-co2-eta');
    await expect(eta, '足りないので -eta が出る').toBeVisible();
    expect(await num(eta, 'data-seconds'), '「あと 0」にならない（切り上げ）').toBeGreaterThanOrEqual(1);
    await expect(eta).not.toHaveText(ja['eta.sec']!.replace('{n}', '0'));
    await expectClean(g, harness);
  });
});

/** TS-E3-05: 次の購入（×1）まで「あと 12 秒」になる所持にして、1 秒後に 11、足りたら affordable。コストが 12 秒ぶんの収入より大きいボタンを使う */
async function expectEta12(page: Page, g: Hooks, d: Record<string, string>): Promise<void> {
  const rate = await num(page.getByTestId('hud-income'), 'data-value');
  expect(rate, '毎秒の収入がある').toBeGreaterThan(0);
  let id = '';
  let cost = 0;
  for (const c of ['buy-pump-simple', 'buy-pump-co2', 'buy-pump-salt', 'buy-bath']) {
    cost = await num(page.getByTestId(c), 'data-cost');
    if (cost > 12 * rate) {
      id = c;
      break;
    }
  }
  expect(id, 'コストが 12 秒ぶんの収入より大きいボタンがある').not.toBe('');
  const btn = page.getByTestId(id);
  const s = await g.getState();
  runOf(s).coins = String(cost - 11.5 * rate); // 不足 d＝11.5r → ceil(d ÷ r)＝12
  await g.setState(s);
  await uiTick(page);
  const eta = page.getByTestId(`${id}-eta`);
  await expect(btn).toHaveAttribute('data-state', 'insufficient');
  await expect(eta).toHaveAttribute('data-seconds', '12');
  await expect(eta).toHaveText(d['eta.sec']!.replace('{n}', '12'));
  await g.advance(1_000);
  await uiTick(page);
  await expect(eta, '1 秒後に 11').toHaveText(d['eta.sec']!.replace('{n}', '11'));
  await g.advance(11_000);
  await uiTick(page);
  await expect(btn, '足りた時点で affordable').toHaveAttribute('data-state', 'affordable');
  await expect(eta, '-eta が消える').toHaveCount(0);
}

async function expectClean(g: Hooks, harness: Harness): Promise<void> {
  expect(await harness.uncaughtErrors()).toEqual([]);
  expect(harness.consoleErrors).toEqual([]);
  expect(await g.errors()).toEqual([]);
}
