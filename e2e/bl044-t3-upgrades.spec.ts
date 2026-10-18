// E2E: BL-044 の T3（改良タブ）の見え方 — TS-044-16 の T3 の分（800×450・390×844 × 日本語・英語）と、PR #62 のレビューの H-4（大きいコストの見え方）
// - 準備: bootGame → pause → getState の写しを直して setState。画面は 3 つ（PR #72 のレビューの S-2 で 2 つ足した）:
//   ① full: 最深 300m・5 種のポンプ Lv30・改良 2 つ購入済み・コイン 10 億 → 未購入 10 行（買える・足りないが混ざる。コストは 6 億〜760 億）・購入済み 2 行
//   ② next: 最深 230m・単純温泉 Lv30・二酸化炭素泉／塩化物泉 Lv25・硫黄泉は未発見 → 未購入 11 行＋「次の改良」（いちばん長い文: 未発見の源泉の条件）
//   ③ empty: 最深 30m → 一覧なし・upgrades-empty（最初の条件）と冒頭の説明
// - 確かめること: T3 の文字が切れない（scrollWidth ≤ clientWidth）・800×450 で文字が 12px 以上（TS-042-05 の測り方）・
//   390×844 で行（押せるもの）が 44px 以上（TS-042-08）・行がパネルの幅からはみ出さない・data-testid が重複しない（TS-042-15）
// - 並び・状態・購入の一致は integration（tests/integration/ui-upgrades.test.ts）。改良を買って効果が乗る流れは E3 の TS-E3-06（BL-074）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import type { Hooks } from './support/hooks.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

type Screen = 'full' | 'next' | 'empty';

async function prepare(g: Hooks, screen: Screen): Promise<void> {
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
  const c = (s as unknown as { collection: { springsSeen: string[] } }).collection;
  if (screen === 'full') {
    r.springs = { simple: { pump: 30 }, co2: { pump: 30 }, salt: { pump: 30 }, sulfur: { pump: 30 }, iron: { pump: 30 } };
    r.bath = { level: 10, slots: ['simple', 'co2', 'salt', 'sulfur'] };
    r.depth = 300;
    r.maxDepth = 300;
    r.upgrades = ['vibroBit', 'sieve'];
    r.coins = '1e9';
    c.springsSeen = ['simple', 'co2', 'salt', 'sulfur', 'iron'];
  } else if (screen === 'next') {
    r.springs = { simple: { pump: 30 }, co2: { pump: 25 }, salt: { pump: 25 } };
    r.bath = { level: 5, slots: ['simple', 'co2'] };
    r.depth = 230;
    r.maxDepth = 230;
    r.upgrades = [];
    r.coins = '1e9';
    c.springsSeen = ['simple', 'co2', 'salt'];
  } else {
    r.depth = 30;
    r.maxDepth = 30;
    r.upgrades = [];
  }
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

const EXPECT: Record<Screen, { rows: number; state: string; line: string | null }> = {
  full: { rows: 12, state: 'open', line: null },
  next: { rows: 11, state: 'open', line: 'upgrades-next' },
  empty: { rows: 0, state: 'empty', line: 'upgrades-empty' },
};

for (const screen of ['full', 'next', 'empty'] as const) for (const vp of [
  { name: '800×450（横）', width: 800, height: 450, portrait: false },
  { name: '390×844（縦）', width: 390, height: 844, portrait: true },
]) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`TS-044-16（T3）・H-4 ${screen}・${vp.name}・${locale}: 改良の名前・効果・大きいコスト・次の改良の文が切れず、文字と行の大きさが基準を満たし、ID が重複しない`, async ({ harness }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.portrait });
      const g = await bootGame(page);
      await prepare(g, screen);
      await uiTick(page);
      await page.getByTestId('tab-3').click();
      await uiTick(page);
      const ex = EXPECT[screen];
      await expect(page.getByTestId('panel-upgrades')).toHaveAttribute('data-state', ex.state);
      const m = await measureT3(page);
      expect(m.rows).toHaveLength(ex.rows);
      if (screen === 'full') {
        // 買える・足りない・購入済みが混ざっている。大きいコスト（760 億）の行もある（H-4）
        expect(new Set(m.rows.map((r) => r.state))).toEqual(new Set(['affordable', 'insufficient', 'maxed']));
        await expect(page.getByTestId('buy-upgrade-yumomi-sulfur-cost')).toBeVisible();
      }
      if (ex.line) {
        // 次の改良の行（next は未発見の源泉の文。S-1）も測る対象に入っている（S-2）
        await expect(page.getByTestId(ex.line)).toBeVisible();
        expect(m.texts.some((x) => x.where === ex.line)).toBe(true);
        if (screen === 'next') await expect(page.getByTestId('upgrades-next')).toHaveAttribute('data-unfound', 'true');
      }
      const overflow = m.texts.filter((x) => x.overflow).map((x) => `${x.where} "${x.text}"`);
      expect(overflow, '文字が切れない（scrollWidth ≤ clientWidth）').toEqual([]);
      const wide = m.rows.filter((r) => r.right > m.panelRight + 0.5).map((r) => `${r.id} right=${r.right} panel=${m.panelRight}`);
      expect(wide, '行がパネルの幅からはみ出さない').toEqual([]);
      if (vp.portrait && m.rows.length > 0) {
        const small = m.rows.filter((r) => r.h < 44 || r.w < 44).map((r) => `${r.id} ${r.w}×${r.h}`);
        expect(small, '390×844 で行（押せるもの）が 44px 以上').toEqual([]);
      }
      if (!vp.portrait) {
        const tiny = m.texts.filter((x) => x.px < 12).map((x) => `${x.where} "${x.text}" ${x.px}px`);
        expect(tiny, '800×450 で文字が 12px 以上').toEqual([]);
      }
      expect(m.dupIds, 'data-testid が重複しない').toEqual([]);
      expect(await g.errors()).toEqual([]);
    });
  }
}
