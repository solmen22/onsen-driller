// BL-103: S2 のチケット別の e2e のうち、言語と数値の表記（BL-052・BL-011）
// PR: TS-052-15・16（BL-052_i18n.md）、TS-011-15（BL-011_number-format.md）
//
// - 言語の判定は 設定 → SDK → navigator.language → 英語（arch §13）。e2e-web は SDK がないので、context の locale で決まる。
//   判定の結果は保存しない（Q-26 の PM 案）。設定を書くのは T5 の lang-toggle を押したときだけ。
// - UI は時計（Clock API）で 5Hz で更新するので、grant などの後は時計を進めてから読む。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame, reloadGame } from './support/boot.ts';
import { readLocalStorage } from './support/storage.ts';

const dict = (lang: 'ja' | 'en'): Record<string, string> =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'src', 'i18n', `${lang}.json`), 'utf8')) as Record<string, string>;
const JA = dict('ja');
const EN = dict('en');
const SETTINGS_KEY = 'onsen-driller:settings';

/** UI の更新（5Hz）を 2 回ぶん待つ */
const uiTick = (page: Page): Promise<void> => page.clock.fastForward(450);

const tabLabel = (page: Page, no: number) => page.getByTestId(`tab-${no}`).locator('.tab-label');

/**
 * 表記を読み戻す（テストの側の素朴な読み取り。カンマを外し、単位を 10 の累乗に直す）。
 * 対象は TS-011-15 の範囲（万・億／K・M・B）だけ
 */
function parseShown(text: string, lang: 'ja' | 'en'): number {
  const m = /^([\d,]+(?:\.\d+)?)(万|億|K|M|B)?$/.exec(text.trim());
  if (!m) throw new Error(`表記を読めない: "${text}"`);
  const n = Number(m[1]!.replace(/,/g, ''));
  const unit = m[2] ?? '';
  const pow = lang === 'ja' ? { '': 0, 万: 4, 億: 8 }[unit] : { '': 0, K: 3, M: 6, B: 9 }[unit];
  if (pow === undefined) throw new Error(`${lang} にない単位: "${text}"`);
  return n * 10 ** pow;
}

/** 有効 3 桁の切り捨て（日本語の 4 桁の整数〔1,234万〕はそれより細かいので、この範囲に入る）: shown ≦ v < shown＋10^(桁−2) */
function expectTruncated3(text: string, lang: 'ja' | 'en', v: number): void {
  const shown = parseShown(text, lang);
  const step = 10 ** (Math.floor(Math.log10(v)) - 2);
  expect(shown, `「${text}」は ${v} 以下（切り捨て）`).toBeLessThanOrEqual(v * (1 + 1e-12));
  expect(v - shown, `「${text}」は ${v} の有効 3 桁の切り捨て`).toBeLessThan(step);
}

test.describe('BL-103 言語（BL-052）', () => {
  test('TS-052-15 ja-JP なら日本語・fr-FR なら英語で起動し、判定の結果を保存しない', async ({ harness }) => {
    for (const [locale, lang, label] of [
      ['ja-JP', 'ja', JA['tab.onsen']],
      ['fr-FR', 'en', EN['tab.onsen']],
    ] as const) {
      const page = await harness.newPage({ locale });
      await bootGame(page);
      await expect(page.locator('html'), `${locale} の <html lang>`).toHaveAttribute('lang', lang);
      await expect(tabLabel(page, 2), `${locale} のタブ 2 の文言`).toHaveText(label!);
      const ls = await readLocalStorage(page.context(), harness.origin);
      expect(ls.has(SETTINGS_KEY), `${locale}: 起動で設定（${SETTINGS_KEY}）を書かない`).toBe(false);
    }
    expect(JA['tab.onsen']).not.toBe(EN['tab.onsen']);
  });

  test('TS-052-16 ja-JP で T5 の lang-toggle を押すと再読み込みなしで英語になり、再読み込みの後も英語（設定がブラウザの言語に勝つ）', async ({
    harness,
  }) => {
    const page = await harness.newPage({ locale: 'ja-JP' });
    await bootGame(page);
    await expect(tabLabel(page, 2)).toHaveText(JA['tab.onsen']!);
    await page.getByTestId('tab-5').click();
    await page.getByTestId('lang-toggle').click();
    await uiTick(page);
    // 押した直後（再読み込みなし）
    await expect(tabLabel(page, 2)).toHaveText(EN['tab.onsen']!);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const saved = (await readLocalStorage(page.context(), harness.origin)).get(SETTINGS_KEY);
    expect(saved, '押したときに設定を書く').toBeDefined();
    expect((JSON.parse(saved!) as { lang?: string }).lang).toBe('en');
    // 再読み込みの後も英語（context の locale は ja-JP のまま）
    await reloadGame(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(tabLabel(page, 2)).toHaveText(EN['tab.onsen']!);
    expect((JSON.parse((await readLocalStorage(page.context(), harness.origin)).get(SETTINGS_KEY)!) as { lang?: string }).lang).toBe('en');
  });
});

test.describe('BL-103 数値の表記（BL-011）', () => {
  test('TS-011-15 所持 12345 は日本語「1.23万」・英語「12.3K」。コストも同じ切り捨ての規則', async ({ harness }) => {
    for (const [locale, lang, hud] of [
      ['ja-JP', 'ja', '1.23万'],
      ['en-US', 'en', '12.3K'],
    ] as const) {
      const page = await harness.newPage({ locale });
      const g = await bootGame(page);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await g.grant({ coins: '12345' });
      await uiTick(page);
      const coins = page.getByTestId('hud-coins');
      await expect(coins, `${locale} の HUD`).toHaveText(hud);
      await expect(coins).toHaveAttribute('data-value', '1.2345e4');

      // コスト: ドリルを買い上げて 1 万以上のコストにし、表示がコストの値の有効 3 桁の切り捨てであることを見る
      await g.grant({ coins: '1e9' });
      await g.dispatch({ type: 'buy', item: 'drill', qty: 'max' });
      await uiTick(page);
      const btn = page.getByTestId('buy-drill');
      const cost = Number(await btn.getAttribute('data-cost'));
      expect(cost, 'コストが 1 万以上になった（単位つきの表記を見るため）').toBeGreaterThanOrEqual(1e4);
      // 文は「1.5億 コイン」「150M coins」の形。数の部分（最初の空白の前）を読む
      const full = (await page.getByTestId('buy-drill-cost').textContent()) ?? '';
      const text = full.trim().split(/\s+/)[0] ?? '';
      expect(text, `${locale} のコストの単位`).toMatch(lang === 'ja' ? /[万億]$/ : /[KMB]$/);
      expectTruncated3(text, lang, cost);
    }
  });
});
