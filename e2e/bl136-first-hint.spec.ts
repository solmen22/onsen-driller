// E2E: BL-136（PR #55 の再レビューの Nit 1）— 狭い画面（320×568）で、最初の 1 打の前の案内（.hint）が細い柱にならない
// - 狭いときだけ、案内をボタン（自動掘り・btn-boost）の上の行に出す（.stage-actions を折り返す。しきい値は中の幅 22.5rem）。
//   狭い: 320×568・360×640・568×320（横向き）。広い: 375×667・390×844・800×450（横向き）は同じ行のまま（PR #69 のレビュー N-1・N-2）
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
  /** .stage-actions の中の幅（padding を除く） */
  row: number;
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
    const sa = document.querySelector<HTMLElement>('.stage-actions')!;
    const cs = getComputedStyle(sa);
    const row = sa.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return {
      row: Math.round(row),
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
      { width: 360, height: 640, narrow: true }, // しきい値（22.5rem）のすぐ内側（中の幅 348px。PR #69 のレビュー N-1）
      { width: 568, height: 320, narrow: true }, // 小さい横向き（メディアクエリでなく中の幅で決まる。N-2）
      { width: 375, height: 667, narrow: false }, // しきい値のすぐ外側（中の幅 363px）
      { width: 390, height: 844, narrow: false },
      { width: 800, height: 450, narrow: false }, // 横向き（N-2）
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
          // ボタンの上の行に出す: 案内の下端がボタンの上端より上、幅は行いっぱい
          expect(hint.bottom, '案内はボタンの上の行').toBeLessThanOrEqual(before.boost.top);
          expect(hint.w, '案内の幅は行いっぱい（細い柱にならない）').toBeGreaterThanOrEqual(before.row - 1);
          expect(before.row, '狭い組は中の幅がしきい値（360px）未満').toBeLessThan(360);
        } else {
          expect(before.row, '広い組は中の幅がしきい値（360px）以上').toBeGreaterThanOrEqual(360);
          expect(hint.bottom, '広い画面ではボタンと同じ行').toBeGreaterThan(before.boost.top);
        }
        expect(hint.lines, '案内は 2 行まで（3 行だと句の途中で折れる。PR #69 のレビュー N-1）').toBeLessThanOrEqual(2);
        expect(after.auto, '自動掘りのボタンが跳ねない').toEqual(before.auto);
        expect({ x: after.boost.x, y: after.boost.y }, 'btn-boost が跳ねない').toEqual({ x: before.boost.x, y: before.boost.y });
      });
    }
  });
}
