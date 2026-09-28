// シミュレーターの本体（Node・テストの両方から使う）。時刻は now を注入する（決定論の lint の対象）
import {
  createInitialState,
  isHealthy,
  stateHash,
  step,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { botAct, newBotMemory, type BotDef } from './bots.ts';

export interface SimOptions {
  hours: number;
  stepMs: number;
  seed: number;
  /** 計測用の時計（ms）。省略時は計測しない */
  now?: () => number;
}

export interface SimResult {
  bot: string;
  stepMs: number;
  hours: number;
  steps: number;
  wallMs: number;
  hash: string;
  bestDepth: number;
  prestiges: number;
  yunohana: string;
  totalCoins: string;
  coins: string;
  healthy: boolean;
  /** 序盤（最初の 1 分）と終盤（最後の 1 分）の step 1 回の平均時間（µs） */
  stepUsEarly: number;
  stepUsLate: number;
  state: GameState;
}

export function runBot(bot: BotDef, opt: SimOptions): SimResult {
  const now = opt.now ?? ((): number => 0);
  const s = createInitialState(opt.seed);
  const mem = newBotMemory();
  const totalMs = opt.hours * 3_600_000;
  const actEveryMs = bot.buyEverySec * 1000;
  const events: GameEvent[] = [];
  let nextAct = 0;
  let steps = 0;
  let healthy = true;
  const minuteSteps = Math.max(1, Math.round(60_000 / opt.stepMs));
  let earlyUs = 0;
  let lateUs = 0;
  const lateFrom = Math.round(totalMs / opt.stepMs) - minuteSteps;

  const t0 = now();
  for (let t = 0; t < totalMs; t += opt.stepMs) {
    if (t >= nextAct) {
      botAct(s, bot, mem);
      nextAct += actEveryMs;
    }
    const a = steps < minuteSteps || steps >= lateFrom ? now() : 0;
    step(s, opt.stepMs, events);
    if (steps < minuteSteps) earlyUs += (now() - a) * 1000;
    else if (steps >= lateFrom) lateUs += (now() - a) * 1000;
    events.length = 0;
    steps++;
    if ((steps & 1023) === 0 && !(isHealthy(s.run.coins) && isHealthy(s.stats.totalCoins))) healthy = false;
  }
  const wallMs = now() - t0;
  healthy = healthy && isHealthy(s.run.coins) && isHealthy(s.stats.totalCoins);
  return {
    bot: bot.id,
    stepMs: opt.stepMs,
    hours: opt.hours,
    steps,
    wallMs,
    hash: stateHash(s),
    bestDepth: s.stats.bestDepth,
    prestiges: s.meta.prestiges,
    yunohana: s.meta.yunohana.lifetime.toString(),
    totalCoins: s.stats.totalCoins.toString(),
    coins: s.run.coins.toString(),
    healthy,
    stepUsEarly: earlyUs / minuteSteps,
    stepUsLate: lateUs / minuteSteps,
    state: s,
  };
}

/** 相対差（|a-b| / max(|a|,|b|)） */
export function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}
