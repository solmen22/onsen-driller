// E2E E2 最初の源泉（e2e_E2_first-spring.md）。BL-074。
// PR: TS-E2-01〜08（TS-013-13〔BL-089〕を TS-E2-04 で実施）。
// シナリオの「実装のまとめ方」のとおり、01〜08 を 1 つの流れ（ページの読み込み 1 回）で順に確かめる（PR の E2E を 10 分以内に）。
// 準備: bootGame → pause → seed(SEED_A) → grant({depth:29})。ロジックは advance で進め、UI の更新は page.clock.runFor(250)。
// 噴き出す演出とチュートリアル 2〜5 段目は S3（BL-074 の受け入れ基準）。
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { coinsOf, hitsOf, type GameEvent, type Hooks, type SerializedState } from './support/hooks.ts';
import { SEED_A } from '../tests/helpers/seeds.ts';

/** UI の更新（5Hz）を待つ */
const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

type Run = SerializedState['run'] & {
  depth: number;
  interludeMs: number;
  springs: Record<string, { pump?: number } | undefined>;
  bath: { level: number; slots: (string | null)[] };
  guests: string[];
};
const runOf = (s: SerializedState): Run => s.run as Run;

/** 深さが target になるまで advance(500, 毎秒 tapsPerSec 打) を繰り返し（最大 maxSteps 回）、その深さに入ったステップのイベントを返す */
async function digTo(g: Hooks, target: number, tapsPerSec = 2, maxSteps = 60): Promise<GameEvent[]> {
  for (let i = 0; i < maxSteps; i++) {
    const ev = await g.advance(500, { tapsPerSec });
    if (runOf(await g.getState()).depth >= target) return ev;
  }
  throw new Error(`${maxSteps} 回で ${target}m に届かなかった（深さ ${runOf(await g.getState()).depth}）`);
}

/** types の順番で、それぞれ 1 回ずつ出ていること（間にほかのイベントがあってよい） */
function expectInOrder(ev: GameEvent[], matchers: { type: string; [k: string]: unknown }[], label: string): void {
  const idx = matchers.map((m) => {
    const hits = ev.map((e, i) => [e, i] as const).filter(([e]) => Object.entries(m).every(([k, v]) => e[k] === v));
    expect(hits.length, `${label}: ${JSON.stringify(m)} が 1 回（イベント: ${ev.map((e) => e.type).join(',')}）`).toBe(1);
    return hits[0]![1];
  });
  expect(idx, `${label}: この順番`).toEqual([...idx].sort((a, b) => a - b));
}

test.describe('E2 最初の源泉', () => {
  test('TS-E2-01〜08 29m → 30m で単純温泉・タヌキ・入湯料・湯宿タブの「！」・幕間、80m で 2 つ目の源泉（つながらない）', async ({ page, harness }) => {
    const g = await bootGame(page);
    await g.pause();
    await g.seed(SEED_A);
    await g.pause();
    await g.grant({ depth: 29 });
    await uiTick(page);
    const income = page.getByTestId('hud-income');
    const tab2 = page.getByTestId('tab-2');

    // TS-E2-02（前）: 入湯料が入るまで毎秒の収入は 0
    expect(Number(await income.getAttribute('data-value')), '29m: 毎秒の収入 0').toBe(0);
    // TS-E2-03（前）: 「！」なし、T2 は隠したまま（案内だけ）
    await expect(tab2).not.toHaveAttribute('data-alert', 'true');
    await tab2.click();
    await uiTick(page);
    await expect(page.getByTestId('panel-inn')).toHaveAttribute('data-state', 'locked');
    await expect(page.getByTestId('inn-locked')).toBeVisible();
    await page.getByTestId('tab-1').click();
    const callsBefore = (await g.calls()).map((c) => c.name);

    // TS-E2-01: 30m に入るステップのイベントと状態
    const ev = await digTo(g, 30);
    expectInOrder(
      ev,
      [
        { type: 'StratumEntered', band: 1 },
        { type: 'SpringFound', spring: 'simple', depth: 30 },
        { type: 'GuestArrived', guest: 'tanuki', first: true },
      ],
      '30m',
    );
    const bb = ev.findIndex((e) => e.type === 'BlockBroken');
    expect(bb, '30m に入った BlockBroken が StratumEntered より前').toBeGreaterThanOrEqual(0);
    expect(bb).toBeLessThan(ev.findIndex((e) => e.type === 'StratumEntered'));
    const s30 = await g.getState();
    const r30 = runOf(s30);
    expect(r30.springs.simple?.pump, '単純温泉のポンプ Lv1（無料）').toBe(1);
    expect(r30.bath.slots[0], '湯船の枠 1 に自動でつながる').toBe('simple');
    expect(r30.guests).toContain('tanuki');
    const seen = (s30 as unknown as { collection: { guestsSeen: Record<string, number> } }).collection.guestsSeen;
    expect(seen.tanuki ?? 0, '図鑑に初来訪の壁時計').not.toBe(0);

    // TS-E2-04（TS-013-13）: 幕間の残りの間は打撃が増えず、終わった後に増える。入湯料は幕間の間も入る
    const t = r30.interludeMs;
    expect(t, '30m に入った直後は幕間（1.5 秒以下）').toBeGreaterThan(100);
    expect(t).toBeLessThanOrEqual(1_500);
    const h0 = hitsOf(s30);
    const c0 = coinsOf(s30);
    await g.advance(t - 100, { tapsPerSec: 4 });
    const sMid = await g.getState();
    expect(hitsOf(sMid), '幕間の間は打撃が増えない').toBe(h0);
    expect(coinsOf(sMid), '入湯料は幕間の間も入る').toBeGreaterThan(c0);
    await g.advance(300, { tapsPerSec: 4 });
    expect(hitsOf(await g.getState()), '幕間の後に打撃が入る').toBeGreaterThan(h0);

    // TS-E2-05: モーダルを出さない。タヌキの初来訪のトーストが 1 つ出て 2 秒で消える
    await uiTick(page);
    await expect(page.locator('[role="dialog"]'), '発見でモーダルを出さない（M2）').toHaveCount(0);
    const toasts = page.getByTestId('toast');
    await expect(toasts, 'タヌキの初来訪のトースト（チケット +1 も同じトースト）').toHaveCount(1);
    await page.clock.runFor(2_100);
    await expect(toasts, '2 秒で消える').toHaveCount(0);

    // TS-E2-02（後）: 1.8/秒（単純温泉 1 × 湯船 ×1 × 単純温泉 ×1.2 × タヌキ ×1.5）。10 秒で打撃なしでも +18
    expect(Number(await income.getAttribute('data-value')), '30m の後: 毎秒 1.8').toBeCloseTo(1.8, 9);
    const cA = coinsOf(await g.getState());
    await g.advance(10_000);
    expect(coinsOf(await g.getState()) - cA, '10 秒で入湯料 +18').toBeCloseTo(18, 6);

    // TS-E2-03（後）: 「！」が出て、T2 を開くと枠 0＝単純温泉・タヌキがいて、「！」が消える（T1 に戻っても消えたまま）
    await uiTick(page);
    await expect(tab2).toHaveAttribute('data-alert', 'true');
    await tab2.click();
    await uiTick(page);
    await expect(page.getByTestId('panel-inn')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('inn-slot-0')).toHaveAttribute('data-spring', 'simple');
    await expect(page.getByTestId('inn-guest-tanuki')).toHaveAttribute('data-state', 'present');
    await expect(tab2).not.toHaveAttribute('data-alert', 'true');
    await page.getByTestId('tab-1').click();
    await uiTick(page);
    await expect(tab2).not.toHaveAttribute('data-alert', 'true');

    // TS-E2-06: happyTime が 2 回（最初の源泉・タヌキの初来訪）。web は記録だけ
    const happy = (names: string[]): number => names.filter((n) => n === 'happyTime').length;
    expect(happy((await g.calls()).map((c) => c.name)) - happy(callsBefore), '30m で happyTime 2 回').toBe(2);

    // TS-E2-07: 80m で二酸化炭素泉（ポンプ Lv1）。枠は 1 つで埋まっているのでつながらない。M2 の機会はない。お客さんは変わらない
    const guests30 = [...runOf(await g.getState()).guests].sort();
    const calls80Before = (await g.calls()).map((c) => c.name);
    await g.grant({ depth: 79 });
    // 80m のブロックは固いので、打数を連打の上限（8 回/秒）にして最大 5 分ぶん掘る（方法はシナリオの指定なし）
    const ev80 = await digTo(g, 80, 8, 600);
    expect(ev80.filter((e) => e.type === 'SpringFound' && e.spring === 'co2' && e.depth === 80), '80m で二酸化炭素泉').toHaveLength(1);
    const r80 = runOf(await g.getState());
    expect(r80.springs.co2?.pump).toBe(1);
    expect(r80.bath.slots, '空きがなければつながない').toEqual(['simple']);
    expect([...r80.guests].sort(), 'お客さんは変わらない').toEqual(guests30);
    const calls80 = (await g.calls()).map((c) => c.name).slice(calls80Before.length);
    expect(calls80, 'M2 の機会はない（帯 3）').not.toContain('breakOpportunity');
    expect(happy(calls80), '2 つ目の源泉では happyTime が増えない').toBe(0);

    // TS-E2-08: 例外・console.error・errors() が 0（共通の検査はテストの終わりに harness が行う）
    expect(await harness.uncaughtErrors()).toEqual([]);
    expect(harness.consoleErrors).toEqual([]);
    expect(await g.errors()).toEqual([]);
  });
});
