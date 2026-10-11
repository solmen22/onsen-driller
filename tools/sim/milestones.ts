// 目標表（gdd §8-3）の「何分で何が起きるか」の記録（BL-015 で作り、BL-031・033 で広げた）。
// 判定の定義（範囲・保留・受け入れ）は targets.ts。ここでは出来事が初めて起きた時刻と、判定に使う値を集めるだけ
import type { GuestId } from '../../src/content/guests.ts';
import { yunohanaGain, type GameEvent, type GameState } from '../../src/core/index.ts';

/** 転生の推奨（#10）の湯の華（gdd §8-3。「湯の華 30 以上」） */
export const RECOMMEND_YUNOHANA = 30;
/** エンディング（#13。伝説の源泉）の深さ */
export const ENDING_DEPTH = 500;

export type MilestoneId =
  | 'firstUpgrade'
  | 'simple'
  | 'co2'
  | 'lv10Guest'
  | 'slot2'
  | 'salt'
  | 'sulfur'
  | 'recommend'
  | 'iron'
  | 'ending'
  | 'prestige';

/** Lv10 で来るお客さん（gdd §5-6 の「〇〇泉をつなぎ、Lv10」） */
const LV10_GUESTS: readonly GuestId[] = ['monkey', 'capybara', 'fox', 'redPanda'];

/** イベントと状態から、それぞれの出来事が初めて起きたロジックの時刻（ms）と、判定に使う値を記録する */
export class MilestoneRecorder {
  readonly at: Partial<Record<MilestoneId, number>> = {};
  /** 今の周回の最深（転生の直前の値を #11 に使う） */
  runMaxDepth = 0;
  /** 「新しい要素」（道具の段・源泉・枠の数・お客さん・改良）が初めて出た時刻（#9） */
  private readonly firsts: number[] = [];
  private readonly seen = new Set<string>();

  private mark(id: MilestoneId, ms: number): void {
    if (this.at[id] === undefined) this.at[id] = ms;
  }

  private first(key: string, ms: number): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.firsts.push(ms);
  }

  /** 状態から判定する出来事（#10: 今転生すると湯の華が 30 以上になった。1 周目だけで記録する〔PR #13 レビュー S-1〕・#13: 500m） */
  observeState(s: GameState): void {
    if (this.at.recommend === undefined && this.at.prestige === undefined && yunohanaGain(s).gte(RECOMMEND_YUNOHANA)) this.mark('recommend', s.clock.playedMs);
    if (s.stats.bestDepth >= ENDING_DEPTH) this.mark('ending', s.clock.playedMs);
    if (s.run.maxDepth > this.runMaxDepth) this.runMaxDepth = s.run.maxDepth;
  }

  observe(events: readonly GameEvent[], playedMs: number): void {
    for (const e of events) {
      if (e.type === 'ToolEvolved') {
        if (e.tool === 1) this.mark('firstUpgrade', playedMs);
        this.first(`tool:${e.tool}`, playedMs);
      } else if (e.type === 'SpringFound') {
        this.mark(e.spring, playedMs);
        this.first(`spring:${e.spring}`, playedMs);
      } else if (e.type === 'GuestArrived') {
        if (LV10_GUESTS.includes(e.guest)) this.mark('lv10Guest', playedMs);
        if (e.first) this.first(`guest:${e.guest}`, playedMs);
      } else if (e.type === 'SlotUnlocked') {
        if (e.n === 2) this.mark('slot2', playedMs);
        this.first(`slot:${e.n}`, playedMs);
      } else if (e.type === 'Purchased' && e.item.startsWith('upgrade:')) {
        this.first(e.item, playedMs); // 改良（BL-018）の最初の購入
      } else if (e.type === 'PrestigeDone') {
        this.mark('prestige', playedMs);
        this.runMaxDepth = 0;
      }
    }
  }

  /** 0 から endMs までの「新しい要素」の間隔の最大（ms。0 と endMs の端も間隔に入れる。#9） */
  newElementGapMs(endMs: number): number {
    const ts = [0, ...this.firsts.filter((t) => t <= endMs).sort((a, b) => a - b), endMs];
    let gap = 0;
    for (let i = 1; i < ts.length; i++) gap = Math.max(gap, (ts[i] ?? 0) - (ts[i - 1] ?? 0));
    return gap;
  }
}

/** m:ss（1 時間以上は h:mm:ss）。未達は '—' */
export function fmtClock(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—';
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
