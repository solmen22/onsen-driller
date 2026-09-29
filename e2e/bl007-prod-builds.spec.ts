// E2E: 本番の 4 ビルドの起動（BL-007_build-targets.md の TS-007-03・09・13、BL-071_test-hooks.md の TS-071-03 の実行時の部分）
//
// プロジェクト prod-builds（playwright.config.ts）でだけ動く。`npm run build:all` の dist/web・crazygames・itch・poki を
// e2e/support/serve-prod.mjs が itch.io のサブパス配信を模した /html/123/<target>/ で配信する。
// シナリオの「実装のまとめ方」どおり、4 種をそれぞれ 1 回ずつ開き、同じページで 3 つ（＋TS-071-03）を確かめる（ページの読み込みは計 4 回）。
// - 本番のビルドにはテスト用フック（window.__game）が無いので bootGame を使わない。時計も固定しない（実時間で起動・操作する）
// - 外部のドメイン（ポータルの SDK）は page.route で空の応答を返す（CI は外に出られない。SDK の読み込みに失敗しても起動することの確認を兼ねる）。
//   共通の検査（harness）の許可リストは、同一オリジンとそのビルドの SDK のオリジンだけ（web・itch は同一オリジンだけ）
// - SDK の init の失敗・タイムアウトでの続行は S2（BL-056・BL-057）で足す（シナリオの「保留・後続スプリント」）
import { test, expect } from './support/fixtures.ts';
import { BOOT_TIMEOUT_MS } from './support/boot.ts';
import { indexPathOf, PROD_TARGETS, SDK_OF, SUBPATH } from './support/prod.ts';

/** 画面の操作だけで叩く回数（連打の上限 8 回/秒の中。4 打で深さ 0 のブロック〔HP 4〕が壊れる。Q-02） */
const TAPS = 8;

for (const target of PROD_TARGETS) {
  const sdk = SDK_OF[target];
  test.describe(`本番のビルド ${target}`, () => {
    test.use({
      allowedOrigins: async ({ baseURL }, use) => {
        await use([new URL(baseURL ?? 'http://127.0.0.1').origin, ...(sdk ? [new URL(sdk).origin] : [])]);
      },
    });

    test(`TS-007-03・09・13・TS-071-03 ${target}: サブパスで 0 クリックでゲーム画面・404 なし・__game なし・エラーなく掘れる`, async ({
      page,
      harness,
      request,
    }) => {
      // ビルドがあるか（無ければ理由つきですぐ失敗する。黙って飛ばさない）
      const health = (await (await request.get('/__health')).json()) as { built: string[] };
      expect(health.built, `dist/${target} がありません。先に npm run build:all（CI では e2e ジョブに本番のビルドを渡す: BL-095）`).toContain(target);

      const origin = harness.origin;
      const prefix = `${SUBPATH}${target}/`;
      const sdkHits: string[] = [];
      if (sdk)
        await page.route(sdk, (r) => {
          sdkHits.push(r.request().url());
          return r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' });
        });
      const bad: string[] = []; // 4xx・5xx の応答と、失敗した要求
      const sameOrigin: string[] = [];
      const external: string[] = [];
      page.on('response', (r) => {
        if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
      });
      page.on('requestfailed', (r) => bad.push(`失敗 ${r.failure()?.errorText ?? ''} ${r.url()}`));
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return;
        if (u.origin === origin) sameOrigin.push(u.pathname);
        else external.push(u.href);
      });

      // TS-007-03: サブパスで開き、どこもクリックせずにゲーム画面（キャンバスと HUD）
      const started = Date.now();
      await page.goto(indexPathOf(target));
      await expect(page.locator('[data-testid="stage"] canvas')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
      await expect(page.getByTestId('hud-coins')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
      await expect(page.getByTestId('app-root')).toHaveAttribute('data-ready', 'true', { timeout: BOOT_TIMEOUT_MS });
      const bootMs = Date.now() - started;
      test.info().annotations.push({ type: `${target}: ゲーム画面までの実時間(ms)`, description: String(bootMs) });
      expect(bootMs).toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
      expect(new URL(page.url()).pathname).toBe(indexPathOf(target));

      // TS-007-09・TS-071-03: テスト用フックが本番に入らない
      expect(await page.evaluate(() => typeof (window as unknown as { __game?: unknown }).__game)).toBe('undefined');

      // TS-007-13: 画面の操作だけで掘れる（HUD の data-value で見る。フックが無いので状態は読めない）
      const box = await page.getByTestId('stage').boundingBox();
      expect(box, 'stage が見える').not.toBeNull();
      const p = { x: box!.x + box!.width / 2, y: box!.y + box!.height * 0.75 };
      for (let i = 0; i < TAPS; i++) await page.mouse.click(p.x, p.y);
      await expect.poll(async () => Number(await page.getByTestId('hud-depth').getAttribute('data-value')), { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
      await expect.poll(async () => Number(await page.getByTestId('hud-coins').getAttribute('data-value')), { timeout: 5_000 }).toBeGreaterThan(0);
      test.info().annotations.push({
        type: `${target}: ${TAPS} 回叩いた後の HUD`,
        description: `coins=${await page.getByTestId('hud-coins').getAttribute('data-value')} depth=${await page.getByTestId('hud-depth').getAttribute('data-value')}`,
      });
      await page.waitForTimeout(500); // 叩いた後の描画・保存の契機のエラーも拾う

      // TS-007-03: 404 などの失敗した通信がない。同一オリジンの要求はすべてサブパスの中（絶対パス〔/assets/…〕の参照がない）
      expect(bad).toEqual([]);
      expect(sameOrigin.length).toBeGreaterThan(0);
      expect(sameOrigin.filter((path) => !path.startsWith(prefix))).toEqual([]);
      // 外部への要求は、そのビルドの SDK の script だけ（web・itch は 0 件。取り違えたビルドを配信していないことの確認も兼ねる）
      expect(external).toEqual(sdk ? [sdk] : []);
      expect(sdkHits).toHaveLength(sdk ? 1 : 0);
      // TS-007-13: 捕まえていない例外・console.error がない
      expect(harness.pageErrors).toEqual([]);
      expect(harness.consoleErrors).toEqual([]);
    });
  });
}
