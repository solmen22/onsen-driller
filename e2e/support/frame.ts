// ポータルの枠（iframe）を模した親ページ（BL-097。TS-012-18 の縦に長い親ページ、TS-042-02 の枠の大きさの変更）
//
// 同じオリジンの /__e2e_parent（page.route で返す）に、ゲーム（/）を iframe で置く。
// harness の見張り（context.addInitScript・context.route）は iframe の中にも付く（Playwright の init script は全フレームで動く）。
// 時計は固定しない（レイアウトの切り替えは ResizeObserver、キーの処理はイベントで動き、Clock API の止めた時計を要らない）。
import type { Frame, Page } from '@playwright/test';
import { BOOT_TIMEOUT_MS, collectPageErrors, waitForGame } from './boot.ts';
import { hooks, type Hooks } from './hooks.ts';

export const PARENT_PATH = '/__e2e_parent';

export interface FrameOptions {
  /** 枠（iframe）の大きさ（CSS ピクセル） */
  width: number;
  height: number;
  /** 親ページの本文の高さ（縦に長いポータルのページ。既定は枠の高さ＋左上の余白） */
  parentHeight?: number;
  /** 枠の左上（親ページの座標） */
  left?: number;
  top?: number;
}

export interface GameFrame {
  frame: Frame;
  g: Hooks;
  /** 枠の大きさを変える（親ページの iframe の style。ゲームの再読み込みはしない） */
  resize: (width: number, height: number) => Promise<void>;
}

function parentHtml(o: Required<FrameOptions>): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>e2e portal</title>
<style>
  html, body { margin: 0; }
  body { height: ${o.parentHeight}px; position: relative; background: #ccc; font: 14px sans-serif; }
  #game { position: absolute; left: ${o.left}px; top: ${o.top}px; width: ${o.width}px; height: ${o.height}px; border: 0; display: block; }
</style></head>
<body><p id="above">portal page</p><iframe id="game" src="/" title="game"></iframe></body></html>`;
}

/** 親ページを開き、iframe の中のゲームが 0 クリックでゲーム画面になり __game が出るまで待つ */
export async function openGameInFrame(page: Page, opts: FrameOptions): Promise<GameFrame> {
  const o: Required<FrameOptions> = {
    left: 0,
    top: 0,
    parentHeight: (opts.top ?? 0) + opts.height,
    ...opts,
  };
  await page.route(`**${PARENT_PATH}`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: parentHtml(o) }));
  const pe = collectPageErrors(page);
  try {
    await page.goto(PARENT_PATH);
    const handle = await page.locator('#game').elementHandle({ timeout: BOOT_TIMEOUT_MS });
    const frame = await handle?.contentFrame();
    if (!frame) throw new Error('iframe のフレームが取れません');
    await waitForGame(frame, BOOT_TIMEOUT_MS, pe.errors);
    return {
      frame,
      g: hooks(frame),
      resize: async (width, height) => {
        await page.evaluate(
          ([w, h]) => {
            const el = document.getElementById('game');
            if (!el) throw new Error('#game がない');
            el.style.width = `${w}px`;
            el.style.height = `${h}px`;
          },
          [width, height] as const,
        );
      },
    };
  } finally {
    pe.stop();
  }
}
