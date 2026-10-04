// E2E の test（BL-073）。すべての E2E はこのファイルの test を使う。
//
// - harness（自動）: テストごとの新しい browser context を見張り（通信・WebSocket・エラー・全画面の要求）、
//   テストの終わりに共通の検査（TS-COM-01〜04）を行う。違反があればそのテストを失敗にする。
//   検査の結果は teardownChecks に記録し、TS-COM-08 (d)・(e) が「この経路で検査が本当に行われている」ことを見張る（BL-094・R-S1）。
// - テストの開始時に、ストレージと Cookie が空であることを確かめる（TS-073-04。前のテストの保存が漏れない）
// - harness.newContext(): 同じ設定の context を追加で開く（storageState を書き換えて開き直す E5・E9 用）。見張りも付く
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import { CommonCheckError, ContextMonitor, localStorageKeys, type CheckId, type Violation } from './privacy.ts';

/** 自己テストが期待した違反を、共通の検査が検出しなかった（検査が効いていない＝偽の緑のおそれ） */
export class ExpectedViolationMissingError extends Error {
  constructor(missing: readonly CheckId[], found: readonly Violation[]) {
    super(
      `期待した違反（${missing.join('・')}）が共通の検査で検出されませんでした。検出した違反: ${
        found.length > 0 ? found.map((v) => `${v.check} ${v.detail}`).join(' / ') : 'なし'
      }`,
    );
    this.name = 'ExpectedViolationMissingError';
  }
}

/** テストの終わりの共通の検査の 1 回分の記録（R-S1） */
export interface TeardownCheckRecord {
  /** テストの題名（testInfo.title） */
  title: string;
  /** そのテストの expectViolations（ふつうのテストは空） */
  expected: CheckId[];
  /** 'passed'＝検査が通った。それ以外は検査が投げた例外の名前（CommonCheckError・ExpectedViolationMissingError など） */
  outcome: string;
}

/**
 * テストの終わり（harness の後片付け）の共通の検査を行うたびに、このワーカーで残す記録（PR #4 の再レビュー R-S1）。
 * TS-COM-08 (d)（common-privacy.spec.ts。serial で同じワーカー）が、先に流れた自己テストの記録を読み、検査が
 * すべての E2E と同じ後片付けの経路で実際に行われたこと（呼び出しが消えていない・期待した違反のあるテストだけに
 * 絞られていない・違反で投げた例外を握りつぶしていない〔(e)〕）を確かめる。以前の test.fail の形が持っていた性質の代わり
 */
export const teardownChecks: TeardownCheckRecord[] = [];

export class Harness {
  private readonly monitors: ContextMonitor[] = [];
  private readonly owned: BrowserContext[] = [];
  /** テストが自分で入れた、接頭辞のないキー（他のゲームのキーを模したもの）。TS-COM-04 の対象から外す */
  readonly foreignKeys = new Set<string>();
  private readonly browser: Browser;
  private readonly contextOptions: BrowserContextOptions;
  readonly allowedOrigins: readonly string[];
  readonly baseURL: string;

  constructor(browser: Browser, contextOptions: BrowserContextOptions, allowedOrigins: readonly string[], baseURL: string) {
    this.browser = browser;
    this.contextOptions = contextOptions;
    this.allowedOrigins = allowedOrigins;
    this.baseURL = baseURL;
  }

  get origin(): string {
    return new URL(this.baseURL).origin;
  }

  async watch(context: BrowserContext): Promise<ContextMonitor> {
    const m = new ContextMonitor(context, this.allowedOrigins, this.foreignKeys);
    await m.attach();
    this.monitors.push(m);
    return m;
  }

  monitorOf(context: BrowserContext): ContextMonitor {
    const m = this.monitors.find((x) => x.context === context);
    if (!m) throw new Error('この context は harness が見張っていません');
    return m;
  }

  /** プロジェクトと同じ設定（viewport・locale・baseURL など）で context を開き、見張りを付ける */
  async newContext(extra: BrowserContextOptions = {}): Promise<BrowserContext> {
    const ctx = await this.browser.newContext({ ...this.contextOptions, ...extra });
    this.owned.push(ctx);
    await this.watch(ctx);
    return ctx;
  }

  async newPage(extra: BrowserContextOptions = {}): Promise<Page> {
    return (await this.newContext(extra)).newPage();
  }

  /** 見張っている全 context の共通の検査の違反 */
  async violations(): Promise<Violation[]> {
    const all: Violation[] = [];
    for (const m of this.monitors) all.push(...(await m.violations()));
    return all;
  }

  /**
   * 共通の検査（TS-COM-01〜04）。違反があれば CommonCheckError を投げる。
   * expected（偽の緑を防ぐ自己テスト TS-COM-08 だけが使う）: その ID の違反が 1 件も無ければ ExpectedViolationMissingError、
   * それ以外の ID の違反があれば CommonCheckError を投げる（通信と無関係な失敗では通らない。PR #4 のレビュー S-1）
   */
  async assertCommonChecks(expected: readonly CheckId[] = []): Promise<void> {
    const v = await this.violations();
    const missing = expected.filter((id) => !v.some((x) => x.check === id));
    if (missing.length > 0) throw new ExpectedViolationMissingError(missing, v);
    const unexpected = v.filter((x) => !expected.includes(x.check));
    if (unexpected.length > 0) throw new CommonCheckError(unexpected);
  }

  /** 見張りから外して閉じる（偽の緑の自己テストで、わざと違反を起こした context を片付ける） */
  async release(context: BrowserContext): Promise<void> {
    const i = this.monitors.findIndex((m) => m.context === context);
    if (i >= 0) this.monitors.splice(i, 1);
    await context.close();
  }

  get pageErrors(): string[] {
    return this.monitors.flatMap((m) => m.pageErrors);
  }

  get consoleErrors(): string[] {
    return this.monitors.flatMap((m) => m.consoleErrors);
  }

  async dispose(): Promise<void> {
    for (const c of this.owned) await c.close().catch(() => {});
  }
}

interface Fixtures {
  /** 通信の許可リスト（オリジン）。既定は同一オリジンだけ（e2e-web）。S2 の e2e-crazygames で sdk.crazygames.com を足す */
  allowedOrigins: string[];
  /**
   * このテストの終わりの共通の検査で「検出されるはずの違反」（既定は空＝違反 0 件が合格）。
   * 偽の緑を防ぐ自己テスト（TS-COM-08）だけが test.use で指定する。指定した ID が検出されなければ失敗、
   * ほかの ID の違反があっても失敗（test.fail と違い、通信と無関係な理由の失敗では通らない）
   */
  expectViolations: CheckId[];
  harness: Harness;
}

export const test = base.extend<Fixtures>({
  allowedOrigins: [
    async ({ baseURL }, use) => {
      await use([new URL(baseURL ?? 'http://127.0.0.1').origin]);
    },
    { option: true },
  ],
  expectViolations: [[], { option: true }],
  harness: [
    async (
      { browser, context, page, baseURL, viewport, locale, isMobile, hasTouch, deviceScaleFactor, userAgent, timezoneId, allowedOrigins, expectViolations },
      use,
      testInfo,
    ) => {
      if (!baseURL) throw new Error('baseURL がありません（playwright.config.ts）');
      // TS-073-04: テストの開始時にストレージと Cookie が空（テストごとに新しい context）
      const cookies = await context.cookies();
      const keys = await localStorageKeys(context);
      if (cookies.length > 0 || keys.length > 0) {
        throw new Error(`テストの開始時に前の状態が残っています: cookies=${cookies.length} localStorage=${keys.map((k) => k.name).join(',')}`);
      }
      const h = new Harness(
        browser,
        { baseURL, viewport, locale, isMobile, hasTouch, deviceScaleFactor, userAgent, timezoneId, serviceWorkers: 'allow' },
        allowedOrigins,
        baseURL,
      );
      await h.watch(context);
      void page; // 既定のページを検査の後まで開いておく（document.cookie を読むため）
      await use(h);
      const record = (outcome: string): void => {
        teardownChecks.push({ title: testInfo.title, expected: [...expectViolations], outcome });
      };
      try {
        // TS-E1-17・TS-E9-13 ほか: すべての E2E の後の共通の検査（TS-COM-08 の自己テストは期待した違反だけを許す）
        await h.assertCommonChecks(expectViolations);
        record('passed');
      } catch (e) {
        // 記録してから投げ直す（R-S1: TS-COM-08 (d)・(e) が、失敗の理由が共通の検査であることを確かめる）
        record(e instanceof Error ? e.name : String(e));
        throw e;
      } finally {
        await h.dispose();
      }
    },
    { auto: true },
  ],
});

export { expect };
