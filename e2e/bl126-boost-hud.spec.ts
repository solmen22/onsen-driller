// E2E: BL-126 の btn-boost の表記と幅（PR #55 のレビュー S-1・S-2）
// - 390×844（と 320×568）の ja・en で、ready → active（自動掘削機なし「×2 5:00」）→ active（自動掘削機あり「×2（掘削機×4） 5:00」）→ 最初の 1 打の後、
//   のどの場面でも btn-boost の幅・高さが同じ（高さ 44px）、状態の行が 1 行でボタンからはみ出さず、隣の「自動掘り」のボタンの x が変わらない
// - 最初の 1 打の前は「タップで掘る」の案内と幅を取り合う（縮むのは案内の側）。レビューの計測では、ここで 2 行に折り返していた
// - 実機（iPhone）の見え方は QA の目視。ここは chromium の 390×844
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';

/** UI の更新（5Hz）と描画を待つ（時計は bootGame で止めてある） */
const settle = (page: Page) => page.clock.runFor(250);

interface Shot {
  state: string;
  text: string;
  w: number;
  h: number;
  lines: number;
  inside: boolean;
  autoX: number;
  hint: boolean;
}

/** btn-boost・状態の行・自動掘りのボタンを測る */
const measure = (page: Page): Promise<Shot> =>
  page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('[data-testid="btn-boost"]')!;
    const st = b.querySelector<HTMLElement>('.act-state')!;
    const auto = document.querySelector<HTMLElement>('[data-testid="toggle-auto-dig"]')!;
    const r = b.getBoundingClientRect();
    const sr = st.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(st).lineHeight);
    return {
      state: b.dataset['state'] ?? '',
      text: st.textContent ?? '',
      w: Math.round(r.width),
      h: Math.round(r.height),
      lines: Math.round(sr.height / lineH),
      inside: sr.left >= r.left && sr.right <= r.right,
      autoX: Math.round(auto.getBoundingClientRect().x),
      hint: document.querySelector('.hint') !== null,
    };
  });

for (const [locale, digger] of [
  ['ja-JP', '×2（掘削機×4） 5:00'],
  ['en-US', '×2 (digger ×4) 5:00'],
] as const) {
  test.describe(`BL-126 btn-boost の表記と幅（${locale}）`, () => {
    test.use({ locale });

    for (const vp of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      test(`S-1・S-2 ${vp.width}×${vp.height}: ready → active（掘削機なし・あり）→ 最初の 1 打の後で、幅・高さ 44px・1 行・自動掘りの位置が変わらない（${locale}）`, async ({ page }) => {
        const g = await bootGame(page, { viewport: vp });
        await settle(page);
        const shots: Shot[] = [];
        shots.push(await measure(page)); // ready（案内あり）
        await page.getByTestId('btn-boost').click();
        await page.getByTestId('sheet-ticket').click();
        await settle(page);
        shots.push(await measure(page)); // active・掘削機なし（案内あり）
        await g.grant({ coins: '1e9' });
        expect((await g.dispatch({ type: 'buy', item: 'autoDigger', qty: 1 })).ok).toBe(true);
        await settle(page);
        shots.push(await measure(page)); // active・掘削機あり（案内あり。いちばん長い表記）
        await g.dispatch({ type: 'tap' });
        await settle(page);
        shots.push(await measure(page)); // 最初の 1 打の後（案内なし）
        test.info().annotations.push({ type: '計測', description: JSON.stringify(shots) });

        expect(shots.map((s) => s.state)).toEqual(['ready', 'active', 'active', 'active']);
        expect(shots.map((s) => s.hint)).toEqual([true, true, true, false]);
        expect(shots[1]!.text).toBe('×2 5:00');
        expect(shots[2]!.text).toBe(digger);
        for (const s of shots) {
          expect(s.lines, `${s.text}: 1 行`).toBe(1);
          expect(s.inside, `${s.text}: ボタンからはみ出さない`).toBe(true);
          expect(s.h, `${s.text}: 高さ`).toBe(44);
          expect(s.w, `${s.text}: 幅は固定`).toBe(shots[0]!.w);
          expect(s.autoX, `${s.text}: 自動掘りのボタンが跳ねない`).toBe(shots[0]!.autoX);
          expect(s.autoX, '画面からはみ出さない').toBeGreaterThanOrEqual(0);
        }
      });
    }
  });
}
