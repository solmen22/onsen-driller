// E2E: BL-126 の btn-boost の表記と幅（PR #55 のレビュー S-1・S-2）
// - 390×844（と 320×568）の ja・en で、ready → active（自動掘削機なし「×2 5:00」）→ active（自動掘削機あり「×2（掘削機×4） 5:00」）→ 最初の 1 打の後、
//   のどの場面でも btn-boost の幅・高さが同じ（高さ 44px）、状態の行が 1 行でボタンからはみ出さず、隣の「自動掘り」のボタンの x が変わらない
// - 最初の 1 打の前は「タップで掘る」の案内と幅を取り合う（縮むのは案内の側）。レビューの計測では、ここで 2 行に折り返していた
// - 実機（iPhone）の見え方は QA の目視。ここは chromium の 390×844
// - TS-126-05（BL-136）: プレイヤーの操作なしに状態が変わる場面（効果が終わって休み → 休みが明けて ready）でも同じことを確かめる。
//   効果の残りはロジックの時間（advance）、休みは壁時計（readyAtWallMs。setClock）で進む（PR #55 の再レビューの S-2 の形）
// - TS-126-06（BL-136）: 動画もチケットも使えない unavailable（「使えない」／「Unavailable」。en はいちばん長い）でも同じ。
//   「準備中」／「Soon」はご褒美の口がつながっていないときだけの表記で、e2e のビルドではつながっているので出ない
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

for (const [locale, digger, rest, ready, unavailable] of [
  ['ja-JP', '×2（掘削機×4） 5:00', '休み 15:00', '使える', '使えない'],
  ['en-US', '×2 (digger ×4) 5:00', 'Rest 15:00', 'Ready', 'Unavailable'],
] as const) {
  test.describe(`BL-126 btn-boost の表記と幅（${locale}）`, () => {
    test.use({ locale });

    for (const vp of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      test(`TS-126-04 S-1・S-2 ${vp.width}×${vp.height}: ready → active（掘削機なし・あり）→ 最初の 1 打の後で、幅・高さ 44px・1 行・自動掘りの位置が変わらない（${locale}）`, async ({ page }) => {
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
        expectSteady(shots);
      });

      test(`TS-126-05 ${vp.width}×${vp.height}: 効果が終わって休み → 休みが明けて ready（操作なしの変化）でも、幅・高さ 44px・1 行・自動掘りの位置が変わらない（${locale}）`, async ({ page }) => {
        const g = await bootGame(page, { viewport: vp });
        await settle(page);
        const shots: Shot[] = [];
        shots.push(await measure(page)); // ready（案内あり）
        const t0 = await page.evaluate(() => Date.now()); // 使った時刻（休みの明けは t0 + 15 分）
        await page.getByTestId('btn-boost').click();
        await page.getByTestId('sheet-ticket').click();
        await settle(page);
        shots.push(await measure(page)); // active
        await g.pause();
        await g.advance(301_000); // 効果（5 分）が終わる。壁時計は進めないので休みの残りは 15:00
        await settle(page);
        shots.push(await measure(page)); // 休み
        await g.setClock(t0 + 16 * 60_000); // 休み（15 分）が明ける
        await g.advance(100); // UI へ通知する（ループは止めてある）
        await settle(page);
        shots.push(await measure(page)); // ready に戻る
        test.info().annotations.push({ type: '計測', description: JSON.stringify(shots) });

        expect(shots.map((s) => s.state)).toEqual(['ready', 'active', 'cooldown', 'ready']);
        expect(shots.map((s) => s.hint)).toEqual([true, true, true, true]);
        expect(shots[2]!.text).toBe(rest);
        expect(shots[3]!.text).toBe(ready);
        expectSteady(shots);
      });

      test(`TS-126-06 ${vp.width}×${vp.height}: 動画もチケットも使えない（unavailable）でも、幅・高さ 44px・1 行・自動掘りの位置が変わらない（${locale}）`, async ({ page }) => {
        const g = await bootGame(page, { viewport: vp });
        await settle(page);
        const shots: Shot[] = [];
        shots.push(await measure(page)); // ready（案内あり）
        await g.setAdResult('unavailable');
        const s = await g.getState();
        await g.setState({ ...s, meta: { ...s.meta, tickets: 0 } });
        await settle(page);
        shots.push(await measure(page)); // unavailable（案内あり）
        await g.dispatch({ type: 'tap' });
        await settle(page);
        shots.push(await measure(page)); // unavailable・最初の 1 打の後（案内なし）
        test.info().annotations.push({ type: '計測', description: JSON.stringify(shots) });

        expect(shots.map((x) => x.state)).toEqual(['ready', 'unavailable', 'unavailable']);
        expect(shots.map((x) => x.hint)).toEqual([true, true, false]);
        expect(shots[1]!.text).toBe(unavailable);
        expectSteady(shots);
      });
    }
  });
}

/** どの場面でも 1 行・はみ出さない・高さ 44・幅は最初の場面と同じ・自動掘りのボタンが跳ねない（TS-126-04〜06） */
function expectSteady(shots: readonly Shot[]): void {
  for (const s of shots) {
    expect(s.lines, `${s.text}: 1 行`).toBe(1);
    expect(s.inside, `${s.text}: ボタンからはみ出さない`).toBe(true);
    expect(s.h, `${s.text}: 高さ`).toBe(44);
    expect(s.w, `${s.text}: 幅は固定`).toBe(shots[0]!.w);
    expect(s.autoX, `${s.text}: 自動掘りのボタンが跳ねない`).toBe(shots[0]!.autoX);
    expect(s.autoX, '画面からはみ出さない').toBeGreaterThanOrEqual(0);
  }
}
