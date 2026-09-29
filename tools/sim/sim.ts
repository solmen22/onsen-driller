// シミュレーターの本体（Node・テストの両方から使う）。時刻は now を注入する（決定論の lint の対象）
import {
  autoDigUnlocked,
  bathIncomePerSec,
  createInitialState,
  dispatch,
  isHealthy,
  stateHash,
  step,
  type GameEvent,
  type GameState,
} from '../../src/core/index.ts';
import { botAct, newBotMemory, type BotDef } from './bots.ts';
import { MilestoneRecorder, type MilestoneId } from './milestones.ts';

/** 入湯料の割合（#18）を数えるロジックの時刻の範囲（5 分〜60 分。コインが number で表せる範囲に収める） */
const INCOME_SHARE_FROM_MS = 5 * 60_000;
const INCOME_SHARE_TO_MS = 60 * 60_000;

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
  /** 目標表の出来事が初めて起きたロジックの時刻（ms。milestones.ts） */
  milestones: Partial<Record<MilestoneId, number>>;
  /** 5〜60 分に得たコインのうち入湯料の割合（0〜1。#18）。5 分より短い実行は NaN */
  bathShare: number;
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
  let tapAcc = 0;
  let healthy = true;
  const minuteSteps = Math.max(1, Math.round(60_000 / opt.stepMs));
  let earlyUs = 0;
  let lateUs = 0;
  const lateFrom = Math.round(totalMs / opt.stepMs) - minuteSteps;
  const rec = new MilestoneRecorder();
  let bathCoins = 0;
  let allCoins = 0;

  const t0 = now();
  for (let t = 0; t < totalMs; t += opt.stepMs) {
    if (t >= nextAct) {
      botAct(s, bot, mem, events);
      nextAct += actEveryMs;
    }
    rec.observe(events, s.clock.playedMs);
    events.length = 0;
    // #18: 5〜60 分の収入のうち入湯料の分（ステップの始めの入湯料/秒 × 刻み。計測の外で数える）
    const countShare = s.clock.playedMs >= INCOME_SHARE_FROM_MS && s.clock.playedMs < INCOME_SHARE_TO_MS;
    const bathBefore = countShare ? bathIncomePerSec(s).toNumber() : 0;
    const coinsBefore = countShare ? s.stats.totalCoins.toNumber() : 0;
    const a = steps < minuteSteps || steps >= lateFrom ? now() : 0;
    step(s, opt.stepMs, events);
    if (steps < minuteSteps) earlyUs += (now() - a) * 1000;
    else if (steps >= lateFrom) lateUs += (now() - a) * 1000;
    if (countShare) {
      bathCoins += (bathBefore * opt.stepMs) / 1000;
      allCoins += s.stats.totalCoins.toNumber() - coinsBefore;
    }
    // 自動掘りが使えるまでは手で叩く（ステップの終わりの時刻に、等間隔のタップ）
    if (bot.tapsUntilAuto > 0 && !autoDigUnlocked(s)) {
      tapAcc += (bot.tapsUntilAuto * opt.stepMs) / 1000;
      const n = Math.floor(tapAcc + 1e-9);
      tapAcc -= n;
      if (n > 0) for (const e of dispatch(s, { type: 'tap', count: n }).events) events.push(e);
    }
    rec.observe(events, s.clock.playedMs);
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
    milestones: rec.at,
    // 数えていなければ（5 分より短い実行）NaN
    bathShare: allCoins > 0 ? Math.min(1, bathCoins / allCoins) : NaN,
    state: s,
  };
}

/** 相対差（|a-b| / max(|a|,|b|)） */
export function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}
