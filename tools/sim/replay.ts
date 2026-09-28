// リプレイ（arch §8-5。BL-010）: シードと入力ログ（{atMs, action} の列）から最終状態を再現する。
// 時刻はロジックの時間（playedMs）。atMs の時刻になったステップの直前にアクションを実行する
import { createInitialState, dispatch, stateHash, step, type GameEvent, type GameState } from '../../src/core/index.ts';

export interface ReplayEntry {
  atMs: number;
  action: unknown;
}

export interface ReplayFile {
  name: string;
  seed: number;
  stepMs: number;
  durationMs: number;
  log: ReplayEntry[];
  /** 期待する stateHash（数値を意図して変えたら、同じ PR で更新する。QA §3-2(a)） */
  expectedHash: string;
}

export interface ReplayResult {
  state: GameState;
  hash: string;
  events: number;
}

export function runReplay(r: Pick<ReplayFile, 'seed' | 'stepMs' | 'durationMs' | 'log'>): ReplayResult {
  const s = createInitialState(r.seed);
  const log = [...r.log].sort((a, b) => a.atMs - b.atMs);
  const out: GameEvent[] = [];
  let i = 0;
  let events = 0;
  while (s.clock.playedMs < r.durationMs) {
    while (i < log.length && (log[i]?.atMs ?? Infinity) <= s.clock.playedMs) {
      const res = dispatch(s, log[i]?.action);
      events += res.events.length;
      i++;
    }
    step(s, r.stepMs, out);
    events += out.length;
    out.length = 0;
  }
  return { state: s, hash: stateHash(s), events };
}
