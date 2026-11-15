// E2E: E7 オフラインからの復帰（おかえり）— BL-076 の E7・BL-030 の TS-030-15（BL-030_offline.md）
// - タブの経路: awayTab（e2e/support/boot.ts。案 0〔CEO 決定 2026-11-15〕: 製品にフックを足さず、setHidden で隠す → setClock で app の
//   壁時計だけを進める → setHidden で見せる。wireVisibility が隠れた時刻から離れていた時間で store.resume を呼ぶ）
// - 起動の経路: 保存した枠を持って新しい context を開き、savedAt から離れた時刻で起動する（main.ts の読み込みの後の store.resume）
// - 60 秒（PARAMS.offline.awayMs）未満はオンラインの規則（効率 100%）で追いつき、おかえりは出ない。以上はオフラインの規則とおかえり
//   （決定 0012 追記 BL-030 の 2）。オフラインではロジックの時間（clock.playedMs）を進めない（同 4）
// - 金額は core の計算（run.pendingOffline）と画面を突き合わせる。式そのものは unit（tests/unit/offline.test.ts）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { awayTab, bootGame, triggerAutosave } from './support/boot.ts';
import type { Hooks } from './support/hooks.ts';
import { readSlots, newerOlder, reopenWithStorage } from './support/storage.ts';

const HOUR = 3_600_000;
const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

type RunView = { coins: string; pendingOffline: { coins: string; ms: number } | null };
const runOf = async (g: Hooks): Promise<RunView> => (await g.getState()).run as unknown as RunView;
const coinsOf = async (g: Hooks): Promise<number> => Number((await runOf(g)).coins);
const ticketsOf = async (g: Hooks): Promise<number> => (await g.getState()).meta.tickets ?? Number.NaN;
const playedOf = async (g: Hooks): Promise<number> => ((await g.getState()) as unknown as { clock: { playedMs: number } }).clock.playedMs;

/** 留守の間に収入がある状態: 単純温泉を発見・ポンプ Lv10・枠に入れる。ロジックは止める（実時間のループで値が動かないように） */
async function withIncome(page: Page, g: Hooks): Promise<void> {
  await g.pause();
  const s = await g.getState();
  const r = s.run as unknown as { coins: string; depth: number; maxDepth: number; springs: Record<string, { pump: number }>; bath: { level: number; slots: (string | null)[] } };
  r.springs = { simple: { pump: 10 } };
  r.bath = { level: 0, slots: ['simple'] };
  r.depth = 40;
  r.maxDepth = 40;
  r.coins = '0';
  (s as unknown as { collection: { springsSeen: string[] } }).collection.springsSeen = ['simple'];
  await g.setState(s);
  await uiTick(page);
}

/** 直近の受け取り（OfflineClaimed。なければ null） */
async function claimed(g: Hooks): Promise<{ mode: string; source: string | null; coins: number } | null> {
  const e = (await g.events(500)).filter((x) => x.type === 'OfflineClaimed').pop() as { mode: string; source?: string; coins: string } | undefined;
  return e ? { mode: e.mode, source: e.source ?? null, coins: Number(e.coins) } : null;
}

/** タブから戻った直後: 動き出したループを止めてから UI を更新する（値を比べるため。awayTab の注） */
async function backAndSettle(page: Page, g: Hooks): Promise<void> {
  await g.pause();
  await uiTick(page);
}

/** おかえりが出ていて、未受け取りの分が core にある。その分（コイン・ms）を返す */
async function expectWelcome(page: Page, g: Hooks): Promise<{ coins: number; ms: number }> {
  await expect(page.getByTestId('modal-welcome')).toBeVisible();
  const p = (await runOf(g)).pendingOffline;
  expect(p, 'run.pendingOffline がある').not.toBeNull();
  expect(Number(p!.coins), '留守の間に得たコインが 0 より多い').toBeGreaterThan(0);
  return { coins: Number(p!.coins), ms: p!.ms };
}

test.describe('E7 オフラインからの復帰（おかえり）', () => {
  test('TS-030-15 (a) タブで 8 時間離れて戻る: おかえりに 3 つのボタン、「受け取る」は 1 タップで留守の分が入り、閉じる', async ({ page }) => {
    const g = await bootGame(page);
    await withIncome(page, g);
    const played0 = await playedOf(g);
    await awayTab(page, g, 8 * HOUR);
    expect(await playedOf(g), 'オフラインではロジックの時間を進めない（決定 0012 追記 BL-030 の 4）').toBe(played0);
    await backAndSettle(page, g);
    const w = await expectWelcome(page, g);
    expect(w.ms, '留守の時間は上限の 8 時間').toBe(8 * HOUR);
    for (const id of ['welcome-claim', 'welcome-video', 'welcome-ticket']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('welcome-ticket')).toBeEnabled();
    const c0 = await coinsOf(g);
    await page.getByTestId('welcome-claim').click();
    expect((await coinsOf(g)) - c0, '「受け取る」で留守の分（×1）が入る').toBe(w.coins);
    expect((await runOf(g)).pendingOffline).toBeNull();
    await uiTick(page);
    await expect(page.getByTestId('modal-welcome')).toHaveCount(0);
    expect(await g.errors()).toEqual([]);
  });

  test('TS-030-15 (b) チケットで ×2: チケットが 1 枚減り、留守の分の 2 倍が入る', async ({ page }) => {
    const g = await bootGame(page);
    await withIncome(page, g);
    await awayTab(page, g, 8 * HOUR);
    await backAndSettle(page, g);
    const w = await expectWelcome(page, g);
    const [c0, t0] = [await coinsOf(g), await ticketsOf(g)];
    expect(t0, '前提: チケットがある').toBeGreaterThan(0);
    await page.getByTestId('welcome-ticket').click();
    expect([(await coinsOf(g)) - c0, await ticketsOf(g)]).toEqual([w.coins * 2, t0 - 1]);
    expect((await runOf(g)).pendingOffline).toBeNull();
    expect(await g.errors()).toEqual([]);
  });

  for (const [result, doubled] of [
    ['rewarded', true],
    ['failed', false],
  ] as const) {
    test(`TS-030-15 (c) 動画で ×2（偽の広告: ${result}）: ${doubled ? '見終わると 2 倍が入る' : '失敗の案内が出て、「受け取る」で ×1 を受け取れる（人質にしない）'}`, async ({ page }) => {
      const g = await bootGame(page);
      await withIncome(page, g);
      await g.setAdResult(result);
      await awayTab(page, g, 8 * HOUR);
      await backAndSettle(page, g);
      const w = await expectWelcome(page, g);
      const t0 = await ticketsOf(g);
      await page.getByTestId('welcome-video').click();
      await expect(page.getByTestId('fake-ad')).toBeVisible();
      await page.clock.runFor(1_000); // 偽の広告（dev のアダプタ。800ms）。広告の後はループが動きうるので、金額は受け取りのイベントで見る
      await g.pause();
      await uiTick(page);
      if (doubled) {
        expect(await claimed(g), '動画を見終わると 2 倍（OfflineClaimed）').toEqual({ mode: 'double', source: 'ad', coins: w.coins * 2 });
        expect(await ticketsOf(g), 'チケットは減らない').toBe(t0);
        await expect(page.getByTestId('modal-welcome')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('ad-unavailable')).toBeVisible();
        expect(await claimed(g), '失敗ではまだ受け取っていない').toBeNull();
        expect((await runOf(g)).pendingOffline, '未受け取りのまま残る').not.toBeNull();
        await page.getByTestId('welcome-claim').click();
        expect(await claimed(g), '「受け取る」で ×1').toEqual({ mode: 'normal', source: null, coins: w.coins });
      }
      expect((await runOf(g)).pendingOffline).toBeNull();
      expect(await g.errors()).toEqual([]);
    });
  }

  test('TS-030-15 (c) 動画の在庫なし（unavailable）: 動画のボタンは出ず、「受け取る」で ×1 を受け取れる', async ({ page }) => {
    const g = await bootGame(page);
    await withIncome(page, g);
    await g.setAdResult('unavailable');
    await awayTab(page, g, 8 * HOUR);
    await backAndSettle(page, g);
    const w = await expectWelcome(page, g);
    await expect(page.getByTestId('welcome-video')).toHaveCount(0);
    const c0 = await coinsOf(g);
    await page.getByTestId('welcome-claim').click();
    expect((await coinsOf(g)) - c0).toBe(w.coins);
    expect(await g.errors()).toEqual([]);
  });

  test('TS-030-15 (e)(f) タブを 30 秒隠して戻るとおかえりなしで追いつき、90 秒ならおかえりが出る', async ({ page }) => {
    const g = await bootGame(page);
    await withIncome(page, g);
    // (e) 30 秒: オンラインの規則で追いつく（ロジックの時間が 30 秒進み、コインが増える）。おかえりは出ない
    const [p0, c0] = [await playedOf(g), await coinsOf(g)];
    await awayTab(page, g, 30_000);
    expect((await playedOf(g)) - p0, '30 秒ぶん追いつく').toBe(30_000);
    await backAndSettle(page, g);
    await expect(page.getByTestId('modal-welcome')).toHaveCount(0);
    expect((await runOf(g)).pendingOffline).toBeNull();
    expect(await coinsOf(g), '追いついた分のコイン').toBeGreaterThan(c0);
    // (f) 90 秒: オフラインの規則とおかえり（留守の時間は 90 秒）
    const p1 = await playedOf(g);
    await awayTab(page, g, 90_000);
    expect(await playedOf(g), 'オフラインではロジックの時間を進めない').toBe(p1);
    await backAndSettle(page, g);
    const w = await expectWelcome(page, g);
    expect(w.ms).toBe(90_000);
    expect(await g.errors()).toEqual([]);
  });

  test('TS-030-15 起動の経路: 保存から 8 時間後に開くとおかえりが出る。(d) 保存より前の時刻（端末の時計を戻した）で開くと付与なし', async ({ page, harness }) => {
    const g = await bootGame(page);
    await withIncome(page, g);
    await triggerAutosave(page);
    const slots = await readSlots(page.context(), harness.origin);
    const savedAt = slots[newerOlder(slots).newer].env!.savedAt;
    const coinsSaved = await coinsOf(g);

    const later = await reopenWithStorage(harness, page.context(), () => {});
    const g8 = await bootGame(later.page, { time: savedAt + 8 * HOUR, startPaused: true });
    await backAndSettle(later.page, g8); // 起動の後はループが動くので止めてから見る
    const w = await expectWelcome(later.page, g8);
    expect(w.ms).toBe(8 * HOUR);
    expect(await coinsOf(g8), '受け取る前のコインは保存のとき').toBe(coinsSaved);
    expect(await g8.errors()).toEqual([]);

    const earlier = await reopenWithStorage(harness, page.context(), () => {});
    const gb = await bootGame(earlier.page, { time: savedAt - HOUR, startPaused: true });
    await backAndSettle(earlier.page, gb);
    await expect(earlier.page.getByTestId('modal-welcome')).toHaveCount(0);
    expect((await runOf(gb)).pendingOffline, '(d) 付与なし').toBeNull();
    expect(await coinsOf(gb), '(d) コインは保存のとき').toBe(coinsSaved);
    expect(await gb.errors()).toEqual([]);
  });
});
