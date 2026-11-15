// E2E: BL-045 の T5（≡）— 設定が保存されて再読み込みの後も効くこと、見え方（390×844・320×568・800×450 × 日本語・英語）
// - 設定: 効果音オフ・数値の表記「指数」を押す → onsen-driller:settings に書かれる → 再読み込みの後も同じで、HUD のコインが指数の表記
// - 見え方: T5 とクレジットの画面で、横スクロールなし・文字が切れない・押せるものが 44px 以上（タッチ）・ID の重複なし。外部リンク（a[href]）なし
// - 並び・切り替え・エラー情報の文字は integration（tests/integration/ui-menu.test.ts）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame } from './support/boot.ts';
import { readLocalStorage } from './support/storage.ts';

const SETTINGS_KEY = 'onsen-driller:settings';
const uiTick = (page: Page): Promise<void> => page.clock.runFor(450); // runFor は requestAnimationFrame も進める（Preact の useEffect）

test('BL-045 T5: 効果音オフ・数値の表記「指数」が設定に保存され、再読み込みの後も効く', async ({ harness }) => {
  const page = await harness.newPage({ locale: 'en-US' });
  const g = await bootGame(page);
  await g.grant({ coins: '15000000' });
  await uiTick(page);
  await page.getByTestId('tab-5').click();
  await page.getByTestId('setting-sfx').click();
  await page.getByTestId('setting-notation').click();
  await uiTick(page);
  await expect(page.getByTestId('hud-coins')).toContainText('e7');
  const saved = JSON.parse((await readLocalStorage(page.context(), harness.origin)).get(SETTINGS_KEY)!) as { sfx?: boolean; notation?: string };
  expect(saved.sfx).toBe(false);
  expect(saved.notation).toBe('exp');
  await reloadGame(page);
  await uiTick(page);
  await expect(page.getByTestId('hud-coins')).toContainText('e7');
  await page.getByTestId('tab-5').click();
  await expect(page.getByTestId('setting-sfx')).toHaveAttribute('data-value', 'off');
  await expect(page.getByTestId('setting-notation')).toHaveAttribute('data-value', 'exp');
  expect(await g.errors()).toEqual([]);
});

interface Measure {
  docOverflow: boolean;
  small: string[];
  overflow: string[];
  dupIds: string[];
  links: number;
}

async function measure(page: Page, root: string): Promise<Measure> {
  return page.evaluate((rootId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${rootId}"]`)!;
    const small = [...el.querySelectorAll<HTMLElement>('button')]
      .map((b) => ({ id: b.dataset['testid'] ?? b.className, r: b.getBoundingClientRect() }))
      .filter((x) => x.r.height < 44 || x.r.width < 44)
      .map((x) => `${x.id} ${x.r.width}×${x.r.height}`);
    const overflow: string[] = [];
    for (const x of el.querySelectorAll<HTMLElement>('*')) {
      const hasText = [...x.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (hasText && x.clientWidth > 0 && x.scrollWidth > x.clientWidth) overflow.push(`${x.getAttribute('data-testid') ?? x.className}`);
    }
    const seen = new Map<string, number>();
    for (const x of document.querySelectorAll('[data-testid]')) seen.set(x.getAttribute('data-testid')!, (seen.get(x.getAttribute('data-testid')!) ?? 0) + 1);
    return {
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      small,
      overflow,
      dupIds: [...seen].filter(([, n]) => n > 1).map(([id]) => id),
      links: document.querySelectorAll('#ui a[href]').length,
    };
  }, root);
}

for (const vp of [
  { name: '390×844（縦）', width: 390, height: 844, touch: true },
  { name: '320×568（縦）', width: 320, height: 568, touch: true },
  { name: '800×450（横）', width: 800, height: 450, touch: false },
]) {
  for (const locale of ['ja-JP', 'en-US'] as const) {
    test(`BL-045 T5 ${vp.name}・${locale}: T5 とクレジットで文字が切れず、横スクロールがなく、押せるものが 44px 以上・外部リンクなし`, async ({ harness }) => {
      const page = await harness.newPage({ locale, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
      const g = await bootGame(page);
      await page.getByTestId('tab-5').click();
      await page.getByTestId('btn-copy-errors').click();
      await expect(page.getByTestId('errors-text')).toBeVisible();
      for (const [root, open] of [
        ['panel-menu', null],
        ['modal-credits', 'menu-credits'],
      ] as const) {
        if (open) {
          await page.getByTestId(open).click();
          await uiTick(page); // Dialog のフォーカスと Esc の受け口は useEffect（描画の後）で付く。偽の時計を進める
        }
        const m = await measure(page, root);
        expect(m.docOverflow, `${root}: 横スクロールなし`).toBe(false);
        expect(m.overflow, `${root}: 文字が切れない`).toEqual([]);
        if (vp.touch) expect(m.small, `${root}: 44px 以上`).toEqual([]);
        expect(m.dupIds, `${root}: ID の重複なし`).toEqual([]);
        expect(m.links, '外部リンクなし').toBe(0);
      }
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('modal-credits')).toHaveCount(0);
      expect(await g.errors()).toEqual([]);
    });
  }
}
