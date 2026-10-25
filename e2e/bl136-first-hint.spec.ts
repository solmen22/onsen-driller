// E2E: BL-136（PR #55 の再レビューの Nit 1）— 狭い画面（320×568）で、最初の 1 打の前の案内（.hint）が細い柱にならない
// - 狭いときだけ、案内をボタン（自動掘り・btn-boost）の上の行に出す（.stage-actions を折り返す。しきい値は中の幅 25rem〔400px〕）。
//   狭い: 320×568・360×640・375×667・390×844・402×874・568×320（横向き）。広い: 414×896・800×450（横向き）は同じ行のまま（PR #69 のレビュー N-1・N-2）
//   （375×667 は前は広い組だったが、案内の幅が 123px しかなく WebKit・Firefox で 3 行になっていた。nightly 10/19〜。
//   ja の案内は句の中で折らないので、同じ行で 2 行に収まるのは中の幅 395px 以上。global.css の .hint）
// - 句の中で折れない（ja は「タップで掘る／（長押しで／掘り続ける）」、en は「Tap to dig／(hold to keep digging)」の区切りでだけ折る。
//   「長／押し」や「(hold to／keep digging)」のように句の途中で折れない。Q-52 (b)）
// - シナリオ: org/30_quality/test-designer/scenarios/BL-136_first-hint.md の TS-136-01〜04（狭い組 01・広い組 02・句 03・ボタンが跳ねない 04）
// - ボタンの位置（x・y）は案内の有無で変わらない（最初の 1 打で案内が消えても跳ねない。PR #55 のレビュー S-2 を崩さない）
// - 測る: 案内の幅・行数、2 つのボタンの x・y（案内あり → 1 打の後の案内なし）。ja・en
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';

/** UI の更新（5Hz）と描画を待つ（時計は bootGame で止めてある） */
const settle = (page: Page) => page.clock.runFor(250);

interface Shot {
  /**
   * split: 句（.hint-phrase）が 2 行にまたがったか。
   * overflow: 文字の矩形が案内の中（padding の内側）から左右にはみ出した量の大きいほう（px。0 以下ならはみ出しなし）。
   * gap: 案内の右端から自動掘りのボタンの左端まで（px。負なら重なる。同じ行のときだけ意味がある）。
   * outside: 案内の箱が .stage-actions の中（padding の内側）から左右にはみ出した量（px）
   */
  hint: null | {
    w: number;
    lines: number;
    bottom: number;
    split: boolean;
    phrases: number;
    overflow: number;
    gap: number;
    outside: number;
  };
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
      // 行数は文字の矩形の上端の数（line-height が normal でも数えられる）。大きさ 0 の矩形（Firefox は <wbr> の分も返す）は数えない
      const tops = (el: Node) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0).map((x) => Math.round(x.top))).size;
      };
      const phrases = [...h.querySelectorAll<HTMLElement>('.hint-phrase')];
      // はみ出し（PR #76 のレビュー S-1。<wbr> がないと句の間で折れず、1 行のまま箱から出てボタンに重なった）
      const hs = getComputedStyle(h);
      const innerL = r.left + parseFloat(hs.paddingLeft);
      const innerR = r.right - parseFloat(hs.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(h);
      const text = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
      const overflow = Math.max(...text.map((x) => Math.max(x.right - innerR, innerL - x.left)));
      const sa = document.querySelector<HTMLElement>('.stage-actions')!;
      const sr = sa.getBoundingClientRect();
      const ss = getComputedStyle(sa);
      const outside = Math.max(r.right - (sr.right - parseFloat(ss.paddingRight)), sr.left + parseFloat(ss.paddingLeft) - r.left);
      hint = {
        overflow: Math.round(overflow * 10) / 10,
        gap: Math.round((a.left - r.right) * 10) / 10,
        outside: Math.round(outside * 10) / 10,
        w: Math.round(r.width),
        lines: tops(h),
        bottom: Math.round(r.bottom),
        split: phrases.some((p) => tops(p) > 1),
        phrases: phrases.length,
      };
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
      { width: 360, height: 640, narrow: true }, // 中の幅 348px（PR #69 のレビュー N-1）
      { width: 375, height: 667, narrow: true }, // 中の幅 363px（前は広い組で、WebKit・Firefox で 3 行。nightly 10/19〜）
      { width: 390, height: 844, narrow: true },
      { width: 402, height: 874, narrow: true }, // しきい値（25rem）のすぐ内側（中の幅 390px）
      { width: 568, height: 320, narrow: true }, // 小さい横向き（メディアクエリでなく中の幅で決まる。N-2）
      { width: 414, height: 896, narrow: false }, // しきい値のすぐ外側（中の幅 402px。案内の幅 162px で 2 行）
      { width: 800, height: 450, narrow: false }, // 横向き（N-2）
    ]) {
      const ids = vp.narrow ? 'TS-136-01・03・04' : 'TS-136-02・03・04';
      test(`${ids} ${vp.width}×${vp.height}: 案内が細い柱にならず、句の途中で折れず、ボタンの位置は案内の有無で変わらない（${locale}）`, async ({ page }) => {
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
          expect(before.row, '狭い組は中の幅がしきい値（400px）未満').toBeLessThan(400);
        } else {
          expect(before.row, '広い組は中の幅がしきい値（400px）以上').toBeGreaterThanOrEqual(400);
          expect(hint.bottom, '広い画面ではボタンと同じ行').toBeGreaterThan(before.boost.top);
        }
        expect(hint.lines, '案内は 2 行まで（PR #69 のレビュー N-1）').toBeLessThanOrEqual(2);
        expect(hint.phrases, '句ごとの span（ja 3 つ・en 2 つ）').toBe(locale === 'ja-JP' ? 3 : 2);
        expect(hint.split, '句の途中で折れない（「長／押し」など）').toBe(false);
        // はみ出さない（PR #76 のレビュー S-1）: 文字は案内の中、案内は行の中。同じ行なら自動掘りのボタンに重ならない
        expect(hint.overflow, '案内の文字が箱からはみ出さない').toBeLessThanOrEqual(0.5);
        expect(hint.outside, '案内の箱が行（.stage-actions の中）からはみ出さない').toBeLessThanOrEqual(0.5);
        if (!vp.narrow) expect(hint.gap, '案内が自動掘りのボタンに重ならない').toBeGreaterThanOrEqual(0);
        expect(after.auto, '自動掘りのボタンが跳ねない').toEqual(before.auto);
        expect({ x: after.boost.x, y: after.boost.y }, 'btn-boost が跳ねない').toEqual({ x: before.boost.x, y: before.boost.y });
      });
    }
  });
}
