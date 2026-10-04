// e2e-crazygames のビルドを CrazyGames SDK のモックで動かす（BL-072。QA §4-2・§4-3、シナリオ TS-072-03・04、TS-057-19）
//
// - ビルド: dist/e2e-crazygames（npm run build:e2e）。playwright.config.ts の 3 つ目の webServer が CG_BASE_URL で配信する。
//   使う spec は test.use({ baseURL: CG_BASE_URL }) にする（harness の同一オリジンも CG_BASE_URL になる）
// - SDK: index.html の <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"> を page.route でモック（e2e/mocks/crazygames.ts の
//   crazyMockScript）に差し替える。本物の SDK には通信しない
// - 共通の検査: sdk.crazygames.com はオリジンの許可リストに**足さない**。モックが応答を返した URL だけを harness.mockedUrls で許す。
//   差し替えを忘れると SDK の要求は harness の route で中止・記録され、TS-COM-01 で落ちる（黙って本物に通信しない。TS-072-04）
// - モックの記録・設定はページの window.__cgMock（createCrazyMock の戻り値）で読む・変える
import type { BrowserContext, Page } from '@playwright/test';
import { CG_MOCK_GLOBAL, crazyMockScript, type CrazyMockConfig } from '../mocks/crazygames.ts';
import { bootGame, type BootOptions } from './boot.ts';
import type { Harness } from './fixtures.ts';
import type { Hooks } from './hooks.ts';

/** e2e-crazygames のビルドの index.html が読む SDK（tools/build/modes.ts の CRAZYGAMES_SDK と同じ） */
export const CG_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

const HOST = process.env.PW_HOST ?? '127.0.0.1';
/** e2e-crazygames の配信のポート（playwright.config.ts の 3 つ目の webServer。PW_CG_PORT で変えられる） */
export const CG_PORT = Number(process.env.PW_CG_PORT ?? 4176);
export const CG_BASE_URL = `http://${HOST}:${CG_PORT}`;

/** SDK の script の要求をモックに差し替える。応答を返した URL を共通の検査で許す（harness.mockedUrls） */
export async function routeCrazySdk(target: Page | BrowserContext, harness: Harness, config: Partial<CrazyMockConfig> = {}): Promise<void> {
  const body = crazyMockScript(config);
  await target.route(CG_SDK_URL, async (route) => {
    harness.mockedUrls.add(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body });
  });
}

export interface CrazyBootOptions extends BootOptions {
  /** モックの設定（既定: local・init 成功・広告は最後まで再生・ja-JP・data モジュールあり） */
  mock?: Partial<CrazyMockConfig>;
}

/**
 * e2e-crazygames のビルドをモックの SDK で起動する（bootGame と同じ手順の前に SDK を差し替える）。
 * baseURL が e2e-crazygames でない・モックがページに入っていない、ときは理由つきで止める
 */
export async function bootCrazyGames(page: Page, harness: Harness, opts: CrazyBootOptions = {}): Promise<Hooks> {
  if (new URL(harness.baseURL).origin !== new URL(CG_BASE_URL).origin) {
    throw new Error(`e2e-crazygames のビルドの baseURL（${CG_BASE_URL}）で動かしてください: spec で test.use({ baseURL: CG_BASE_URL })。今は ${harness.baseURL}`);
  }
  const { mock, ...boot } = opts;
  await routeCrazySdk(page, harness, mock);
  const g = await bootGame(page, boot);
  const installed = await page.evaluate((k) => typeof (window as unknown as Record<string, unknown>)[k] === 'object', CG_MOCK_GLOBAL);
  if (!installed) throw new Error(`CrazyGames SDK のモック（window.${CG_MOCK_GLOBAL}）がページに入っていません。${CG_SDK_URL} の差し替えが効いていません`);
  return g;
}

type MockView = { log: string[]; calls: string[]; store: Map<string, string>; configure(c: Partial<CrazyMockConfig>): void; setMute(m: boolean): void };

/** ページのモックの記録（log＝init・game・requestAd、calls＝data などを含むすべて）と data モジュールの中身 */
export async function cgMockState(page: Page): Promise<{ log: string[]; calls: string[]; store: Record<string, string> }> {
  return page.evaluate((k) => {
    const m = (window as unknown as Record<string, MockView | undefined>)[k];
    if (!m) throw new Error(`window.${k} がありません`);
    return { log: [...m.log], calls: [...m.calls], store: Object.fromEntries(m.store) };
  }, CG_MOCK_GLOBAL);
}

/** ページのモックの設定を変える（muteAudio はリスナーも呼ぶ） */
export async function configureCgMock(page: Page, c: Partial<CrazyMockConfig>): Promise<void> {
  await page.evaluate(
    ([k, conf]) => {
      const m = (window as unknown as Record<string, MockView | undefined>)[k];
      if (!m) throw new Error(`window.${k} がありません`);
      m.configure(conf);
    },
    [CG_MOCK_GLOBAL, c] as const,
  );
}
