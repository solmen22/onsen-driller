// E2E: BL-104 音の e2e（PR #8〔BL-102〕のレビューの N-3。CEO 決定で BL-104 の受け入れ基準に追加。PR の e2e〔chromium〕）
// - 見張るもの: main.ts の最初の入力の `unlockAudio((e) => errorLog.push(e))` の結線（BL-102 の S-1 の案 (a)）。
//   ZzFX のチャンク（`assets/zzfx-<hash>.js`）が届かないのは環境の制約ではなく配信の不具合なので、errors() に 1 件だけ残す。
//   console には出さず（ページの例外〔pageerror〕も 0）、音以外の動作（打撃）は続く。結線が落ちると errors() が 0 件で赤になる
// - Chromium には AudioContext があるので、読み込みの前の「AudioContext がない環境は黙る」には当たらず、チャンクを取りに行く
// - もう 1 件は、止まった AudioContext を次の入力で戻す main.ts の結線（window の capture の pointerdown・pointerup・touchend・
//   keydown → resumeAudio）の見張り。sfx.ts の中身は unit（tests/unit/sfx.test.ts）で確かめ、ここは結線だけを見る
// - TS-ID（TS-104-01・02）はシナリオ org/30_quality/test-designer/scenarios/BL-104_audio-resume.md のもの（PR #29 のレビューの Nit）
// - 毎晩（run 37241180586）の赤の直し（BL-104 の e2e の初回の毎晩。実行記録 org/30_quality/test-engineer/runs/2026-10-05_nightly-37241180586.md）:
//   TS-104-01 は WebKit の動的 import の失敗の文にチャンクの名前が入らない（"Importing a module script failed."）ので、WebKit だけその文も認める。
//   TS-104-02 は、音の出力の装置が開けない環境（CI の Linux の Firefox）では、ゲームと関係のない AudioContext も running にならないので、
//   その対照で確かめたときだけ Firefox に限って対象外にする
import { test, expect, type Harness } from './support/fixtures.ts';
import { bootGame, tapUnderground } from './support/boot.ts';
import { hitsOf } from './support/hooks.ts';

test.describe('BL-104 音', () => {
  test('TS-104-01 ZzFX のチャンクが届かない: errors() に 1 件、ページの例外 0 件、5 回叩いて打撃 5（BL-102 の結線の見張り。PR #8 のレビュー N-3）', async ({
    page,
    harness,
    browserName,
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
    // Chromium・Firefox の文にはチャンクの URL が入る。WebKit の文は "TypeError: Importing a module script failed." だけで URL が入らない
    // （毎晩 run 37241180586 の webkit・mobile-safari）。どのチャンクかは、上の 1 件だけ・下の aborted が 1・打撃が入る（描画のチャンクは届いた）で絞る
    expect(errors[0]).toMatch(browserName === 'webkit' ? /zzfx-|Importing a module script failed/ : /zzfx-/);
    expect(aborted, 'チャンクを取りに行ったのは 1 回だけ').toBe(1);
    expect(await harness.uncaughtErrors(), '処理されない拒否・例外がない').toEqual([]);
    expect(hitsOf(await g.getState()) - h0, '音が使えなくても 5 回の打撃が入る').toBe(5);
  });

  test('TS-104-02 一度 running になった後に止まった AudioContext は、次の入力（クリック・キー）のハンドラで running に戻る（main.ts の resumeAudio の結線の見張り）', async ({
    page,
    harness,
    browserName,
  }) => {
    // 対照: ゲームと関係のないページで、クリックのハンドラの中で AudioContext を作って resume する。これも running にならない環境は、
    // 音の出力の装置が開けない（CI の Linux の Firefox。cubeb が開けず resume() が解決しない。手元の Firefox で
    // media.cubeb.force_null_context を true にすると同じ形になる）。Firefox に限ってこのときだけ対象外にする（Chromium・WebKit 系は必須のまま）
    if (browserName === 'firefox') {
      const probe = await audioProbe(harness);
      test.info().annotations.push({ type: '対照: 入力の中で作った AudioContext', description: probe });
      test.skip(probe !== 'running', `${browserName} のこの環境は音の出力の装置が開けない（対照の AudioContext も ${probe}）`);
    }
    // ZzFX が読み込み時に作る AudioContext を捕まえる（ゲームのコードは変えない。クラスを継承して作られたものを覚えるだけ）。
    // resume が呼ばれた時点の window.event を記録する（同期のリスナーの中でだけ値がある。非同期に呼ぶ形に変わると null になる。PR #29 のレビューの S-1 (b)）
    await page.addInitScript(() => {
      const Orig = window.AudioContext;
      const made: AudioContext[] = [];
      const resumedIn: (string | null)[] = [];
      Object.assign(window, { __e2eAudio: made, __e2eResumedIn: resumedIn });
      window.AudioContext = class extends Orig {
        constructor(o?: AudioContextOptions) {
          super(o);
          made.push(this);
        }
        override resume(): Promise<void> {
          resumedIn.push(window.event?.type ?? null);
          return super.resume();
        }
      };
    });
    const resumedIn = (): Promise<(string | null)[]> =>
      page.evaluate(() => (window as unknown as { __e2eResumedIn: (string | null)[] }).__e2eResumedIn.slice());
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
    // 待ちは 10 秒（本物の再開は手元の Windows の Chrome で 205〜1157ms。2 秒では約 3% が赤。PR #29 のレビューの S-1 (a)）。合格なら待たない
    await expect.poll(state, { timeout: 10_000 }).toBe('running');

    // iOS のバックグラウンドからの復帰・電話の後などを模して止める → 次のクリックで戻る
    expect(await suspend()).toBe('suspended');
    let from = (await resumedIn()).length;
    await tapUnderground(page, 1);
    await expect.poll(state, { timeout: 10_000, message: 'クリックの後に running に戻る' }).toBe('running');
    const byClick = (await resumedIn()).slice(from);
    expect(byClick.length, 'クリックで resume が呼ばれた').toBeGreaterThan(0);
    expect(byClick.every((t) => t === 'pointerdown' || t === 'pointerup'), `resume はクリックの pointerdown・pointerup のハンドラの中で同期に呼ばれる（${byClick.join(',')}）`).toBe(true);

    // キー（Space）でも戻る
    expect(await suspend()).toBe('suspended');
    from = (await resumedIn()).length;
    await page.keyboard.press('Space');
    await expect.poll(state, { timeout: 10_000, message: 'Space の後に running に戻る' }).toBe('running');
    const byKey = (await resumedIn()).slice(from);
    expect(byKey.length, 'Space で resume が呼ばれた').toBeGreaterThan(0);
    expect(byKey.every((t) => t === 'keydown'), `resume は Space の keydown のハンドラの中で同期に呼ばれる（${byKey.join(',')}）`).toBe(true);

    expect(await g.errors()).toEqual([]);
    expect(await harness.uncaughtErrors()).toEqual([]);
  });
});

/** 対照: ゲームと関係のないページで、クリックのハンドラの中で AudioContext を作って resume し、5 秒以内の状態を返す（'running' か、最後の状態） */
async function audioProbe(harness: Harness): Promise<string> {
  const p = await harness.newPage();
  await p.setContent('<button id="probe">probe</button>');
  await p.evaluate(() => {
    document.getElementById('probe')!.addEventListener('click', () => {
      const c = new AudioContext();
      Object.assign(window, { __probe: c });
      void c.resume().catch(() => undefined);
    });
  });
  await p.click('#probe');
  const read = (): Promise<string> =>
    p.evaluate(() => (window as unknown as { __probe?: AudioContext }).__probe?.state ?? 'none');
  for (let i = 0; i < 50; i++) {
    const st = await read();
    if (st === 'running') return st;
    await p.waitForTimeout(100);
  }
  return read();
}
