// BL-032 の受け入れ基準 4: 安い順・ランダム（シード固定）のボットを 20 時間流すと、例外が出ず、#22（数値の健全性）を満たし、
// 完全な詰み（買えるものがなく、累計コインが増えない状態が 10 分以上。Q-40 (e)）がない。1 本 約 1 秒（手元）。
// `npm run test` ではシード 1 だけ。シード 1〜8 は `npm run test:balance`（一式に入れた。#22 と詰みを全シードで見る）
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src/core/index.ts';
import { TOOLS } from '../../src/content/tools.ts';
import { BOTS, canBuyAnything } from '../../tools/sim/bots.ts';
import { runBot } from '../../tools/sim/sim.ts';

const STUCK_LIMIT_MS = 10 * 60_000;

/**
 * ランダムボット・シード 1・1 時間・1 秒刻みの最終状態のハッシュ（PR #52 のレビューの S-2）。
 * runBot がシードをボットの乱数（newBotMemory(seed)）に渡していることを見張る（渡さないと 8 シードの選び方が同じ列になる）。
 * ボット・core・content を意図して変えて結果が変わったときは、この値を更新し、理由を PR の説明に書く
 */
const RANDOM_1H_SEED1_HASH = 'a7b9b847';

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

  it('ランダム・シード 1・1 時間: ハッシュが固定値と一致（ボットの乱数がシードから決まることの見張り）', () => {
    expect(runBot(BOTS.random, { hours: 1, stepMs: 1000, seed: 1 }).hash).toBe(RANDOM_1H_SEED1_HASH);
  });

  it('詰みの数え方: 新しいゲームで何もしない（タップなし・買わない）と、コインが増えず買えるものもないので詰みとして数える', () => {
    const r = runBot({ ...BOTS.idle, id: 'idle', manual: { kind: 'taps', perSec: 0 } }, { hours: 0.25, stepMs: 1000, seed: 1 });
    expect(r.maxStuckMs).toBe(15 * 60_000);
  });

  it('詰みの数え方（Q-40 (e) ②）: 打ってはいるが岩の HP が大きすぎて 1 つも割れない（コインが増えない）状態も詰みとして数える', () => {
    // 深さ 140m（転生の解放 150m の手前）で威力 1・毎秒 1 タップ: HP 約 3 万で 15 分では割れない。収入の見積もりは正だが、コインは増えない
    const wall = (s: GameState): void => {
      s.run.depth = 140;
      s.run.maxDepth = 140;
      s.stats.bestDepth = 140;
      s.run.stratumSeen = [0, 1, 2, 3];
    };
    const r = runBot({ ...BOTS.idle, id: 'idle', manual: { kind: 'taps', perSec: 1 } }, { hours: 0.25, stepMs: 1000, seed: 1, setup: wall });
    expect(r.state.stats.hits).toBeGreaterThan(0);
    expect(r.totalCoins).toBe('0');
    expect(r.maxStuckMs).toBe(15 * 60_000);
  });

  it('詰みの数え方（Q-40 (e) ② の後半。PR #61 のレビューの Should 1）: 買えるものはないが、コインが入り続けるなら数え直す（詰みではない）', () => {
    // 道具は最後の段、ドリル Lv300・自動掘削機 Lv200・湯船 Lv200・源泉 5 種のポンプ Lv300（4 つを枠に）: どれも次のコストが 15 分の収入より大きい。
    // ボットは最初（0 秒）にしか判断しない（買わない・転生しない）。タップなし。入湯料と掘削で累計コインは毎秒増える
    const rich = (s: GameState): void => {
      s.run.drill.tool = TOOLS.length - 1;
      s.run.drill.level = 300;
      s.run.autoDig.level = 200;
      s.run.bath.level = 200;
      for (const id of ['simple', 'co2', 'salt', 'sulfur', 'iron'] as const) s.run.springs[id] = { pump: 300 };
      s.run.bath.slots = ['simple', 'co2', 'salt', 'sulfur'];
    };
    const bot = { ...BOTS.idle, buyEverySec: 1e7, manual: { kind: 'taps' as const, perSec: 0 } };
    const notStuck: number[] = [];
    const r = runBot(bot, {
      hours: 0.25,
      stepMs: 1000,
      seed: 1,
      setup: (s) => {
        rich(s);
        notStuck.push(Number(canBuyAnything(s)));
      },
    });
    // 前提: 終わりの時点でも何も買えない（途中も買えないことは、数え直しを外すと 15 分の詰みになることで確かめた）。累計コインは増えた
    expect(notStuck).toEqual([0]);
    expect(canBuyAnything(r.state)).toBe(false);
    expect([r.state.run.drill.level, r.state.run.autoDig.level, r.state.run.bath.level, r.prestiges]).toEqual([300, 200, 200, 0]);
    expect(Number(r.totalCoins)).toBeGreaterThan(0);
    // 数え直すので、区間は毎ステップ始めからやり直す（1 ステップ分）。数え直さなければ 15 分になる
    expect(r.maxStuckMs).toBeLessThan(STUCK_LIMIT_MS);
    expect(r.maxStuckMs).toBeLessThanOrEqual(1_000);
  });
});
