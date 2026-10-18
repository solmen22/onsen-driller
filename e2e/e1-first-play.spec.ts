// E2E E1 初回起動 → 最初の強化（e2e_E1_first-play.md）
// PR: TS-E1-01〜06・08〜13・17（S1。03・04 と TS-071-17 は S2 の BL-056 で有効にした）。毎晩: TS-E1-07・15（BL-089）。
// シナリオの「実装のまとめ方」は 1 つの流れを勧めているが、ここでは ID ごとにテストを分けた（起動は 1 回 約 0.5 秒で、
// 分けても PR は 1 分未満。いまのビルドに無いフック・機能による保留を ID ごとに付けられ、失敗の場所も分かる）。
// S2: TS-E1-16（e2e-crazygames。同じ起動で TS-007-08。BL-074）。保留: TS-E1-14（S3）。
// いまのビルドに無いフック・機能を使うテストは needs() で保留になる（e2e/support/gaps.ts）。
// 技術リードの回答（traceability.md §5-2）に合わせた前提
// - Q-02: 0〜4m は鉱石にしない → 最初の強化はどのシードでも 14.5 秒。TS-E1-07 も #2 の範囲（5〜15 秒）で判定する（記録のみをやめた）。
// - Q-03: 自動掘りは道具が 1 段目（ツルハシ）から。Q-04(c)(d): 押した瞬間に 1 打、300ms で長押し（毎秒 4 打）、Space の短押しは 1 打。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures.ts';
import { BOOT_TIMEOUT_MS, bootGame, centerOf, setHidden, T0, tapUnderground, triggerAutosave } from './support/boot.ts';
import { bootCrazyGames, CG_BASE_URL, cgMockState } from './support/crazygames.ts';
import { later, needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks } from './support/hooks.ts';
import { recordedKeydowns } from './support/privacy.ts';
import { fullscreenButtons, startScreenElements } from './support/dom.ts';
import { SEED_A, SEED_B } from '../tests/helpers/seeds.ts';

const PKG_VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

const PICKAXE_COST = 3; // gdd §5-3・content/tools.ts（ツルハシ 3 コイン）
/** 画面で叩いてツルハシの代金をためる回数（必要な打撃は 29〔Q-02〕。叩いた数が落ちたら購入の前の expect で気づく。レビュー N-1） */
const TAPS_FOR_PICKAXE = 32;

/** advance(500, {tapsPerSec: 2}) を繰り返し、コインが 3 以上になった時刻 t（ms）を返す（最大 40 回＝20 秒） */
async function timeToPickaxe(g: Hooks): Promise<number | null> {
  for (let i = 1; i <= 40; i++) {
    await g.advance(500, { tapsPerSec: 2 });
    if (coinsOf(await g.getState()) >= PICKAXE_COST) return i * 500;
  }
  return null;
}

/** SEED_A で標準の打撃でツルハシを買える所まで進め、ツルハシを買う（TS-E1-08 の直後の状態） */
async function buyPickaxeByTaps(g: Hooks): Promise<void> {
  expect(await timeToPickaxe(g)).not.toBeNull();
  const r = await g.dispatch({ type: 'buy', item: 'tool', qty: 1 });
  expect(r.ok).toBe(true);
}

test.describe('E1 初回起動 → 最初の強化', () => {
  test('TS-E1-01 何も操作せずに 10 秒以内にキャンバスと HUD が見える（#1）', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('[data-testid="stage"] canvas')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    await expect(page.getByTestId('hud-coins')).toBeVisible({ timeout: BOOT_TIMEOUT_MS });
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'ゲーム画面までの実時間(ms)', description: String(ms) });
    expect(ms).toBeLessThanOrEqual(BOOT_TIMEOUT_MS);
  });

  test('TS-E1-01 道具の位置にタイトル画面・「タップで開始」の覆いがない', async ({ page }) => {
    needs('hook:rect');
    const g = await bootGame(page);
    const r = await g.rect('drill');
    expect(r, "rect('drill')").not.toBeNull();
    const c = centerOf(r!);
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const canvas = document.querySelector('[data-testid="stage"] canvas');
      return { onCanvas: !!el && !!canvas && (el === canvas || canvas.contains(el)), tag: el?.tagName ?? null, testid: el?.closest('[data-testid]')?.getAttribute('data-testid') ?? null };
    }, c);
    expect(hit.onCanvas, `elementFromPoint: ${JSON.stringify(hit)}`).toBe(true);
  });

  test('TS-E1-02 起動直後の状態と HUD（コイン 0・深さ 0・スコップ・自動掘りオフ）', async ({ page }) => {
    const g = await bootGame(page);
    const s = await g.getState();
    expect(coinsOf(s)).toBe(0);
    expect(s.run.depth).toBe(0);
    expect(s.run.drill.tool).toBe(0);
    expect(s.run.autoDig.on).toBe(false);
    await expect(page.getByTestId('hud-coins')).toHaveText(/^\D*0\D*$/);
  });

  test('TS-E1-02 起動直後の温泉チケットが 2（状態と HUD）', async ({ page }) => {
    needs('feature:tickets');
    const g = await bootGame(page);
    expect((await g.getState()).meta.tickets).toBe(2);
    await expect(page.getByTestId('hud-tickets')).toHaveText(/^\D*2\D*$/);
  });

  test.describe('ライフサイクル（S2）', () => {
    test('TS-E1-03 入力がない間は loadingStart → loadingStop だけ', async ({ page }) => {
      const g = await bootGame(page);
      const names = (await g.calls()).map((c) => c.name);
      expect(names.indexOf('loadingStart')).toBeGreaterThanOrEqual(0);
      expect(names.indexOf('loadingStop')).toBeGreaterThan(names.indexOf('loadingStart'));
      expect(names).not.toContain('gameplayStart');
    });

    test('TS-E1-04 最初のクリックで gameplayStart が loadingStop の後にちょうど 1 回（冪等）', async ({ page }) => {
      // 最初のクリックで 1 打が入ることは TS-012-15（S1）で確かめる（QA レビュー §3-1 で前半を削った）
      needs('hook:rect');
      const g = await bootGame(page);
      const c = centerOf((await g.rect('drill'))!);
      await page.mouse.click(c.x, c.y);
      let names = (await g.calls()).map((x) => x.name);
      expect(names.filter((n) => n === 'gameplayStart')).toHaveLength(1);
      expect(names.indexOf('gameplayStart')).toBeGreaterThan(names.indexOf('loadingStop'));
      await page.clock.runFor(200);
      await page.mouse.click(c.x, c.y);
      names = (await g.calls()).map((x) => x.name);
      expect(names.filter((n) => n === 'gameplayStart')).toHaveLength(1);
    });

    test('TS-071-17 platform.calls() が呼び出しを順番どおりに記録する', async ({ page }) => {
      needs('hook:rect');
      const g = await bootGame(page);
      const before = await g.calls();
      expect(before.every((c) => typeof c.name === 'string')).toBe(true);
      const c = centerOf((await g.rect('drill'))!);
      await page.mouse.click(c.x, c.y);
      const names = (await g.calls()).map((x) => x.name);
      const order = ['loadingStart', 'loadingStop', 'gameplayStart'].map((n) => names.indexOf(n));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  });

  test('TS-E1-05 ツルハシを買う前は自動掘りが表示されていて押せない（押しても 10 秒で打撃が増えない）', async ({ page }) => {
    needs('feature:autoDigLock');
    const g = await bootGame(page);
    await g.pause();
    const t = page.getByTestId('toggle-auto-dig');
    // PM の Q-17 回答: 表示して押せない（data-state="locked"・disabled）。「最初の強化」の定義は Q-03
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute('data-state', 'locked');
    await expect(t).toBeDisabled();
    await t.click({ force: true }); // 押しても何も起きない
    const h0 = hitsOf(await g.getState());
    await g.advance(10_000);
    expect(hitsOf(await g.getState()) - h0).toBe(0);
    expect((await g.getState()).run.autoDig.on).toBe(false);
  });

  test('TS-E1-06 標準の打撃（毎秒 2 打）で 5〜15 秒後にツルハシを買える（SEED_A。#2 の裏付け）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    const t = await timeToPickaxe(g);
    test.info().annotations.push({ type: 'TS-E1-06 t(ms)', description: String(t) });
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(5_000);
    expect(t!).toBeLessThanOrEqual(15_000);
  });

  test('TS-E1-07 SEED_B（保護のすぐ下の 5m が鉱石）でも 5〜15 秒後にツルハシを買える（Q-02: どのシードでも同じ） @nightly', async ({ page }) => {
    // Q-02 の回答: 0〜4m は鉱石にしないので、最初の強化までの時間はシードによらない（見込み 14,500ms）。
    // 旧 SEED_B（0m・1m が鉱石で 5 秒を下回る場合）は作れなくなったので、鉱石がいちばん浅く出るシードで #2 の範囲を確かめる
    needs('hook:seed', 'hook:advance.input');
    const g = await bootGame(page, { seed: SEED_B });
    await g.pause();
    const t = await timeToPickaxe(g);
    test.info().annotations.push({ type: 'TS-E1-07 t(ms)', description: String(t) });
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(5_000);
    expect(t!).toBeLessThanOrEqual(15_000);
  });

  test('TS-E1-08 画面でツルハシを買う（コインがちょうど 3 減り、ToolEvolved が 1 回、自動掘りが使えるようになる）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input', 'hook:events', 'feature:buyState', 'feature:autoDigLock');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    expect(await timeToPickaxe(g)).not.toBeNull();
    await page.clock.runFor(250); // UI の更新（5Hz）
    const buy = page.getByTestId('buy-tool');
    await expect(buy).toHaveAttribute('data-state', 'affordable');
    const hudBefore = await page.getByTestId('hud-coins').innerText();
    const before = await g.getState();
    await buy.click();
    const after = await g.getState();
    expect(after.run.drill.tool).toBe(1);
    expect(coinsOf(before) - coinsOf(after)).toBeCloseTo(PICKAXE_COST, 9);
    const evolved = (await g.events()).filter((e) => e.type === 'ToolEvolved' && e.tool === 1);
    expect(evolved).toHaveLength(1);
    await page.clock.runFor(250);
    await expect(page.getByTestId('hud-coins')).not.toHaveText(hudBefore);
    // HUD の値（data-value。Q-17: 表示の文字ではなく data-* で判定）が購入後の getState() のコインと同じ（レビュー N-3）
    expect(Number(await page.getByTestId('hud-coins').getAttribute('data-value'))).toBeCloseTo(coinsOf(after), 9);
    const toggle = page.getByTestId('toggle-auto-dig');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('data-state', 'off');
  });

  test('TS-E1-09 自動掘りをオンにすると 10 秒で打撃が 20 増える（自動掘削機 Lv0 の分は 0）', async ({ page }) => {
    needs('hook:seed', 'hook:advance.input', 'feature:autoDigLock');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    await buyPickaxeByTaps(g);
    await page.clock.runFor(250);
    const toggle = page.getByTestId('toggle-auto-dig');
    await toggle.click();
    await page.clock.runFor(250);
    await expect(toggle).toHaveAttribute('data-state', 'on');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect((await g.getState()).run.autoDig.on).toBe(true);
    const h0 = hitsOf(await g.getState());
    await g.advance(10_000);
    expect(hitsOf(await g.getState()) - h0).toBe(20);
  });

  test('TS-E1-10 道具の上で長押し 2 秒で約 8 打（毎秒 4 打）、離した後は増えない', async ({ page }) => {
    needs('hook:seed', 'hook:rect');
    const g = await bootGame(page, { seed: SEED_A });
    await g.resume();
    const c = centerOf((await g.rect('drill'))!);
    const h0 = hitsOf(await g.getState());
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.clock.runFor(2_000);
    await page.mouse.up();
    const h1 = hitsOf(await g.getState());
    // Q-04(c): 押した瞬間に 1 打、300ms で長押しを始め毎秒 4 打（最初の 1 打は間隔の半分の後）→ 1＋(2.0−0.3)×4＋0.5 ≒ 8 打
    test.info().annotations.push({ type: '長押し 2 秒の打撃', description: String(h1 - h0) });
    expect(h1 - h0).toBeGreaterThanOrEqual(7);
    expect(h1 - h0).toBeLessThanOrEqual(9);
    await page.clock.runFor(1_000);
    expect(hitsOf(await g.getState())).toBe(h1);
  });

  test('TS-E1-11 Space の押しっぱなし 2 秒で約 8 打（自動リピートは数えない）、Space・矢印キーはすべて preventDefault', async ({ page }) => {
    needs('hook:seed');
    const g = await bootGame(page, { seed: SEED_A });
    await g.resume();
    // 長押し: 押している間の自動リピート（repeat: true）の keydown を 10 回送る
    const h0 = hitsOf(await g.getState());
    await page.keyboard.down('Space');
    for (let i = 0; i < 10; i++) {
      await page.clock.runFor(200);
      await page.keyboard.down('Space');
    }
    await page.keyboard.up('Space');
    const h1 = hitsOf(await g.getState());
    test.info().annotations.push({ type: 'Space 2 秒の打撃', description: String(h1 - h0) });
    // 自動リピートをタップとして数えると 10 打多くなる
    expect(h1 - h0).toBeGreaterThanOrEqual(7);
    expect(h1 - h0).toBeLessThanOrEqual(9);
    // 短い押し 1 回（300ms 未満）は 1 打（Q-04(d)）。直前の 1 秒で連打の上限の窓を空けてから押す
    await page.clock.runFor(1_000);
    const h2 = hitsOf(await g.getState());
    await page.keyboard.press('Space');
    await page.clock.runFor(500);
    const shortPress = hitsOf(await g.getState()) - h2;
    test.info().annotations.push({ type: 'Space の短い押しの打撃', description: String(shortPress) });
    expect(shortPress).toBe(1);
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
    // ページ側で記録した keydown（準備の 2）。ゲームの処理の後の defaultPrevented を見る
    const keys = await recordedKeydowns(page);
    expect(keys.filter((k) => k.code === 'Space')).toHaveLength(12); // 長押し 1＋自動リピート 10＋短い押し 1
    expect(keys.filter((k) => k.code.startsWith('Arrow'))).toHaveLength(4);
    expect(keys.filter((k) => !k.prevented)).toEqual([]);
  });

  test('TS-E1-12・TS-042-10 全画面を要求しない・独自の全画面ボタンがない（CrazyGames の規約）。起動直後（0 クリック）にタイトル画面・開始ボタンもない', async ({
    page,
  }) => {
    await bootGame(page);
    // TS-042-10（BL-042）: 起動直後、どこも押していない時点で、タイトル画面・開始ボタン・全画面のボタンがなく、全画面を要求していない。
    // ゲーム画面の上に覆いがない（ステージの中の数か所で、いちばん上の要素がキャンバス。道具の位置は TS-E1-01 で見る）
    expect(await page.evaluate(() => (window as unknown as { __fsCalls: number }).__fsCalls)).toBe(0);
    expect(await startScreenElements(page)).toEqual([]);
    expect(await fullscreenButtons(page)).toEqual([]);
    // ステージの下端の「自動掘り」「ブースト」のボタン（キャンバスに重ねた帯。StageActions）より上の点だけを見る
    const covered = await page.evaluate(() => {
      const stage = document.querySelector('[data-testid="stage"]')!.getBoundingClientRect();
      const actionsTop = Math.min(
        stage.bottom,
        ...[...document.querySelectorAll('[data-testid="toggle-auto-dig"], [data-testid="btn-boost"]')].map((el) => el.getBoundingClientRect().top),
      );
      const out: string[] = [];
      for (const fx of [0.25, 0.5, 0.75]) {
        for (const fy of [0.3, 0.6, 0.9]) {
          const x = stage.left + stage.width * fx;
          const y = stage.top + (actionsTop - stage.top) * fy;
          const el = document.elementFromPoint(x, y);
          if (!(el instanceof HTMLCanvasElement && el.closest('[data-testid="stage"]')))
            out.push(`(${Math.round(x)},${Math.round(y)}) ${el?.tagName ?? 'null'} ${el?.closest('[data-testid]')?.getAttribute('data-testid') ?? ''}`);
        }
      }
      return out;
    });
    expect(covered).toEqual([]);
    await tapUnderground(page, 5);
    const offenders: string[] = [];
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.clock.runFor(200);
      offenders.push(...(await fullscreenButtons(page)));
    }
    expect(await page.evaluate(() => (window as unknown as { __fsCalls: number }).__fsCalls)).toBe(0);
    expect(offenders).toEqual([]);
  });

  test('TS-E1-13 E1 の一連の操作で、ページの例外と console.error が 0 件', async ({ page, harness }) => {
    const g = await bootGame(page);
    await tapUnderground(page, TAPS_FOR_PICKAXE); // 画面の操作だけでツルハシの代金をためる
    await page.clock.runFor(250);
    expect(coinsOf(await g.getState()), '画面で叩いてツルハシの代金がたまる').toBeGreaterThanOrEqual(PICKAXE_COST);
    await page.getByTestId('buy-tool').click();
    expect((await g.getState()).run.drill.tool).toBe(1);
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      await page.clock.runFor(200);
    }
    await page.clock.runFor(2_000);
    expect(harness.pageErrors).toEqual([]);
    expect(harness.consoleErrors).toEqual([]);
  });

  test('TS-E1-13 E1 の一連の操作で、__game.errors() が 0 件', async ({ page }) => {
    needs('hook:errors');
    const g = await bootGame(page);
    await tapUnderground(page, TAPS_FOR_PICKAXE);
    await page.clock.runFor(2_000);
    expect(await g.errors()).toEqual([]);
  });

  test('TS-E1-14 起動直後にチュートリアルの指アイコンが出る', async ({ page }) => {
    later('S3:tutorial');
    await bootGame(page);
    await expect(page.getByTestId('tutorial-finger')).toBeVisible();
  });

  test.describe('TS-E1-15 画面サイズ（800×450・1920×1080・390×844） @nightly', () => {
    for (const vp of [
      { name: '800x450', width: 800, height: 450, touch: false },
      { name: '1920x1080', width: 1920, height: 1080, touch: false },
      { name: '390x844', width: 390, height: 844, touch: true },
    ]) {
      test.describe(vp.name, () => {
        test.use({
          viewport: { width: vp.width, height: vp.height },
          hasTouch: vp.touch,
          // シナリオ: 390×844 は hasTouch・isMobile。Playwright の isMobile は Firefox では使えないので、そこだけ外す（レビュー N-4）
          isMobile: async ({ browserName }, use) => {
            await use(vp.touch && browserName !== 'firefox');
          },
        });
        test(`TS-E1-15 ${vp.name}: 0 クリックでゲーム画面、最初のタップで 1 打、ツルハシを画面で買える`, async ({ page }) => {
          needs('hook:seed', 'hook:rect', 'hook:advance.input', 'feature:buyState');
          const g = await bootGame(page, { seed: SEED_A });
          const c = centerOf((await g.rect('drill'))!);
          const h0 = hitsOf(await g.getState());
          if (vp.touch) await page.touchscreen.tap(c.x, c.y);
          else await page.mouse.click(c.x, c.y);
          expect(hitsOf(await g.getState()) - h0).toBe(1);
          await g.pause();
          expect(await timeToPickaxe(g)).not.toBeNull();
          await page.clock.runFor(250);
          const buy = page.getByTestId('buy-tool');
          await expect(buy).toHaveAttribute('data-state', 'affordable');
          if (vp.touch) await buy.tap();
          else await buy.click();
          expect((await g.getState()).run.drill.tool).toBe(1);
        });
      });
    }
  });

  test.describe('e2e-crazygames', () => {
    test.use({ baseURL: CG_BASE_URL });

    test('TS-E1-16 e2e-crazygames でライフサイクルがモックに記録され、タブを隠して戻しても gameplay の合図を送らない（同じ起動で TS-007-08）', async ({
      page,
      harness,
    }) => {
      needs('hook:rect');
      const g = await bootCrazyGames(page, harness);
      // TS-007-08: __game.target が crazygames、version が package.json と一致
      expect(await g.target()).toBe('crazygames');
      expect(await g.version()).toBe(PKG_VERSION);
      // TS-E1-03: 入力の前は loadingStart → loadingStop で、gameplayStart はない（loadingStart も SDK に届く）
      const boot = (await cgMockState(page)).log;
      expect(boot.indexOf('loadingStart'), 'loadingStart が SDK に届く').toBeGreaterThanOrEqual(0);
      expect(boot.indexOf('loadingStop')).toBeGreaterThan(boot.indexOf('loadingStart'));
      expect(boot).not.toContain('gameplayStart');
      // TS-E1-04: 最初のクリックで gameplayStart が 1 回（冪等）
      const c = centerOf((await g.rect('drill'))!);
      await page.mouse.click(c.x, c.y);
      await page.clock.runFor(200);
      await page.mouse.click(c.x, c.y);
      const gameplay = async (): Promise<{ sdk: string[]; calls: string[] }> => {
        const keep = (n: string): boolean => n === 'gameplayStart' || n === 'gameplayStop';
        return { sdk: (await cgMockState(page)).log.filter(keep), calls: (await g.calls()).map((x) => x.name).filter(keep) };
      };
      expect((await gameplay()).sdk, '最初の入力の後に gameplayStart が 1 回').toEqual(['gameplayStart']);
      expect((await cgMockState(page)).log.indexOf('gameplayStart')).toBeGreaterThan((await cgMockState(page)).log.indexOf('loadingStop'));
      // タブを隠して戻しても、SDK にも platform.calls() にも gameplayStop・gameplayStart が増えない（crazygames の例外）
      const before = await gameplay();
      await setHidden(page, true);
      await page.clock.runFor(200);
      await setHidden(page, false);
      await page.clock.runFor(200);
      expect(await gameplay(), 'タブの切り替えで gameplay の合図を送らない').toEqual(before);
      expect(await harness.uncaughtErrors()).toEqual([]);
    });
  });

  test('TS-E1-17 E1 の一連の操作の後、共通の検査（通信・Cookie・キー名）がすべて合格', async ({ page, harness }) => {
    const g = await bootGame(page);
    await tapUnderground(page, TAPS_FOR_PICKAXE);
    await page.clock.runFor(250);
    expect(coinsOf(await g.getState()), '画面で叩いてツルハシの代金がたまる').toBeGreaterThanOrEqual(PICKAXE_COST);
    await page.getByTestId('buy-tool').click();
    expect((await g.getState()).run.drill.tool).toBe(1);
    await triggerAutosave(page);
    await harness.assertCommonChecks();
  });
});
