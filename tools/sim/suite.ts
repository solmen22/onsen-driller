// ボット × シードの一式を流す（BL-031・033）。`npm run sim`・`npm run test:balance`・`npm run test` の短縮版が使う。
// 時刻は now を注入する（計測だけに使い、結果には入らない）
import { advance, cloneState, type GameEvent, type GameState } from '../../src/core/index.ts';
import { BOTS, type BotId } from './bots.ts';
import { runBot, type SimResult } from './sim.ts';

/** 判定に使うシード（docs/balance.md）。中央値で判定する */
export const DEFAULT_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];
/** 一式のボット（BL-031 の 3 本。BL-032 で 6 本を足す） */
export const SUITE_BOTS: readonly BotId[] = ['standard', 'active', 'idle'];

export interface SuiteOptions {
  bots?: readonly BotId[];
  seeds?: readonly number[];
  /** 最初のシードを流す時間（全体の健全性・転生・#12・#13・#23） */
  longHours?: number;
  /** 残りのシードを流す時間（序盤の出来事の時刻・#17・#18 は 1 時間で出そろう） */
  shortHours?: number;
  stepMs?: number;
  now?: () => number;
}

/** 目標表の判定の一式（gdd §8-2: 20 時間を 1 秒刻み。シード固定） */
export function runSuite(o: SuiteOptions = {}): SimResult[] {
  const seeds = o.seeds ?? DEFAULT_SEEDS;
  const out: SimResult[] = [];
  for (const id of o.bots ?? SUITE_BOTS) {
    seeds.forEach((seed, i) => {
      out.push(runBot(BOTS[id], { hours: i === 0 ? (o.longHours ?? 20) : (o.shortHours ?? 1), stepMs: o.stepMs ?? 1000, seed, now: o.now }));
    });
  }
  return out;
}

/**
 * step 1 回の処理時間（#23。決定 0006-3）: 状態の写しで 100ms のステップを n 回ずつ、序盤と終盤を交互に rounds 回測り、
 * それぞれの中央値（µs）を返す。ウォームアップは別の写しで行う
 */
export function benchStep(early: GameState, late: GameState, now: () => number, n = 20_000, rounds = 5): { earlyUs: number; lateUs: number } {
  const ev: GameEvent[] = [];
  const time = (src: GameState, count: number): number => {
    const s = cloneState(src);
    const t = now();
    for (let i = 0; i < count; i++) {
      advance(s, 100, 100, ev);
      ev.length = 0;
    }
    return ((now() - t) * 1000) / count;
  };
  time(early, n * 2);
  time(late, n * 2);
  const e: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < rounds; k++) {
    e.push(time(early, n));
    l.push(time(late, n));
  }
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
  return { earlyUs: med(e), lateUs: med(l) };
}
