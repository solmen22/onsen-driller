// E2E の基盤そのものの確認（BL-073_e2e-foundation.md の TS-073-04〜06。05・06 は BL-089 の扱いだが、基盤の自己テストとして PR で流す）と、
// KNOWN_GAPS（いまのビルドに無いもの）とビルドの突き合わせ（保留にしたテストが、実装が入っても保留のまま残らないように）
import { test, expect } from './support/fixtures.ts';
import { bootGame, HooksMissingError, pageNow, T0, triggerAutosave } from './support/boot.ts';
import { describeRequirement, isKnownGap, type Requirement } from './support/gaps.ts';
import { HOOK_MEMBERS, hitsOf, presentHookMembers, type HookMember } from './support/hooks.ts';
import { localStorageKeys } from './support/privacy.ts';
import { readSlots } from './support/storage.ts';

test.describe('E2E の基盤（BL-073）', () => {
  test('TS-073-04 テストの開始時にストレージと Cookie が空で、別の context に保存が漏れない', async ({ context, page, harness }) => {
    // 開始時の確認は harness（自動）も毎回行っている。ここでは目に見える形で確かめる
    expect(await context.cookies()).toEqual([]);
    expect(await localStorageKeys(context)).toEqual([]);
    await bootGame(page);
    await triggerAutosave(page); // 15 秒ごとの保存を起こす
    expect((await localStorageKeys(context)).length).toBeGreaterThan(0);
    // 新しい context（次のテストと同じ条件）には何も残っていない
    const other = await harness.newContext();
    expect(await other.cookies()).toEqual([]);
    expect(await localStorageKeys(other)).toEqual([]);
  });

  test('TS-073-05 bootGame が時計の固定・待ち合わせ・フックの確認・記録の開始を 1 か所で行う', async ({ page, harness }) => {
    const started = Date.now();
    await bootGame(page);
    test.info().annotations.push({ type: 'bootGame の実時間(ms)', description: String(Date.now() - started) });
    // 時計: T0 から始まり、起動の後は止まっている
    const n1 = await pageNow(page);
    expect(n1).toBeGreaterThanOrEqual(T0);
    expect(n1).toBeLessThan(T0 + 60_000);
    await page.waitForTimeout(300);
    expect(await pageNow(page)).toBe(n1);
    // フック
    expect(await page.evaluate(() => typeof (window as unknown as { __game?: unknown }).__game)).toBe('object');
    // 記録: 同一オリジンの要求が記録され、全画面の要求の数え上げが入っている
    expect(harness.monitorOf(page.context()).requests.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __fsCalls?: number }).__fsCalls)).toBe(0);
  });

  test('TS-073-06 テスト用フックの無いビルドでは、分かりやすい理由ですぐ失敗する', async ({ page, context }) => {
    // 本番のビルド（__game が入らない）を模す: window.__game に代入しても入らないようにする
    await context.addInitScript(() => {
      Object.defineProperty(window, '__game', { configurable: false, get: () => undefined, set: () => {} });
    });
    const started = Date.now();
    const err = await bootGame(page).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HooksMissingError);
    expect(String(err)).toContain('e2e ビルド');
    // いつまでも待たない（ゲーム画面の待ち 10 秒＋フックの待ち 5 秒より十分短い上限）
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  test('KNOWN_GAPS とビルドの突き合わせ（TS-071-01 の一覧の一部。保留の理由が古くなっていないこと）', async ({ page, harness }) => {
    const g = await bootGame(page);
    const problems: string[] = [];
    const found: string[] = [];
    const check = (req: Requirement, present: boolean): void => {
      if (isKnownGap(req) && present) problems.push(`${req} は実装済み → e2e/support/gaps.ts の KNOWN_GAPS から消す（${describeRequirement(req)}）`);
      else if (!isKnownGap(req) && !present) problems.push(`${req} が無い（KNOWN_GAPS に無いのに欠けている: ${describeRequirement(req)}）`);
      found.push(`${req}: ${present ? 'あり' : 'なし'}`);
    };

    // フックのメンバー（arch §8-4）
    const present = new Set(await presentHookMembers(page));
    const byGap: Partial<Record<HookMember, Requirement>> = {
      seed: 'hook:seed',
      setState: 'hook:setState',
      setClock: 'hook:setClock',
      grant: 'hook:grant',
      rect: 'hook:rect',
      renderStats: 'hook:renderStats',
      events: 'hook:events',
      errors: 'hook:errors',
    };
    for (const m of HOOK_MEMBERS) {
      const req = byGap[m];
      if (req) check(req, present.has(m));
      else if (!present.has(m)) problems.push(`window.__game.${m} が無い（BL-071 の API）`);
    }

    // advance(ms, {tapsPerSec}) の入力の引数: 自動掘りなしで 1 秒・毎秒 2 打なら打撃が 2 増える
    await g.pause();
    const h0 = hitsOf(await g.getState());
    await g.advance(1_000, { tapsPerSec: 2 });
    check('hook:advance.input', hitsOf(await g.getState()) - h0 === 2);

    // S1 の本体の機能
    const s = await g.getState();
    check('feature:tickets', typeof s.meta.tickets === 'number' && (await page.getByTestId('hud-tickets').count()) > 0);
    check('feature:autoDigLock', (await page.getByTestId('toggle-auto-dig').count()) > 0);
    check('feature:buyState', (await page.locator('[data-testid="buy-tool"][data-state]').count()) > 0);
    await triggerAutosave(page);
    await triggerAutosave(page);
    const slots = await readSlots(page.context(), harness.origin);
    check('feature:twoSlotSave', slots.a.raw !== null && slots.b.raw !== null);
    // feature:saveWarning は保存できない環境を作らないと確かめられないので、ここでは見ない（E9 のテストが保留になる）

    test.info().annotations.push({ type: '突き合わせ', description: found.join(' / ') });
    expect(problems).toEqual([]);
  });
});
