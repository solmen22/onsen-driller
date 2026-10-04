// 目標表（gdd §8-3）の「何分で何が起きるか」の記録（BL-015〜017 の PR のバランスのレポート用）。
// 判定（範囲外で失敗にする）と 24 項目の全体は BL-031・BL-033 の targets.ts で行う。ここでは初めて起きた時刻を集めるだけ
import type { GuestId } from '../../src/content/guests.ts';
import { yunohanaGain, type GameEvent, type GameState } from '../../src/core/index.ts';

/** 転生の推奨（#10）の湯の華（gdd §8-3。「湯の華 30 以上」） */
export const RECOMMEND_YUNOHANA = 30;

export type MilestoneId = 'firstUpgrade' | 'simple' | 'co2' | 'lv10Guest' | 'slot2' | 'salt' | 'sulfur' | 'recommend' | 'iron' | 'prestige';

export interface MilestoneDef {
  id: MilestoneId;
  /** gdd §8-3 の番号（0 は目標表の外の参考） */
  no: number;
  label: string;
  /** 目標の範囲（秒。[下限, 上限]）。範囲のない項目は null */
  rangeSec: readonly [number, number] | null;
}

export const MILESTONES: readonly MilestoneDef[] = [
  { id: 'firstUpgrade', no: 2, label: '最初の強化（ツルハシ）', rangeSec: [5, 15] },
  { id: 'simple', no: 3, label: '30m・単純温泉（放置収入の開始）', rangeSec: [30, 60] },
  { id: 'co2', no: 4, label: '80m・二酸化炭素泉', rangeSec: [120, 300] },
  { id: 'lv10Guest', no: 5, label: 'Lv10 で来るお客さん（1 種目）', rangeSec: [240, 480] },
  { id: 'slot2', no: 6, label: '湯船の枠 2', rangeSec: [240, 480] },
  { id: 'salt', no: 7, label: '150m・塩化物泉', rangeSec: [420, 720] },
  { id: 'sulfur', no: 8, label: '250m・硫黄泉', rangeSec: [840, 1200] },
  { id: 'recommend', no: 10, label: '転生の推奨（今転生すると湯の華 30 以上）', rangeSec: [1500, 2400] },
  { id: 'iron', no: 12, label: '400m・含鉄泉（累計）', rangeSec: [3000, 5400] },
  { id: 'prestige', no: 0, label: '（参考）最初の転生（ボットの規則: 湯の華 30 以上か前回の 1.5 倍、または最深が 2 分止まる）', rangeSec: null },
];

/** Lv10 で来るお客さん（gdd §5-6 の「〇〇泉をつなぎ、Lv10」） */
const LV10_GUESTS: readonly GuestId[] = ['monkey', 'capybara', 'fox', 'redPanda'];

/** イベントから、それぞれの出来事が初めて起きたロジックの時刻（ms）を記録する */
export class MilestoneRecorder {
  readonly at: Partial<Record<MilestoneId, number>> = {};

  private mark(id: MilestoneId, ms: number): void {
    if (this.at[id] === undefined) this.at[id] = ms;
  }

  /** 状態から判定する出来事（#10: 今転生すると得られる湯の華が初めて 30 以上になった） */
  observeState(s: GameState): void {
    if (this.at.recommend === undefined && yunohanaGain(s).gte(RECOMMEND_YUNOHANA)) this.mark('recommend', s.clock.playedMs);
  }

  observe(events: readonly GameEvent[], playedMs: number): void {
    for (const e of events) {
      if (e.type === 'ToolEvolved' && e.tool === 1) this.mark('firstUpgrade', playedMs);
      else if (e.type === 'SpringFound') this.mark(e.spring, playedMs);
      else if (e.type === 'GuestArrived' && LV10_GUESTS.includes(e.guest)) this.mark('lv10Guest', playedMs);
      else if (e.type === 'SlotUnlocked' && e.n === 2) this.mark('slot2', playedMs);
      else if (e.type === 'PrestigeDone') this.mark('prestige', playedMs);
    }
  }
}

/** m:ss（1 時間以上は h:mm:ss）。未達は '—' */
export function fmtClock(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** 範囲の判定の表示（範囲内 ○・範囲外 ×・未達 —・範囲なし 空） */
export function judge(def: MilestoneDef, ms: number | undefined): string {
  if (!def.rangeSec) return '';
  if (ms === undefined) return '—';
  const sec = ms / 1000;
  return sec >= def.rangeSec[0] && sec <= def.rangeSec[1] ? '○' : '×';
}
