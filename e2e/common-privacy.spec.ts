// 共通の検査（e2e_common_privacy-checks.md）。
// TS-COM-01〜04 はすべての E2E の終わりに harness（e2e/support/fixtures.ts）が自動で行う。
// このファイルでは、代表の遊び方の後に同じ検査を目に見える形で行い、検査そのものが効くこと（偽の緑でないこと。TS-COM-08）を確かめる。
// PR: TS-COM-01〜04・08（S1。08 の (d)(e) は BL-094〔S2〕）。毎晩: TS-COM-05（BL-089）。保留: TS-COM-07・09（S4）。
// 欠番: TS-COM-06（BL-007 の TS-007-10 の静的検査に統合）、TS-073-08（TS-COM-08 に統合）。
import { test, expect, ExpectedViolationMissingError, teardownChecks, type TeardownCheckRecord } from './support/fixtures.ts';
import { bootGame, reloadGame, tapUnderground, triggerAutosave } from './support/boot.ts';
import { later } from './support/gaps.ts';
import { CommonCheckError, localStorageKeys, NET_JOURNAL_KEY, type CheckId } from './support/privacy.ts';

/** 代表の遊び方: 叩く → タブを一巡 → 自動保存 → 再読み込み（画面の操作だけ。フックの不足に左右されない） */
async function playTypicalSession(page: import('@playwright/test').Page): Promise<void> {
  await bootGame(page);
  await tapUnderground(page, 12);
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    await page.clock.runFor(200);
  }
  await triggerAutosave(page);
  await reloadGame(page);
  await page.clock.runFor(1_000);
}

test.describe('共通の検査（通信・Cookie・キー名）', () => {
  test('TS-COM-01〜04 代表の遊び方の後、許可リスト外の通信・WebSocket・Cookie・接頭辞のないキーがない', async ({ page, harness }) => {
    await playTypicalSession(page);
    const v = await harness.violations();
    // 検査ごとに分けて見せる（失敗したときにどれか分かるように）
    expect(v.filter((x) => x.check === 'TS-COM-01'), 'TS-COM-01 許可リスト外への通信').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-02'), 'TS-COM-02 WebSocket・ビーコン').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-03'), 'TS-COM-03 Cookie').toEqual([]);
    expect(v.filter((x) => x.check === 'TS-COM-04'), 'TS-COM-04 キー名').toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // 同一オリジンへの要求は記録されている（何も記録していないことによる偽の緑でない）
    expect(harness.monitorOf(page.context()).requests.some((r) => r.url.startsWith(harness.origin))).toBe(true);
  });

  test('TS-COM-05 sessionStorage・IndexedDB・Cache Storage に保存先を増やしていない【提案】 @nightly', async ({ page }) => {
    await playTypicalSession(page);
    const r = await page.evaluate(async () => ({
      session: Object.keys(sessionStorage),
      idb: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map((d) => d.name ?? '') : [],
      caches: typeof caches === 'undefined' ? [] : await caches.keys(),
    }));
    expect(r.session.filter((k) => !k.startsWith('onsen-driller:'))).toEqual([]);
    expect(r.idb).toEqual([]);
    expect(r.caches).toEqual([]);
  });

  test('TS-COM-07 外部へのリンクはプライバシーポリシーだけ', () => {
    later('S4:externalLinks');
  });

  test('TS-COM-09 本番スモークで通信・Cookie を検査する', () => {
    later('S4:smoke');
  });
});

// (a)(b)(c) は、テストの終わりの共通の検査（harness の後片付け。すべての E2E と同じ経路）が、指定した ID の違反を検出したときだけ通る
// （test.use の expectViolations。検出されなければ「期待した違反が検出されなかった」で失敗し、ほかの ID の違反や、
// 本体の別の例外でも失敗する。以前の test.fail は理由を問わず「期待どおりの失敗」にしていた。PR #4 のレビュー S-1）
// (d)(e) は、その後片付けの検査が実際に行われていること自体を見張る（PR #4 の再レビュー R-S1。BL-094）:
// 後片付けから検査の呼び出しを消す・期待した違反のあるテストだけに絞る・例外を握りつぶす、のどれでも (d) か (e) が赤になる。
// fixtures.ts の teardownChecks（ワーカーごとの記録）を読むので、この describe は serial（同じワーカーで宣言の順に流す）にする。
// fullyParallel のままだと (d) が別のワーカーに分かれ、記録が見えない
test.describe('TS-COM-08 偽の緑を防ぐ自己テスト（共通の検査が違反を検出することの確認）', () => {
  test.describe.configure({ mode: 'serial' });

  test.describe('(a)', () => {
    test.use({ expectViolations: ['TS-COM-01'] });
    test('TS-COM-08 (a) 外部への fetch を入れると、テストの終わりの検査が TS-COM-01 の違反を検出する', async ({ page }) => {
      await bootGame(page);
      await page.evaluate(() => fetch('https://example.com/x').catch(() => {}));
    });
  });

  test.describe('(b)', () => {
    test.use({ expectViolations: ['TS-COM-02'] });
    test('TS-COM-08 (b) 外部への WebSocket を開くと、テストの終わりの検査が TS-COM-02 の違反を検出する', async ({ page }) => {
      await bootGame(page);
      await page.evaluate(() => {
        new WebSocket('wss://example.com/ws');
      });
    });
  });

  test.describe('(c)', () => {
    test.use({ expectViolations: ['TS-COM-01', 'TS-COM-02'] });
    test('TS-COM-08 (c) ページを離れるとき（pagehide）のビーコン・keepalive の fetch・画像を外部へ送って再読み込みすると、テストの終わりの検査が検出する（M-1）', async ({ page, harness }) => {
      // pagehide の送信は context.on('request')・context.route に来ない（レビュー M-1 の P3a）。ページの記録（sessionStorage）で拾う
      await bootGame(page);
      await page.evaluate(() => {
        addEventListener('pagehide', () => {
          navigator.sendBeacon('https://example.com/unload-beacon', 'x');
          void fetch('https://example.com/unload-keepalive', { method: 'POST', body: 'x', keepalive: true }).catch(() => {});
          new Image().src = 'https://example.com/unload-image.png';
        });
      });
      await reloadGame(page);
      const v = await harness.violations();
      // 3 つとも、送り先と種類まで正しく数えている（テストの終わりの検査はこれと同じ関数）
      expect(v).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('https://example.com/unload-beacon') }),
          expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/unload-keepalive') }),
          expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/unload-image.png') }),
        ]),
      );
      // 記録のキーは sessionStorage の onsen-driller: の接頭辞（localStorage には書かないので TS-COM-04 と矛盾しない）
      expect(await page.evaluate(() => Object.keys(sessionStorage))).toContain(NET_JOURNAL_KEY);
      expect((await localStorageKeys(page.context())).map((k) => k.name).filter((k) => k === NET_JOURNAL_KEY)).toEqual([]);
    });
  });

  test('TS-COM-08 補助: 失敗の中身が正しい（どの検査が、どの要求・値で違反としたか）', async ({ harness }) => {
    // (a)・(b) は「失敗した」ことしか分からないので、同じ検査の関数で違反の中身まで確かめる。
    // わざと違反を起こす context は、確かめた後にテストの終わりの検査から外す
    const ctx = await harness.newContext();
    const page = await ctx.newPage();
    await bootGame(page);
    await page.evaluate(async () => {
      await fetch('https://example.com/x').catch(() => {});
      new WebSocket('wss://example.com/ws');
      navigator.sendBeacon('https://example.com/beacon', 'x');
      document.cookie = 'e2e=1';
      localStorage.setItem('no-prefix-key', '1');
    });
    const monitor = harness.monitorOf(ctx);
    await expect.poll(async () => (await monitor.violations()).length).toBeGreaterThanOrEqual(5);
    expect(await monitor.violations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'TS-COM-01', detail: expect.stringContaining('https://example.com/x') }),
        expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('wss://example.com/ws') }),
        expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('https://example.com/beacon') }),
        expect.objectContaining({ check: 'TS-COM-03', detail: expect.stringContaining('e2e') }),
        expect.objectContaining({ check: 'TS-COM-04', detail: expect.stringContaining('no-prefix-key') }),
      ]),
    );
    // テストの終わりに使う関数と同じもので失敗になる
    await expect(harness.assertCommonChecks()).rejects.toThrow(CommonCheckError);
    // expectViolations（S-1）: 期待した ID のほかに違反があれば失敗する（TS-COM-02〜04 が残っている）
    await expect(harness.assertCommonChecks(['TS-COM-01'])).rejects.toThrow(CommonCheckError);
    await harness.release(ctx);
    // 記録（pageProbe）に残らないビーコン（別オリジンの iframe の中・<a ping> など）は、要求の種類（ping・beacon）だけで
    // TS-COM-02 に分ける（privacy.ts の violations()）。その経路を通す: ビーコンの後に記録を消す（PR #12 のレビュー N-2。
    // Chromium・WebKit は 'ping'、Firefox は 'beacon' の種類で来る）
    const ctx2 = await harness.newContext();
    const page2 = await ctx2.newPage();
    await bootGame(page2);
    await page2.evaluate((key) => {
      navigator.sendBeacon('https://example.com/beacon-unjournaled', 'x');
      sessionStorage.removeItem(key);
    }, NET_JOURNAL_KEY);
    const monitor2 = harness.monitorOf(ctx2);
    await expect.poll(async () => (await monitor2.violations()).length).toBeGreaterThanOrEqual(1);
    expect(await monitor2.netJournal(), '記録は消えている（要求の種類だけで分ける経路）').toEqual([]);
    expect(await monitor2.violations()).toEqual([
      expect.objectContaining({ check: 'TS-COM-02', detail: expect.stringContaining('https://example.com/beacon-unjournaled') }),
    ]);
    await harness.release(ctx2);
    await expect(harness.assertCommonChecks()).resolves.toBeUndefined();
    // expectViolations（S-1）: 期待した違反が検出されなければ失敗する（違反 0 件の context で TS-COM-01 を期待する）
    await expect(harness.assertCommonChecks(['TS-COM-01'])).rejects.toThrow(ExpectedViolationMissingError);
  });

  test('TS-COM-08 時計: Clock API のタイマーの中の例外は uncaughtErrors() に入り、自分で出した console.error(new Error) は、タイマーの外でも、アプリのスクリプト（http の URL）からタイマーの中で出しても入らない（BL-119・BL-131）', async ({
    page,
    harness,
  }) => {
    // privacy.ts の clockUncaughtErrorOf は Playwright の内部の関数名（CLOCK_TIMER_RUNNER）に頼る。Playwright の版を上げて名前が
    // 変わると見分けが黙って効かなくなるので、常設の自己テストで確かめる（BL-108 の後続。PR #36 のレビューの S-1）
    // clockUncaughtErrorOf の 2 つの見分けを、それぞれ 1 件で試す（BL-131。PR #45 のレビューの Nit 2）
    // - own: page.evaluate から出す（位置は http でない）。スタックに CLOCK_TIMER_RUNNER がないので外れる（スタックの名前の見分け）
    // - app-in-timer: アプリと同じオリジンの http の URL のスクリプトが、Clock API のタイマーの中で出す（スタックに CLOCK_TIMER_RUNNER がある）。
    //   位置が http(s) なので外れる（位置の URL の見分け。store の購読者の例外などアプリが自分で出す console.error の形）。
    //   page.evaluate・addScriptTag({ content }) から出すと、Chromium では位置が http にならず、この見分けを試せない（2026-10-18 の手元の実測）
    await page.route('**/__clock-probe-app.js', (r) =>
      r.fulfill({ contentType: 'text/javascript', body: "setTimeout(() => { console.error(new Error('app-in-timer')); }, 10);" }),
    );
    await bootGame(page, { pauseClock: false });
    const before = harness.consoleErrors.length;
    await page.addScriptTag({ url: '/__clock-probe-app.js' });
    await page.evaluate(() => {
      console.error(new Error('own'));
      setTimeout(() => {
        throw new Error('clock-probe');
      }, 30);
    });
    await expect
      .poll(() => harness.uncaughtErrors(), { message: 'Clock API のタイマーの中の例外が uncaughtErrors() に入る（見分けの関数名が変わった？）' })
      .toContain('Error: clock-probe');
    // 見張りが 3 つの console.error（app-in-timer・own・clock-probe）を受けて見分けたこと（偽の緑を防ぐ。Firefox は text() が「Error」
    // だけなので文では探さず数で見る）と、own・app-in-timer を例外に数えないこと
    expect(harness.consoleErrors.length - before, 'console.error を 3 件受けた').toBeGreaterThanOrEqual(3);
    const uncaught = await harness.uncaughtErrors();
    expect(uncaught.filter((e) => e.includes('own')), 'タイマーの外の console.error（スタックの名前の見分け）').toEqual([]);
    expect(uncaught.filter((e) => e.includes('app-in-timer')), 'アプリのスクリプトの console.error（位置の URL の見分け）').toEqual([]);
  });

  test('TS-COM-08 (e) ふつうのテスト（expectViolations なし）で外部へ fetch すると、テストの終わりの検査がそのテストを失敗にする（R-S1。test.fail: 一覧の ✘ が合格）', async ({
    page,
  }) => {
    // 失敗するのが合格（test.fail）。失敗の理由が共通の検査（CommonCheckError）であることは、(d) が後片付けの記録で確かめる
    // （ほかの理由の失敗では (d) が赤になる。test.fail だけでは理由を問わない〔PR #4 のレビュー S-1〕ので、(d) と組にする）。
    // 後片付けが検査の例外を握りつぶす・呼び出しを消すと、このテストが「失敗するはずが通った」で赤になる
    test.fail(true, '共通の検査が期待していない違反（TS-COM-01）でこのテストを失敗にすること自体を確かめる自己テスト');
    await bootGame(page);
    await page.evaluate(() => fetch('https://example.com/e').catch(() => {}));
  });

  // 題名に「(c)」などの並びを入れない（-g "\(c\)" で (c) だけを流したときに一緒に流れて「(a) の記録がない」で赤になるため。PR #12 の
  // レビュー N-3）。(d) は TS-COM-08 の describe 全体を流して確かめる（-g "TS-COM-08"）。記録がないときに skip にはしない（変異の合図）
  test('TS-COM-08 (d) 自己テスト a・b・c・e・補助の共通の検査が、すべての E2E と同じ後片付けの経路で実際に行われた（R-S1）', () => {
    // serial なので、このワーカーで先に流れた (a)(b)(c)・補助・(e) の後片付けは、このテストの前に終わっている。
    // 失敗したら、TS-COM-08 の describe 全体を流し直す（-g "TS-COM-08"。(d) だけ・(c) だけを流すと記録がなく赤になる）
    const last = (prefix: string): TeardownCheckRecord | undefined => teardownChecks.filter((r) => r.title.startsWith(prefix)).at(-1);
    const seen = teardownChecks.map((r) => `${r.title.slice(0, 16)}… ${r.outcome}`).join(' / ') || 'なし';
    const cases: [string, CheckId[], string][] = [
      ['TS-COM-08 (a)', ['TS-COM-01'], 'passed'],
      ['TS-COM-08 (b)', ['TS-COM-02'], 'passed'],
      ['TS-COM-08 (c)', ['TS-COM-01', 'TS-COM-02'], 'passed'],
      // ふつうのテスト（expectViolations なし）も後片付けで検査している（期待した違反のあるテストだけに絞られていない）
      ['TS-COM-08 補助', [], 'passed'],
      // 期待していない違反で、後片付けの検査が CommonCheckError を投げた（(e) の失敗の理由）
      ['TS-COM-08 (e)', [], 'CommonCheckError'],
    ];
    for (const [prefix, expected, outcome] of cases) {
      const r = last(prefix);
      expect(r, `${prefix} の後片付けの検査の記録がない（harness の後片付けから共通の検査が外れた？ 記録: ${seen}）`).toBeDefined();
      expect({ expected: r?.expected, outcome: r?.outcome }, `${prefix} の後片付けの検査`).toEqual({ expected, outcome });
    }
  });
});
