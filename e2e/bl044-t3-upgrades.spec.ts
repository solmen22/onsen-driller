// E2E: BL-044 の T3（改良タブ）の見え方 — TS-044-16 の T3 の分（800×450・390×844 × 日本語・英語）と、PR #62 のレビューの H-4（大きいコストの見え方）
// - 準備: bootGame → pause → getState の写しを直して setState（最深 300m・5 種のポンプ Lv30・改良 2 つ購入済み・コイン 10 億）。
//   未購入 10 行（買える・足りないが混ざる。コストは 6 億〜760 億）・購入済み 2 行・「次の改良」なしの画面になる
// - 確かめること: T3 の文字が切れない（scrollWidth ≤ clientWidth）・800×450 で文字が 12px 以上（TS-042-05 の測り方）・
//   390×844 で行（押せるもの）が 44px 以上（TS-042-08）・行がパネルの幅からはみ出さない・data-testid が重複しない（TS-042-15）
// - 並び・状態・購入の一致は integration（tests/integration/ui-upgrades.test.ts）。改良を買って効果が乗る流れは E3 の TS-E3-06（BL-074）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import type { Hooks } from './support/hooks.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

async function prepare(g: Hooks): Promise<void> {
  await g.pause();
  const s = await g.getState();
  const r = s.run as unknown as {
    coins: string;
    depth: number;
    maxDepth: number;
    springs: Record<string, { pump: number }>;
    bath: { level: number; slots: (string | null)[] };
    upgrades: string[];
  };
  r.springs = { simple: { pump: 30 }, co2: { pump: 30 }, salt: { pump: 30 }, sulfur: { pump: 30 }, iron: { pump: 30 } };
  r.bath = { level: 10, slots: ['simple', 'co2', 'salt', 'sulfur'] };
  r.depth = 300;
  r.maxDepth = 300;
  r.upgrades = ['vibroBit', 'sieve'];
  r.coins = '1e9';
  const c = (s as unknown as { collection: { springsSeen: string[] } }).collection;
  c.springsSeen = ['simple', 'co2', 'salt', 'sulfur', 'iron'];
  await g.setState(s);
}

interface T3Measure {
  rows: { id: string; state: string; w: number; h: number; right: number }[];
  panelRight: number;
  texts: { where: string; text: string; px: number; overflow: boolean }[];
  dupIds: string[];
}

/** T3 のパネルの中を、画面の外（スクロールの先）も含めて測る */
async function measureT3(page: Page): Promise<T3Measure> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="panel-upgrades"]')!;
    const pr = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll<HTMLElement>('button[data-testid^="buy-upgrade-"]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset['testid']!, state: b.dataset['state']!, w: r.width, h: r.height, right: r.right };
    });
    const texts: T3Measure['texts'] = [];
    for (const el of panel.querySelectorAll<HTMLElement>('*')) {
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const scale = el.offsetHeight > 0 ? el.getBoundingClientRect().height / el.offsetHeight : 1;
      const where = el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
      texts.push({ where, text: text.slice(0, 40), px: Math.round(parseFloat(cs.fontSize) * scale * 100) / 100, overflow: el.clientWidth > 0 && el.scrollWidth > el.clientWidth });
    }
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll('[data-testid]')) {
      const id = el.getAttribute('data-testid')!;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return { rows, panelRight: pr.right, texts, dupIds: [...seen].filter(([, n]) => n > 1).map(([id]) => id) };
  });
}

for (const vp of [
  { name: '800×450（横）', width: 800, height: 450, portrait: false },
  { name: '390×844（縦）', width: 390, height: 844, portrait: true },
]) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`TS-044-16（T3）・H-4 ${vp.name}・${locale}: 改良の名前・効果・大きいコストが切れず、文字と行の大きさが基準を満たし、ID が重複しない`, async ({ harness }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.portrait });
      const g = await bootGame(page);
      await prepare(g);
      await uiTick(page);
      await page.getByTestId('tab-3').click();
      await uiTick(page);
      await expect(page.getByTestId('panel-upgrades')).toHaveAttribute('data-state', 'open');
      const m = await measureT3(page);
      // 12 行（未購入 10・購入済み 2）。買える・足りない・購入済みが混ざっている
      expect(m.rows).toHaveLength(12);
      expect(new Set(m.rows.map((r) => r.state))).toEqual(new Set(['affordable', 'insufficient', 'maxed']));
      // 大きいコスト（760 億）の行もある（H-4）
      await expect(page.getByTestId('buy-upgrade-yumomi-sulfur-cost')).toBeVisible();
      const overflow = m.texts.filter((x) => x.overflow).map((x) => `${x.where} "${x.text}"`);
      expect(overflow, '文字が切れない（scrollWidth ≤ clientWidth）').toEqual([]);
      const wide = m.rows.filter((r) => r.right > m.panelRight + 0.5).map((r) => `${r.id} right=${r.right} panel=${m.panelRight}`);
      expect(wide, '行がパネルの幅からはみ出さない').toEqual([]);
      if (vp.portrait) {
        const small = m.rows.filter((r) => r.h < 44 || r.w < 44).map((r) => `${r.id} ${r.w}×${r.h}`);
        expect(small, '390×844 で行（押せるもの）が 44px 以上').toEqual([]);
      } else {
        const tiny = m.texts.filter((x) => x.px < 12).map((x) => `${x.where} "${x.text}" ${x.px}px`);
        expect(tiny, '800×450 で文字が 12px 以上').toEqual([]);
      }
      expect(m.dupIds, 'data-testid が重複しない').toEqual([]);
      expect(await g.errors()).toEqual([]);
    });
  }
}
