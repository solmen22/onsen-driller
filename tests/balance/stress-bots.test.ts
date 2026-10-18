// BL-032 の受け入れ基準 4: 安い順・ランダム（シード固定）のボットを 20 時間流すと、例外が出ず、#22（数値の健全性）を満たし、
// 完全な詰み（買えるものがなく、手動を含む収入も 0 の状態が 10 分以上）がない。1 本 約 1 秒（手元）。
// `npm run test` ではシード 1 だけ。シード 1〜8 は `npm run test:balance`（一式に入れた。#22 と詰みを全シードで見る）
import { describe, expect, it } from 'vitest';
import { BOTS } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';

const STUCK_LIMIT_MS = 10 * 60_000;

describe('BL-032 安い順・ランダムの 20 時間（1 秒刻み）', () => {
  it.each([
    ['cheapest', 1],
    ['random', 1],
  ] as const)('%s・seed %i: 例外なし・健全・詰みなし・転生まで進む', (id, seed) => {
    const r = runBot(BOTS[id], { hours: 20, stepMs: 1000, seed });
    expect(r.healthy).toBe(true);
    expect(r.maxStuckMs).toBeLessThan(STUCK_LIMIT_MS);
    expect(r.prestiges).toBeGreaterThan(0);
  }, 60_000);

  it('ランダムは同じシードで同じ結果（ボットの乱数もシードから決まる）', () => {
    const a = runBot(BOTS.random, { hours: 1, stepMs: 1000, seed: 7 });
    const b = runBot(BOTS.random, { hours: 1, stepMs: 1000, seed: 7 });
    expect(a.hash).toBe(b.hash);
  });

  it('詰みの数え方: 新しいゲームで何もしない（タップなし・買わない）と、収入 0 で買えるものもないので詰みとして数える', () => {
    const r = runBot({ ...BOTS.idle, id: 'idle', manual: { kind: 'taps', perSec: 0 } }, { hours: 0.25, stepMs: 1000, seed: 1 });
    expect(r.maxStuckMs).toBe(15 * 60_000);
  });
});
