// シミュレーターの本体（BL-031。Node・テストの両方から使う）。core と content だけを読み、DOM・Phaser に依存しない。
// 時刻は now を注入する（決定論の lint の対象。計測にだけ使い、結果には入らない）
import {
  bathIncomePerSec,
  createInitialState,
  incomePerSec,
  isHealthy,
  stateHash,
  step,
  type GameEvent,
  type GameState,
  type Num,
} from '../../src/core/index.ts';
import { botAct, botTap, canBuyAnything, newBotMemory, type BotDef } from './bots.ts';
import { MilestoneRecorder, type MilestoneId } from './milestones.ts';

/** 入湯料の割合（#18）を数えるロジックの時刻の範囲（5 分〜60 分。コインが number で表せる範囲に収める） */
const INCOME_SHARE_FROM_MS = 5 * 60_000;
const INCOME_SHARE_TO_MS = 60 * 60_000;
/** 空白時間（#14・#15）を数える範囲（0〜10 分・10〜30 分） */
const GAP_WINDOWS: readonly (readonly [number, number])[] = [
  [0, 10 * 60_000],
  [10 * 60_000, 30 * 60_000],
];
/** 放置ボットの到達深さを見る時刻（#17。60 分） */
const DEPTH_AT_MS = 60 * 60_000;
/** グラフ・CSV の点の間隔（ロジックの時間） */
const SAMPLE_EVERY_MS = 60_000;

export interface SimOptions {
  hours: number;
  stepMs: number;
  seed: number;
  /** 計測用の時計（ms）。省略時は計測しない */
  now?: () => number;
  /** 始めの状態を変える（テスト専用。新しいゲームの状態を作った直後に 1 回だけ呼ぶ。`test:balance`・`npm run sim` のレポートを作る実行では使わない〔目標表の値が黙って変わるため〕） */
  setup?: (s: GameState) => void;
}

/** グラフ・CSV の点（ロジックの時間ごと） */
export interface Sample {
  tMs: number;
  coins: number;
  incomePerSec: number;
  depth: number;
  maxDepth: number;
}

export interface SimResult {
  bot: string;
  seed: number;
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
  /** 最初の 20 分の「新しい要素」の間隔の最大（ms。#9。0 分と 20 分の端も含める） */
  newElementGapMs: number;
  /** 何も買えない最長の時間（ms。#14＝0〜10 分、#15＝10〜30 分）。範囲の途中で終わった実行は数えた分だけ */
  buyGapMs: [number, number];
  /**
   * 完全な詰み（買えるものがなく、累計コイン `stats.totalCoins` が増えない）が続いた最長の時間（ms。BL-032 の受け入れ基準 4:
   * 10 分以上がないこと。Q-40 (e) ②。収入の見積もりではなく、実際に増えたかで見る）。判断の時刻だけでなく毎ステップの始めの状態で見る
   */
  maxStuckMs: number;
  /** 2 周目で 1 周目の最深に届くまでの時間 ÷ 1 周目の長さ（#11）。届いていなければ null */
  secondRunRatio: number | null;
  /** 60 分の時点の最深（#17）。60 分より短い実行は null */
  depthAt60: number | null;
  /** 5〜60 分に得たコインのうち入湯料の割合（0〜1。#18）。5 分より短い実行は NaN */
  bathShare: number;
  samples: Sample[];
  state: GameState;
}

export function runBot(bot: BotDef, opt: SimOptions): SimResult {
  const now = opt.now ?? ((): number => 0);
  const s = createInitialState(opt.seed);
  opt.setup?.(s);
  const mem = newBotMemory(opt.seed);
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
  const rec = new MilestoneRecorder();
  let bathCoins = 0;
  let allCoins = 0;
  const buyGap: [number, number] = [0, 0];
  const gapStart: [number | null, number | null] = [null, null];
  let depthAt60: number | null = null;
  let stuckFrom: number | null = null;
  /** 詰みの区間の始め（または最後に増えた時点）の累計コイン */
  let stuckCoins: Num | null = null;
  let maxStuckMs = 0;
  const samples: Sample[] = [];
  let nextSample = 0;
  // #11: 1 周目の最深と長さ（最初の転生の時点）。2 周目でその最深に届いたら、かかった時間 ÷ 1 周目の長さ
  const run1: { value: { maxDepth: number; endMs: number } | null } = { value: null };
  let secondRunRatio: number | null = null;

  const observe = (): void => {
    for (const e of events) {
      if (e.type === 'PrestigeDone' && run1.value === null) run1.value = { maxDepth: rec.runMaxDepth, endMs: s.clock.playedMs };
    }
    rec.observe(events, s.clock.playedMs);
    rec.observeState(s);
    events.length = 0;
  };

  const t0 = now();
  for (let t = 0; t < totalMs; t += opt.stepMs) {
    if (t >= nextAct) {
      botAct(s, bot, mem, events);
      nextAct += actEveryMs;
    }
    observe();
    const played = s.clock.playedMs;
    // #18: 5〜60 分の収入のうち入湯料の分（ステップの始めの入湯料/秒 × 刻み。計測の外で数える）
    const countShare = played >= INCOME_SHARE_FROM_MS && played < INCOME_SHARE_TO_MS;
    const bathBefore = countShare ? bathIncomePerSec(s).toNumber() : 0;
    const coinsBefore = countShare ? s.stats.totalCoins.toNumber() : 0;
    // #14・#15: 何も買えない時間（ステップの始めの状態で判定）
    for (let w = 0; w < GAP_WINDOWS.length; w++) {
      const [from, to] = GAP_WINDOWS[w] ?? [0, 0];
      if (played < from || played >= to) continue;
      if (canBuyAnything(s)) gapStart[w] = null;
      else {
        gapStart[w] ??= played;
        buyGap[w] = Math.max(buyGap[w] ?? 0, played + opt.stepMs - (gapStart[w] ?? played));
      }
    }
    // 詰み（BL-032・Q-40 (e)）: 買えるものがなく、累計コインが区間の始めから増えていない。増えたらそこから数え直す
    if (canBuyAnything(s)) {
      stuckFrom = null;
      stuckCoins = null;
    } else {
      if (stuckFrom === null || stuckCoins === null || s.stats.totalCoins.gt(stuckCoins)) {
        stuckFrom = played;
        stuckCoins = s.stats.totalCoins;
      }
      maxStuckMs = Math.max(maxStuckMs, played + opt.stepMs - stuckFrom);
    }
    if (played >= nextSample) {
      samples.push({ tMs: played, coins: s.run.coins.toNumber(), incomePerSec: incomePerSec(s).toNumber(), depth: s.run.depth, maxDepth: s.run.maxDepth });
      nextSample += SAMPLE_EVERY_MS;
    }
    const a = steps < minuteSteps || steps >= lateFrom ? now() : 0;
    step(s, opt.stepMs, events);
    if (steps < minuteSteps) earlyUs += (now() - a) * 1000;
    else if (steps >= lateFrom) lateUs += (now() - a) * 1000;
    if (countShare) {
      bathCoins += (bathBefore * opt.stepMs) / 1000;
      allCoins += s.stats.totalCoins.toNumber() - coinsBefore;
    }
    botTap(s, bot, mem, opt.stepMs, events);
    observe();
    const r1 = run1.value;
    if (r1 && secondRunRatio === null && s.run.maxDepth >= r1.maxDepth && r1.endMs > 0) {
      secondRunRatio = (s.clock.playedMs - r1.endMs) / r1.endMs;
    }
    if (depthAt60 === null && s.clock.playedMs >= DEPTH_AT_MS) depthAt60 = s.stats.bestDepth;
    steps++;
    if ((steps & 1023) === 0 && !(isHealthy(s.run.coins) && isHealthy(s.stats.totalCoins))) healthy = false;
  }
  const wallMs = now() - t0;
  healthy = healthy && isHealthy(s.run.coins) && isHealthy(s.stats.totalCoins);
  return {
    bot: bot.id,
    seed: opt.seed,
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
    newElementGapMs: rec.newElementGapMs(Math.min(20 * 60_000, totalMs)),
    buyGapMs: buyGap,
    maxStuckMs,
    secondRunRatio,
    depthAt60,
    // 頭打ちにしない（数え方の誤りを 100% に隠さない。レビュー PR #10 N-3）。数えていなければ（5 分より短い実行）NaN
    bathShare: allCoins > 0 ? bathCoins / allCoins : NaN,
    samples,
    state: s,
  };
}

/** 相対差（|a-b| / max(|a|,|b|)） */
export function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}
