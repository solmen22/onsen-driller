// E2E: BL-136（PR #55 の再レビューの Nit 1）— 狭い画面（320×568）で、最初の 1 打の前の案内（.hint）が細い柱にならない
// - 狭いときだけ、案内をボタン（自動掘り・btn-boost）の上の行に出す（.stage-actions を折り返す）。広い画面（390×844）は同じ行のまま
// - ボタンの位置（x・y）は案内の有無で変わらない（最初の 1 打で案内が消えても跳ねない。PR #55 のレビュー S-2 を崩さない）
// - 測る: 案内の幅・行数、2 つのボタンの x・y（案内あり → 1 打の後の案内なし）。ja・en
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';

/** UI の更新（5Hz）と描画を待つ（時計は bootGame で止めてある） */
const settle = (page: Page) => page.clock.runFor(250);

interface Shot {
  hint: null | { w: number; lines: number; bottom: number };
  auto: { x: number; y: number };
  boost: { x: number; y: number; top: number };
}

const measure = (page: Page): Promise<Shot> =>
  page.evaluate(() => {
    const rect = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const h = document.querySelector<HTMLElement>('.hint');
    const a = rect('toggle-auto-dig');
    const b = rect('btn-boost');
    let hint: Shot['hint'] = null;
    if (h) {
      const r = h.getBoundingClientRect();
      // 行数は文字の矩形の上端の数（line-height が normal でも数えられる）
      const range = document.createRange();
      range.selectNodeContents(h);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      hint = { w: Math.round(r.width), lines, bottom: Math.round(r.bottom) };
    }
    return {
      hint,
      auto: { x: Math.round(a.x), y: Math.round(a.y) },
      boost: { x: Math.round(b.x), y: Math.round(b.y), top: Math.round(b.top) },
    };
  });

for (const locale of ['ja-JP', 'en-US'] as const) {
  test.describe(`BL-136 最初の案内（${locale}）`, () => {
    test.use({ locale });

    for (const vp of [
      { width: 320, height: 568, narrow: true },
      { width: 390, height: 844, narrow: false },
    ]) {
      test(`${vp.width}×${vp.height}: 案内が細い柱にならず、ボタンの位置は案内の有無で変わらない（${locale}）`, async ({ page }) => {
        const g = await bootGame(page, { viewport: { width: vp.width, height: vp.height } });
        await settle(page);
        const before = await measure(page);
        await g.dispatch({ type: 'tap' });
        await settle(page);
        const after = await measure(page);
        test.info().annotations.push({ type: '計測', description: JSON.stringify({ before, after }) });

        expect(before.hint, '最初の 1 打の前は案内がある').not.toBeNull();
        expect(after.hint, '1 打の後は案内が消える').toBeNull();
        const hint = before.hint!;
        if (vp.narrow) {
          // ボタンの上の行に出す: 案内の下端がボタンの上端より上、幅は画面のほぼいっぱい、2 行まで
          expect(hint.bottom, '案内はボタンの上の行').toBeLessThanOrEqual(before.boost.top);
          expect(hint.w, '案内の幅（細い柱にならない）').toBeGreaterThanOrEqual(vp.width - 24);
        } else {
          expect(hint.bottom, '広い画面ではボタンと同じ行').toBeGreaterThan(before.boost.top);
        }
        expect(hint.lines, '案内は 3 行まで').toBeLessThanOrEqual(3);
        if (vp.narrow) expect(hint.lines, '狭い画面で上の行に出したら 2 行まで').toBeLessThanOrEqual(2);
        expect(after.auto, '自動掘りのボタンが跳ねない').toEqual(before.auto);
        expect({ x: after.boost.x, y: after.boost.y }, 'btn-boost が跳ねない').toEqual({ x: before.boost.x, y: before.boost.y });
      });
    }
  });
}
