// E2E: BL-104 音の e2e（PR #8〔BL-102〕のレビューの N-3。CEO 決定で BL-104 の受け入れ基準に追加。PR の e2e〔chromium〕）
// - 見張るもの: main.ts の最初の入力の `unlockAudio((e) => errorLog.push(e))` の結線（BL-102 の S-1 の案 (a)）。
//   ZzFX のチャンク（`assets/zzfx-<hash>.js`）が届かないのは環境の制約ではなく配信の不具合なので、errors() に 1 件だけ残す。
//   console には出さず（ページの例外〔pageerror〕も 0）、音以外の動作（打撃）は続く。結線が落ちると errors() が 0 件で赤になる
// - Chromium には AudioContext があるので、読み込みの前の「AudioContext がない環境は黙る」には当たらず、チャンクを取りに行く
// - もう 1 件は、止まった AudioContext を次の入力で戻す main.ts の結線（window の capture の pointerdown・pointerup・touchend・
//   keydown → resumeAudio）の見張り。sfx.ts の中身は unit（tests/unit/sfx.test.ts）で確かめ、ここは結線だけを見る
import { test, expect } from './support/fixtures.ts';
import { bootGame, tapUnderground } from './support/boot.ts';
import { hitsOf } from './support/hooks.ts';

test.describe('BL-104 音', () => {
  test('ZzFX のチャンクが届かない: errors() に 1 件、ページの例外 0 件、5 回叩いて打撃 5（BL-102 の結線の見張り。PR #8 のレビュー N-3）', async ({
    page,
    harness,
  }) => {
    let aborted = 0;
    await page.route('**/assets/zzfx-*.js', (r) => {
      aborted++;
      return r.abort();
    });
    const g = await bootGame(page);
    const h0 = hitsOf(await g.getState());
    expect(await g.errors(), '起動の時点では音を読み込まない（最初の入力で読み込む）').toEqual([]);

    await tapUnderground(page, 5);
    // 動的 import の失敗の通知を待つ（読み込みは最初の入力の 1 回だけで、再試行しない）
    await expect.poll(async () => (await g.errors()).length, { timeout: 5_000 }).toBeGreaterThan(0);
    await page.clock.runFor(500);

    const errors = await g.errors();
    expect(errors, 'ZzFX のチャンクの失敗が 1 件だけ残る（入力のたびに増えない）').toHaveLength(1);
    expect(errors[0]).toMatch(/zzfx-/);
    expect(aborted, 'チャンクを取りに行ったのは 1 回だけ').toBe(1);
    expect(harness.pageErrors, '処理されない拒否・例外がない').toEqual([]);
    expect(hitsOf(await g.getState()) - h0, '音が使えなくても 5 回の打撃が入る').toBe(5);
  });

  test('一度 running になった後に止まった AudioContext は、次の入力（クリック・キー）のハンドラで running に戻る（main.ts の resumeAudio の結線の見張り）', async ({
    page,
    harness,
  }) => {
    // ZzFX が読み込み時に作る AudioContext を捕まえる（ゲームのコードは変えない。クラスを継承して作られたものを覚えるだけ）
    await page.addInitScript(() => {
      const Orig = window.AudioContext;
      const made: AudioContext[] = [];
      (window as unknown as { __e2eAudio: AudioContext[] }).__e2eAudio = made;
      window.AudioContext = class extends Orig {
        constructor(o?: AudioContextOptions) {
          super(o);
          made.push(this);
        }
      };
    });
    const state = (): Promise<string | null> =>
      page.evaluate(() => (window as unknown as { __e2eAudio: AudioContext[] }).__e2eAudio[0]?.state ?? null);
    const suspend = (): Promise<string> =>
      page.evaluate(async () => {
        const c = (window as unknown as { __e2eAudio: AudioContext[] }).__e2eAudio[0]!;
        await c.suspend();
        return c.state;
      });

    const g = await bootGame(page);
    expect(await state(), '最初の入力の前は AudioContext を作らない').toBeNull();
    await tapUnderground(page, 1); // 最初の入力: ZzFX を読み込んで resume（iOS 対策。BL-102 の前から同じ）
    await expect.poll(state, { timeout: 5_000 }).toBe('running');

    // iOS のバックグラウンドからの復帰・電話の後などを模して止める → 次のクリックで戻る
    expect(await suspend()).toBe('suspended');
    await tapUnderground(page, 1);
    await expect.poll(state, { timeout: 2_000, message: 'クリックの後に running に戻る' }).toBe('running');

    // キー（Space）でも戻る
    expect(await suspend()).toBe('suspended');
    await page.keyboard.press('Space');
    await expect.poll(state, { timeout: 2_000, message: 'Space の後に running に戻る' }).toBe('running');

    expect(await g.errors()).toEqual([]);
    expect(harness.pageErrors).toEqual([]);
  });
});
