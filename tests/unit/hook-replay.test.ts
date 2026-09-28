// BL-097: テスト用フックの advance の期待値（TS-071-07・TS-036-08 の Node 側）
// E2E（e2e/bl036-render.spec.ts）は、ブラウザで描画を動かしたまま seed(42) → pause() → advance(60000, {tapsPerSec: 2}) の stateHash が
// このファイルの expectedHash と一致することを確かめる（描画が core の状態を書き換えない・ブラウザと Node で決定論が同じ）。
// ここでは Node の core だけで同じ手順（createInitialState → フックと同じ端数の持ち越しつきの advance）を動かし、期待値が正しいことを確かめる。
// 数値・規則を意図して変えたときは UPDATE_REPLAYS=1 で期待値を更新し、同じ PR に含める（tests/unit/gamestate.test.ts の TS-010-13 と同じ）
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { advance, createAdvanceCarry, createInitialState, stateHash, type AdvanceInput } from '../../src/core/index.ts';

export interface HookReplayFile {
  name: string;
  /** __game.seed(n) */
  seed: number;
  /** __game.advance(ms, input) を 1 回 */
  advanceMs: number;
  input: AdvanceInput;
  expectedHash: string;
}

const file = resolve(process.cwd(), 'tests/replays/hook-seed42-60s.json');
const r = JSON.parse(readFileSync(file, 'utf8')) as HookReplayFile;

function run(): { hash: string; depth: number; hits: number } {
  const s = createInitialState(r.seed);
  advance(s, r.advanceMs, { input: r.input, carry: createAdvanceCarry() });
  return { hash: stateHash(s), depth: s.run.depth, hits: s.stats.hits };
}

describe('TS-071-07・TS-036-08 の Node 側の期待値（tests/replays/hook-seed42-60s.json）', () => {
  it('同じシードと入力を 2 回動かすと同じ stateHash になり、ファイルの期待値と一致する', () => {
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    if (process.env.UPDATE_REPLAYS === '1') {
      writeFileSync(file, `${JSON.stringify({ ...r, expectedHash: a.hash }, null, 1)}\n`);
      return;
    }
    expect(a.hash, `depth ${a.depth} hits ${a.hits}`).toBe(r.expectedHash);
    // 60 秒・毎秒 2 打で、ツルハシを買わないまま掘り進んでいる（何も起きない入力で一致していないこと）
    expect(a.hits).toBe(120);
    expect(a.depth).toBeGreaterThan(5);
  });
});
