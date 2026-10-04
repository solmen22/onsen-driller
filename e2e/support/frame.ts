// ポータルの枠（iframe）を模した親ページ（BL-097。TS-012-18 の縦に長い親ページ、TS-042-02 の枠の大きさの変更）
//
// 同じオリジンの /__e2e_parent（page.route で返す）に、ゲーム（/）を iframe で置く。
// 別オリジンの版（BL-101・TS-012-26・27）は、親ページだけをホスト名の違うオリジン（127.0.0.1 ⇔ localhost。ポートは同じ）で
// 出す（crossOrigin。crossOriginParent で作る）。実際のポータル（CrazyGames・Poki・itch.io）は枠が別オリジンで、Chromium は
// 別サイトの枠を別のプロセス（OOPIF）で扱うため、フォーカスの移り方が同じとは限らない。この版の親ページは page.route ではなく
// e2e のサーバー（serve.mjs）が返す（理由は portal-page.ts の Local Network Access の注）。
// harness の見張り（context.addInitScript・context.route）は iframe の中にも付く（Playwright の init script は全フレームで動く）。
// 時計は固定しない（レイアウトの切り替えは ResizeObserver、キーの処理はイベントで動き、Clock API の止めた時計を要らない）。
// 親ページの HTML（viewport の meta を含む）は portal-page.ts。
import type { Frame, Page } from '@playwright/test';
import { BOOT_TIMEOUT_MS, collectPageErrors, waitForGame } from './boot.ts';
import { hooks, type Hooks } from './hooks.ts';
import { PARENT_PATH, parentHtml, parentQuery, type ParentPage } from './portal-page.ts';

export { PARENT_PATH };

/** 別オリジンの親ページ（crossOriginParent の戻り値） */
export interface CrossOriginParent {
  /** 親ページのオリジン（harness の許可リストに足す） */
  parentOrigin: string;
  /** 枠に入れるゲームの URL（baseURL のオリジンの '/'） */
  gameSrc: string;
}

export interface FrameOptions {
  /** 枠（iframe）の大きさ（CSS ピクセル） */
  width: number;
  height: number;
  /** 親ページの本文の高さ（縦に長いポータルのページ。既定は枠の高さ＋左上の余白） */
  parentHeight?: number;
  /** 枠の左上（親ページの座標） */
  left?: number;
  top?: number;
  /** 別オリジンの版（BL-101）: 親ページを parentOrigin の e2e のサーバーから読み、枠に gameSrc を入れる */
  crossOrigin?: CrossOriginParent;
}

/**
 * 別オリジンの親ページ（BL-101・TS-012-26・27）: ゲーム（baseURL）と同じポートで、ホスト名だけを変えたオリジン
 * （127.0.0.1 → localhost。baseURL が localhost なら 127.0.0.1）。localhost と 127.0.0.1 は別のサイトなので、
 * Chromium では枠が別のプロセス（OOPIF）になる。親のオリジンは harness の許可リストに足す必要がある（allowedOrigins）
 */
export function crossOriginParent(baseURL: string): CrossOriginParent {
  const game = new URL(baseURL);
  const parent = new URL(game.origin);
  parent.hostname = game.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return { parentOrigin: parent.origin, gameSrc: `${game.origin}/` };
}

export interface GameFrame {
  frame: Frame;
  g: Hooks;
  /** 枠の大きさを変える（親ページの iframe の style。ゲームの再読み込みはしない） */
  resize: (width: number, height: number) => Promise<void>;
}

/** 親ページを開き、iframe の中のゲームが 0 クリックでゲーム画面になり __game が出るまで待つ */
export async function openGameInFrame(page: Page, opts: FrameOptions): Promise<GameFrame> {
  const o: ParentPage = {
    left: opts.left ?? 0,
    top: opts.top ?? 0,
    parentHeight: opts.parentHeight ?? (opts.top ?? 0) + opts.height,
    width: opts.width,
    height: opts.height,
    gameSrc: opts.crossOrigin?.gameSrc ?? '/',
  };
  if (!opts.crossOrigin) {
    await page.route(`**${PARENT_PATH}`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: parentHtml(o) }));
  }
  const pe = collectPageErrors(page);
  try {
    await page.goto(opts.crossOrigin ? `${opts.crossOrigin.parentOrigin}${PARENT_PATH}?${parentQuery(o)}` : PARENT_PATH);
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
