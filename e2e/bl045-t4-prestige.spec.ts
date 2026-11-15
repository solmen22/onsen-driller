// E2E: BL-045 の T4（転生タブ）と転生の確認の画面の見え方 — TS-021-41（390×844・320×568 × 日本語・英語、得られる湯の華が 1e6 以上）。
// 800×450（横）も同じ測り方で見る（T3 の TS-044-16 と同じ）
// - 準備: bootGame → pause → getState の写しを直して setState。周回の最深 60000m（得られる湯の華 約 144 万）・累計 1e30・木を 3 つ・
//   チケット 9 枚（上限の案内が出る）・目利きの上乗せあり
// - 確かめること: 横スクロールが出ない（文書の幅）・文字が切れない（scrollWidth ≤ clientWidth）・押せるもの（ボタン）が 44px 以上・
//   data-testid が重複しない・確認の画面は 1 段目・2 段目・振り直しを開いた状態で同じ検査。errors() が空
// - 並び・値・確定の流れは integration（tests/integration/ui-prestige.test.ts）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import type { Hooks } from './support/hooks.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

async function prepare(g: Hooks): Promise<void> {
  await g.pause();
  const s = await g.getState();
  const r = s.run as unknown as { depth: number; maxDepth: number };
  const meta = s.meta as unknown as { tickets: number; perks: string[]; yunohana: { lifetime: string; spent: string } };
  const stats = s.stats as unknown as { bestDepth: number };
  r.depth = 60000;
  r.maxDepth = 60000;
  stats.bestDepth = 60000;
  meta.tickets = 9;
  meta.perks = ['travelFunds', 'loupe', 'connoisseur'];
  meta.yunohana = { lifetime: '1e30', spent: '63' };
  await g.setState(s);
}

interface Measure {
  docOverflow: boolean;
  buttons: { id: string; w: number; h: number }[];
  overflow: string[];
  dupIds: string[];
}

/** root（data-testid）の中を測る（スクロールの先も含む） */
async function measure(page: Page, root: string): Promise<Measure> {
  return page.evaluate((rootId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${rootId}"]`)!;
    const buttons = [...el.querySelectorAll<HTMLElement>('button')]
      .filter((b) => getComputedStyle(b).display !== 'none')
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.dataset['testid'] ?? b.className, w: r.width, h: r.height };
      });
    const overflow: string[] = [];
    for (const x of el.querySelectorAll<HTMLElement>('*')) {
      const hasText = [...x.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (hasText && x.clientWidth > 0 && x.scrollWidth > x.clientWidth) overflow.push(`${x.getAttribute('data-testid') ?? x.className} "${(x.textContent ?? '').slice(0, 30)}"`);
    }
    const seen = new Map<string, number>();
    for (const x of document.querySelectorAll('[data-testid]')) {
      const id = x.getAttribute('data-testid')!;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return {
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      buttons,
      overflow,
      dupIds: [...seen].filter(([, n]) => n > 1).map(([id]) => id),
    };
  }, root);
}

function check(m: Measure, where: string, touch: boolean): void {
  expect(m.docOverflow, `${where}: 横スクロールが出ない`).toBe(false);
  expect(m.overflow, `${where}: 文字が切れない`).toEqual([]);
  if (touch) {
    const small = m.buttons.filter((b) => b.h < 44 || b.w < 44).map((b) => `${b.id} ${b.w}×${b.h}`);
    expect(small, `${where}: 押せるものが 44px 以上`).toEqual([]);
  }
  expect(m.dupIds, `${where}: data-testid が重複しない`).toEqual([]);
}

for (const vp of [
  { name: '390×844（縦）', width: 390, height: 844, touch: true },
  { name: '320×568（縦）', width: 320, height: 568, touch: true },
  { name: '800×450（横）', width: 800, height: 450, touch: false },
]) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`TS-021-41 ${vp.name}・${locale}: T4 と確認の画面（1 段目・振り直し・2 段目）で、大きい湯の華でも文字が切れず、横スクロールがなく、ボタンが 44px 以上`, async ({ harness }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
      const g = await bootGame(page);
      await prepare(g);
      await uiTick(page);
      await page.getByTestId('tab-4').click();
      await uiTick(page);
      await expect(page.getByTestId('panel-prestige')).toHaveAttribute('data-state', 'ready');
      expect(Number(await page.getByTestId('prestige-gain').getAttribute('data-value'))).toBeGreaterThanOrEqual(1e6);
      check(await measure(page, 'panel-prestige'), 'T4', vp.touch);

      await page.getByTestId('btn-prestige').click();
      await expect(page.getByTestId('modal-prestige')).toBeVisible();
      await expect(page.getByTestId('prestige-ticket-cap')).toBeVisible();
      check(await measure(page, 'modal-prestige'), '1 段目', vp.touch);
      await page.getByTestId('prestige-respec').click();
      await expect(page.getByTestId('plan-tree')).toBeVisible();
      check(await measure(page, 'modal-prestige'), '振り直し', vp.touch);
      await page.getByTestId('prestige-confirm-1').click();
      await expect(page.getByTestId('prestige-confirm-2')).toBeVisible();
      check(await measure(page, 'modal-prestige'), '2 段目', vp.touch);
      // 取り消して閉じる（転生しない）
      await page.getByTestId('prestige-cancel').click();
      await expect(page.getByTestId('modal-prestige')).toHaveCount(0);
      expect(await g.errors()).toEqual([]);
    });
  }
}
