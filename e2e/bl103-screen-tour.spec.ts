// E2E: BL-103 その 2 — 画面の巡回に T2 を足す（TS-044-16 の T2 の分・TS-042-15・TS-043-17）
// - TS-044-16（T2）: 800×450（横）・390×844（縦。hasTouch）× 日本語・英語で、T2 を「枠 4・源泉 5・お客さん」を埋めた状態で開き、
//   T2 のパネルの中（画面の外〔スクロールの先〕も含む）を測る。測り方は T3 の分（e2e/bl044-t3-upgrades.spec.ts）と同じ:
//   文字が切れない（scrollWidth ≤ clientWidth）・800×450 で文字が 12px 以上（TS-042-05）・390×844 で押せるものが 44px 以上（TS-042-08）・
//   押せるものがパネルの幅からはみ出さない・data-testid が重複しない（TS-042-15）
// - TS-042-15: 起動直後と、埋めた状態のそれぞれで、起動直後とタブ 1〜5 の画面ごとに、文書の中の data-testid が重複しない
//   （T3 の分と同じく、表示中でないものも数える。getByTestId が 1 つに決まらない状態を作らない）
// - TS-043-17: 購入ボタン（T1 の掘削・T2 のポンプ・湯船）の名前・効果・コストの文字が切れず、的が 44px 以上（800×450・390×844 の両方。
//   800×450 の文字の大きさは TS-042-05、390×844 の的は TS-042-08 が起動直後の画面で見ている。ここでは埋めた状態の購入ボタンを見る）
// - T3 の分は bl044-t3-upgrades.spec.ts にある（#72）。TS-059-12・14 は BL-059 の後（BL-103 の残り）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { forEachScreen } from './support/dom.ts';
import type { Hooks } from './support/hooks.ts';

const uiTick = (page: Page): Promise<void> => page.clock.runFor(250);

/**
 * T2 を埋めた状態: 5 種の源泉を発見・ポンプ Lv30、湯船 Lv35（枠 4。params の bath.slotsAtLevel）に硫黄泉を除く 4 種を入れる。
 * お客さんは、硫黄泉の条件のキツネ（硫黄泉が枠にない）を除く 5 匹が来ている（core の guestConditionMet と同じ組。T2 の一覧には
 * 文言のあるお客さんだけが出るので、画面では来ている・来ていないが混ざる）。コインは 10 億（買える・足りないが混ざる）
 */
async function fillInn(page: Page, g: Hooks): Promise<void> {
  await g.pause();
  const s = await g.getState();
  const r = s.run as unknown as {
    coins: string;
    depth: number;
    maxDepth: number;
    springs: Record<string, { pump: number }>;
    bath: { level: number; slots: (string | null)[] };
    guests: string[];
  };
  const c = (s as unknown as { collection: { springsSeen: string[]; guestsSeen: Record<string, number> } }).collection;
  r.springs = { simple: { pump: 30 }, co2: { pump: 30 }, salt: { pump: 30 }, sulfur: { pump: 30 }, iron: { pump: 30 } };
  r.bath = { level: 35, slots: ['simple', 'co2', 'salt', 'iron'] };
  r.depth = 300;
  r.maxDepth = 300;
  r.coins = '1e9';
  r.guests = ['tanuki', 'monkey', 'capybara', 'cat', 'redPanda'];
  c.springsSeen = ['simple', 'co2', 'salt', 'sulfur', 'iron'];
  c.guestsSeen = { tanuki: 1, monkey: 1, capybara: 1, cat: 1, redPanda: 1 };
  await g.setState(s);
  await uiTick(page);
}

interface PanelMeasure {
  /** パネルの中の押せるもの（button） */
  rows: { id: string; state: string | null; w: number; h: number; right: number }[];
  panelRight: number;
  texts: { where: string; text: string; px: number; overflow: boolean }[];
}

/** パネルの中を、画面の外（スクロールの先）も含めて測る（bl044-t3-upgrades.spec.ts の measureT3 と同じ測り方） */
async function measurePanel(page: Page, panelTestId: string): Promise<PanelMeasure> {
  return page.evaluate((pid) => {
    const panel = document.querySelector<HTMLElement>(`[data-testid="${pid}"]`);
    if (!panel) throw new Error(`${pid} がない`);
    const pr = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll<HTMLElement>('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset['testid'] ?? b.tagName, state: b.dataset['state'] ?? null, w: r.width, h: r.height, right: r.right };
    });
    const texts: PanelMeasure['texts'] = [];
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
    return { rows, panelRight: pr.right, texts };
  }, panelTestId);
}

/** 文書の中で 2 回以上使われている data-testid（表示中でないものも数える） */
const duplicateTestIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll('[data-testid]')) {
      const id = el.getAttribute('data-testid')!;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
  });

const VIEWPORTS = [
  { name: '800×450（横）', width: 800, height: 450, portrait: false },
  { name: '390×844（縦）', width: 390, height: 844, portrait: true },
] as const;

for (const vp of VIEWPORTS) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`TS-044-16（T2）${vp.name}・${locale}: 枠 4・源泉 5・お客さんを埋めた T2 で、名前・効果・コストが切れず、文字と的の大きさが基準を満たし、ID が重複しない`, async ({
      harness,
    }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.portrait });
      const g = await bootGame(page);
      await fillInn(page, g);
      await page.getByTestId('tab-2').click();
      await uiTick(page);
      await expect(page.getByTestId('panel-inn')).toHaveAttribute('data-state', 'open');
      // 埋めた状態になっている（枠 4 つに源泉・5 種の源泉・お客さんが来ている／来ていないが混ざる）
      for (let i = 0; i < 4; i++) await expect(page.getByTestId(`inn-slot-${i}`)).toHaveAttribute('data-spring', /.+/);
      await expect(page.locator('[data-testid^="inn-spring-"][data-found="true"]')).toHaveCount(5);
      expect(await g.getState().then((x) => (x.run as unknown as { guests: string[] }).guests), '来ているお客さん（core の計算のまま）').toEqual([
        'tanuki',
        'monkey',
        'capybara',
        'cat',
        'redPanda',
      ]);
      await expect(page.locator('[data-testid^="inn-guest-"][data-present="true"]').first()).toBeVisible();
      await expect(page.getByTestId('inn-guest-fox')).toHaveAttribute('data-present', 'false');

      const m = await measurePanel(page, 'panel-inn');
      // 枠 4・源泉 5・ポンプ 5・湯船 1 の押せるもの
      expect(m.rows.length, `押せるもの: ${m.rows.map((r) => r.id).join('・')}`).toBeGreaterThanOrEqual(4 + 5 + 5 + 1);
      expect(new Set(m.rows.filter((r) => r.id.startsWith('buy-')).map((r) => r.state)), '買える・足りないが混ざる').toEqual(new Set(['affordable', 'insufficient']));
      const overflow = m.texts.filter((x) => x.overflow).map((x) => `${x.where} "${x.text}"`);
      expect(overflow, '文字が切れない（scrollWidth ≤ clientWidth）').toEqual([]);
      const wide = m.rows.filter((r) => r.right > m.panelRight + 0.5).map((r) => `${r.id} right=${r.right} panel=${m.panelRight}`);
      expect(wide, '押せるものがパネルの幅からはみ出さない').toEqual([]);
      if (vp.portrait) {
        const small = m.rows.filter((r) => r.h < 44 || r.w < 44).map((r) => `${r.id} ${r.w}×${r.h}`);
        expect(small, '390×844 で押せるものが 44px 以上').toEqual([]);
      } else {
        const tiny = m.texts.filter((x) => x.px < 12).map((x) => `${x.where} "${x.text}" ${x.px}px`);
        expect(tiny, '800×450 で文字が 12px 以上').toEqual([]);
      }
      expect(await duplicateTestIds(page), 'data-testid が重複しない').toEqual([]);
      test.info().annotations.push({ type: '測ったもの', description: `押せるもの ${m.rows.length}・文字 ${m.texts.length}` });
      expect(await g.errors()).toEqual([]);
    });
  }
}

for (const vp of VIEWPORTS) {
  test(`TS-042-15 ${vp.name}: 起動直後と埋めた状態のそれぞれで、起動直後とタブ 1〜5 の画面ごとに data-testid が重複しない`, async ({ harness }) => {
    const dups: string[] = [];
    const visited: string[] = [];
    for (const state of ['起動直後の状態', '埋めた状態'] as const) {
      // 状態ごとに開き直す（巡回は、タブを開いていない「起動直後」の画面から始める）
      const page = await harness.newPage({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.portrait });
      const g = await bootGame(page);
      if (state === '埋めた状態') await fillInn(page, g);
      const screens = await forEachScreen(
        page,
        async (name) => {
          for (const d of await duplicateTestIds(page)) dups.push(`${state}・${name}: ${d}`);
        },
        () => uiTick(page),
      );
      expect(screens, `${state}: 起動直後とタブ 1〜5`).toHaveLength(6);
      visited.push(`${state}（${screens.join('・')}）`);
      expect(await g.errors()).toEqual([]);
    }
    test.info().annotations.push({ type: '巡回した画面', description: visited.join(' / ') });
    expect(dups).toEqual([]);
  });
}

for (const vp of VIEWPORTS) {
  test(`TS-043-17 ${vp.name}: 埋めた状態の購入ボタン（T1 の掘削・T2 のポンプと湯船）の名前・効果・コストが切れず、的が 44px 以上`, async ({ harness }) => {
    const page = await harness.newPage({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.portrait });
    const g = await bootGame(page);
    await fillInn(page, g);
    const clipped: string[] = [];
    const small: string[] = [];
    let buttons = 0;
    for (const [tab, panel] of [
      ['tab-1', 'panel-dig'],
      ['tab-2', 'panel-inn'],
    ] as const) {
      await page.getByTestId(tab).click();
      await uiTick(page);
      const m = await measurePanel(page, panel);
      const buys = m.rows.filter((r) => r.id.startsWith('buy-'));
      expect(buys.length, `${panel} に購入ボタンがある`).toBeGreaterThan(0);
      buttons += buys.length;
      for (const r of buys) if (r.w < 44 || r.h < 44) small.push(`${panel} ${r.id} ${r.w}×${r.h}`);
      for (const x of m.texts) if (x.overflow && x.where.startsWith('buy-')) clipped.push(`${panel} ${x.where} "${x.text}"`);
    }
    test.info().annotations.push({ type: '測った購入ボタン', description: `${buttons} 個` });
    expect(clipped, '購入ボタンの文字が切れない').toEqual([]);
    expect(small, '購入ボタンの的が 44px 以上').toEqual([]);
    expect(await g.errors()).toEqual([]);
  });
}
