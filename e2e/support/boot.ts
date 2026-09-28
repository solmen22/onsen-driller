// 起動の共通の補助（BL-073 / TS-073-05・06、e2e_E1_first-play.md「準備」）
//
// bootGame(page, { seed, time, viewport, storage }) が 1 か所で行うこと
//   1. 見張り（harness の自動 fixture。通信・WebSocket・エラー・全画面の要求）が付いていることの確認
//   2. 時計の固定 page.clock.install({ time: T0 })（Playwright の Clock API）
//   3. （storage があれば）同じオリジンの空のページで localStorage を入れる
//   4. page.goto('/') → どこもクリックせずに、キャンバスと HUD が見えるまで待つ（上限 10 秒）
//   5. window.__game があることの確認（無ければ「e2e ビルドで実行してください」ですぐ失敗: TS-073-06）
//   6. 時計を止める（pauseAt）。以後の時間は page.clock.runFor（実時間のタイマー・描画）と __game.advance（ロジック）で進める
//   7. （seed があれば）__game.seed(seed)
//
// Clock API の使い方（本作の決まり）
//   - 起動の間は時計を流し（Phaser・Preact の初期化に rAF・タイマーが要る）、起動が済んだら止める。
//   - ロジックだけを進める: __game.pause() → __game.advance(ms, input)。実時間を待たない。
//   - UI の更新・長押しの判定など実時間のタイマーを進める: page.clock.runFor(ms)。
//     __game.pause() 中はループが止まっているので、runFor はロジックを進めない。
//   - 15 秒ごとの自動保存を起こす: triggerAutosave(page)（fastForward）。runFor(15000) は実時間でも約 10 秒かかるため。
//   - 再読み込みの後も時計は止まったまま（Playwright が時計の操作を新しい文書で再生する）。
import type { Frame, Page } from '@playwright/test';
import { hooks, type Hooks, type HookTarget } from './hooks.ts';

/** E2E の基準時刻（2026-10-01T00:00:00Z） */
export const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

export const BOOT_TIMEOUT_MS = 10_000;
const HOOK_TIMEOUT_MS = 5_000;

export interface BootOptions {
  /** __game.seed(n) で新しいゲームを始める */
  seed?: number;
  /** 時計の初期値（既定 T0） */
  time?: number;
  viewport?: { width: number; height: number };
  /** 起動の前に入れる localStorage（キー → 値） */
  storage?: Record<string, string>;
  /** 起動の後に時計を止めるか（既定 true） */
  pauseClock?: boolean;
  /**
   * 時計を止めたまま起動する（Date.now() が起動の間ずっと time のまま。ロジックは 1 ステップも進まない）。
   * 保存から読み込んだ状態をそのまま比べるとき（E5 の壊れた枠の試験など）に使う
   */
  startPaused?: boolean;
  /** page.clock.install を省く（同じ context で 2 回目の起動をするとき） */
  skipClockInstall?: boolean;
}

export class HooksMissingError extends Error {
  constructor() {
    super(
      'window.__game（テスト用フック）がありません。e2e ビルド（VITE_TEST_HOOKS=true の `npm run build:e2e` の出力）に向けて実行してください。本番のビルド（dist/web など）では E2E は動きません（TS-073-06）',
    );
    this.name = 'HooksMissingError';
  }
}

/** 見張り（harness）が付いた context のページか。付いていなければ共通の検査が働かないので止める */
async function assertMonitored(page: Page): Promise<void> {
  const ok = await page.evaluate(() => typeof (window as unknown as { __fsCalls?: number }).__fsCalls === 'number');
  if (!ok) throw new Error('見張りの付いていない context です。e2e/support/fixtures.ts の test と harness.newContext() を使ってください');
}

/** 同じオリジンの空のページで localStorage を入れる（ゲームを一度も起動しないので、保存で上書きされない） */
export async function seedLocalStorage(page: Page, entries: Record<string, string>): Promise<void> {
  const blank = '**/__e2e_blank';
  await page.route(blank, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>e2e</title>' }));
  await page.goto('/__e2e_blank');
  await page.evaluate((e) => {
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, entries);
  await page.unroute(blank);
}

/** ページの例外を集め始める（起動の失敗の理由をエラーの文に入れるため）。戻り値の関数で止める */
export function collectPageErrors(page: Page): { errors: string[]; stop: () => void } {
  const errors: string[] = [];
  const on = (e: Error): void => {
    errors.push(`${e.name}: ${e.message}`);
  };
  page.on('pageerror', on);
  return { errors, stop: () => page.off('pageerror', on) };
}

/** どこもクリックせずに、ゲーム画面（キャンバスと HUD）と __game が出るまで待つ（page はポータルの枠を模した iframe の Frame でもよい） */
export async function waitForGame(target: HookTarget, timeoutMs = BOOT_TIMEOUT_MS, pageErrors: readonly string[] = []): Promise<void> {
  const page = target as Frame;
  try {
    await page.locator('[data-testid="stage"] canvas').waitFor({ state: 'visible', timeout: timeoutMs });
    await page.getByTestId('hud-coins').waitFor({ state: 'visible', timeout: timeoutMs });
  } catch (e) {
    const why = pageErrors.length > 0 ? `ページの例外: ${pageErrors.join(' / ')}` : 'ページの例外なし';
    throw new Error(`${timeoutMs}ms 以内にゲーム画面（キャンバスと HUD）が出ませんでした（${why}）`, { cause: e });
  }
  const has = await page
    .waitForFunction(() => typeof (window as unknown as { __game?: unknown }).__game === 'object', null, { timeout: HOOK_TIMEOUT_MS, polling: 50 })
    .then(
      () => true,
      () => false,
    );
  if (!has) throw new HooksMissingError();
}

/** 時計を「今」の少し先で止める（pauseAt は過去を指定できないので、余裕を持たせて再試行する） */
export async function pauseClock(page: Page): Promise<number> {
  let last: unknown;
  for (const margin of [100, 1_000, 5_000]) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(now + margin);
      return now + margin;
    } catch (e) {
      last = e;
      if (!/past/i.test(String(e))) throw e;
    }
  }
  throw last;
}

export async function bootGame(page: Page, opts: BootOptions = {}): Promise<Hooks> {
  if (opts.viewport) await page.setViewportSize(opts.viewport);
  const time = opts.time ?? T0;
  if (!opts.skipClockInstall) {
    if (opts.startPaused) {
      // pauseAt は「今」より前を指定できないので、1 秒前で入れてから time で止める。
      // 次の文書（goto の先）では Playwright が操作を再生し、時計は time ちょうどで止まっている
      await page.clock.install({ time: time - 1_000 });
      await page.clock.pauseAt(time);
    } else {
      await page.clock.install({ time });
    }
  }
  if (opts.storage) await seedLocalStorage(page, opts.storage);
  const pe = collectPageErrors(page);
  try {
    await page.goto('/');
    await assertMonitored(page);
    await waitForGame(page, BOOT_TIMEOUT_MS, pe.errors);
  } finally {
    pe.stop();
  }
  const g = hooks(page);
  if (opts.pauseClock !== false && !opts.startPaused) await pauseClock(page);
  if (opts.seed !== undefined) await g.seed(opts.seed);
  return g;
}

/**
 * 地下を叩く位置。rect('drill') が無いビルドでも使えるよう、ステージの横の中央・縦 3/4（地下）を返す。
 * 位置そのものを確かめるテスト（TS-E1-01・04・10 など）は rect('drill') を使う
 */
export async function undergroundPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('stage').boundingBox();
  if (!box) throw new Error('stage が見えません');
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.75 };
}

/**
 * 画面の操作だけで n 回叩く（連打の上限 8 回/秒を超えないよう、1 回ごとに時計を 150ms 進める）。
 * 時計は fastForward で進める（期限の来たタイマー・描画のフレームを 1 回ずつ呼ぶ）。ループは 1 フレームで経過の 150ms を
 * ロジックに入れるので、ロジックの時間の進み方は runFor(150) と同じ。runFor は途中の約 9 フレームをすべて描画し、
 * GPU のない CI（2 vCPU・ソフトウェアの WebGL）では 1 フレームに 0.1 秒前後かかって、叩く回数の多いテストが
 * 60 秒の上限に届いた（2026-09-29 の PR #4 の CI）
 */
export async function tapUnderground(page: Page, n: number): Promise<void> {
  const p = await undergroundPoint(page);
  for (let i = 0; i < n; i++) {
    await page.mouse.click(p.x, p.y);
    await page.clock.fastForward(150);
  }
}

/** 再読み込み（pagehide の保存が起きる）→ ゲーム画面を待つ */
export async function reloadGame(page: Page): Promise<Hooks> {
  const pe = collectPageErrors(page);
  try {
    await page.reload();
    await waitForGame(page, BOOT_TIMEOUT_MS, pe.errors);
  } finally {
    pe.stop();
  }
  return hooks(page);
}

/** 退出時の保存の契機を数える sessionStorage のキー（同じタブの再読み込みでも残る。読んだら消す） */
const UNLOAD_PROBE_KEY = 'onsen-driller:e2e:unload-triggers';

/**
 * 今の文書が閉じるときの保存の契機（pagehide と、hidden への visibilitychange）の回数を数え始める。
 * arch §11・Q-11 の 6: この 2 つはそれぞれ保存を 1 回起こし、続けて来れば 2 回書く（seq は 2 増える）。
 * Chromium の page.reload() では pagehide → visibilitychange(hidden) の順に両方来る（2026-09-28 の実測）ので、
 * 再読み込みでの seq の増え方は、実際に来た契機の数で判定する。readUnloadTriggers で読む
 */
export async function armUnloadTriggerProbe(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const bump = (k: 'pagehide' | 'hidden'): void => {
      const c = JSON.parse(sessionStorage.getItem(key) ?? '{"pagehide":0,"hidden":0}') as Record<string, number>;
      c[k] = (c[k] ?? 0) + 1;
      sessionStorage.setItem(key, JSON.stringify(c));
    };
    sessionStorage.removeItem(key);
    addEventListener('pagehide', () => bump('pagehide'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') bump('hidden');
    });
  }, UNLOAD_PROBE_KEY);
}

/** armUnloadTriggerProbe で数えた回数を読み、キーを消す（再読み込みの後に呼ぶ） */
export async function readUnloadTriggers(page: Page): Promise<{ pagehide: number; hidden: number }> {
  return page.evaluate((key) => {
    const c = JSON.parse(sessionStorage.getItem(key) ?? '{"pagehide":0,"hidden":0}') as { pagehide: number; hidden: number };
    sessionStorage.removeItem(key);
    return c;
  }, UNLOAD_PROBE_KEY);
}

/**
 * タブの表示・非表示を模す（document.visibilityState・hidden を差し替えて visibilitychange を送る）。
 * 表示に戻すときは差し替えを消して、ブラウザ本来の値に戻す（差し替えたままだと、後の再読み込みで来る本物の
 * visibilitychange でも 'visible' と読めてしまい、退出時の保存の契機が実際と変わる。2026-09-28 の実測）
 */
export async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    if (h) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    } else {
      delete (document as unknown as Record<string, unknown>)['visibilityState'];
      delete (document as unknown as Record<string, unknown>)['hidden'];
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** 自動保存の間隔（arch §11「15 秒ごと」） */
export const AUTOSAVE_MS = 15_000;

/**
 * 15 秒ごとの自動保存を 1 回起こす。page.clock.fastForward で時計を 15 秒飛ばし、期限の来たタイマーを 1 回ずつ呼ぶ。
 * runFor(15000) と違い途中の描画のフレームを 1 つずつ回さないので速い（Playwright の時計は 1 回の呼び出しごとに
 * 実時間の setTimeout(0) を挟むため、runFor は実時間とほぼ同じだけかかる）。ロジックは __game.pause() で止めておくこと。
 * ループが動いていると、飛ばした分のうち最大 1 秒ぶん（1 フレームの追いつきの上限）だけロジックが進む
 */
export async function triggerAutosave(page: Page): Promise<void> {
  await page.clock.fastForward(AUTOSAVE_MS);
  await page.clock.runFor(100); // 保存の後の UI の更新（Preact の effect は rAF で動く）
}

/** ページの中の Date.now()（Clock API の時刻） */
export const pageNow = (page: Page): Promise<number> => page.evaluate(() => Date.now());

/** 要素の中心 */
export const centerOf = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
