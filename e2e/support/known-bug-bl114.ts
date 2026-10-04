// BL-114（S2。画面の向き・大きさが変わった後、キャンバスが古い大きさのまま固まる）の既知の不具合の印。
// QA の条件（org/30_quality/qa-lead/2026-09-29_bug-canvas-resize-severity.md §2 の 1〜5）:
//   1. 効くのは mobile-safari の、TS-035-03・07 の「キャンバスとステージの大きさの比較」だけ
//   2. 許すのは「古い大きさのまま」の形だけ（変更の前のキャンバス、または window の resize の時点のステージ。数値は注記に残す）
//   3. ほかの確認（ステージが見える・横スクロールなし）・ほかのプロジェクトは今までどおり
//   4. 期限は 2026-10-08（S2 の末）。過ぎたら印は効かず、テストは失敗する
//   5. BL-114 の修正の PR で消す
// 消し方（BL-114 の修正の PR。このファイルが main に先に入っても後に入っても同じ）:
//   このファイルを消し、e2e/bl035-phaser.spec.ts の「BL-114 の印」の 3 か所（import・resizeTo の armStaleSizes・
//   expectFitsAfterResize の knownBl114Shape）を消す。修正が先に main に入っていれば、印は二度と効かない（大きさが合うときは何もしない）
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.ts';

/** 大きさの比較に使う値（e2e/bl035-phaser.spec.ts の fitOf と同じ形） */
type Fit = { canvas: { w: number; h: number }; stage: { w: number; h: number }; scrollWidth: number; innerWidth: number };

const KNOWN_BUG_BL_114 = { type: 'KNOWN_BUG_BL-114', project: 'mobile-safari', until: Date.UTC(2026, 9, 8) } as const;

/**
 * 大きさを変える直前に呼ぶ。変更の前のキャンバスの大きさと、window の resize の時点のステージの大きさ（新しいレイアウトに
 * 切り替わる前）をページに記録する（条件 2 の「古い大きさ」）
 */
export async function armStaleSizes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eStale?: number[][]; __e2eStaleArmed?: boolean };
    const rect = (sel: string): number[] => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return [r.width, r.height];
    };
    w.__e2eStale = [rect('[data-testid="stage"] canvas')];
    if (!w.__e2eStaleArmed) {
      w.__e2eStaleArmed = true;
      addEventListener('resize', () => w.__e2eStale?.push(rect('[data-testid="stage"]')));
    }
  });
}

/**
 * キャンバスがステージに合っていないとき（f）に呼ぶ。mobile-safari で「古い大きさのまま」の形なら、期限を確かめ、数値を注記に
 * 残し、ほかの確認をしたうえで true を返す（呼び出し元は大きさの比較を飛ばす）。それ以外は false（呼び出し元が今までどおり失敗させる）
 */
export async function knownBl114Shape(page: Page, f: Fit, label: string): Promise<boolean> {
  if (test.info().project.name !== KNOWN_BUG_BL_114.project) return false;
  const stale = await page.evaluate(() => (window as unknown as { __e2eStale?: number[][] }).__e2eStale ?? []);
  const match = stale.find(([w = -1, h = -1]) => Math.abs(f.canvas.w - w) <= 1 && Math.abs(f.canvas.h - h) <= 1);
  if (!match) return false;
  expect(Date.now(), `${KNOWN_BUG_BL_114.type} の印の期限（S2 の末）を過ぎた。BL-114 を直して印を消すか、QA リードが扱いを決め直す`).toBeLessThan(KNOWN_BUG_BL_114.until);
  test.info().annotations.push({
    type: KNOWN_BUG_BL_114.type,
    description: `${label}: キャンバス ${f.canvas.w}×${f.canvas.h}・ステージ ${f.stage.w}×${f.stage.h}（古い大きさ ${match.map((x) => Math.round(x)).join('×')} のまま）`,
  });
  expect(f.stage.w, `${label}: ステージが見える`).toBeGreaterThan(0);
  expect(f.stage.h, `${label}: ステージが見える`).toBeGreaterThan(0);
  expect(f.scrollWidth, `${label}: 横スクロールが出ない`).toBeLessThanOrEqual(f.innerWidth);
  return true;
}
