import type { Page } from '@playwright/test';

export interface PerfStats {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
  latency: { n: number; p50: number; p95: number; max: number };
}

/** window.__game（e2e ビルドのテスト用フック）を型付きで呼ぶ */
export const hook = <T>(page: Page, expr: string): Promise<T> => page.evaluate<T>(`((g) => (${expr}))(window.__game)`);

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById('app')?.dataset.ready === 'true' && '__game' in window, null, {
    timeout: 60_000,
  });
}
