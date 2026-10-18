// 転生「新しい湯の里へ」の表示に使う値（gdd §5-8。BL-021）。転生タブ（T4。BL-045）と確認の画面が、何が得られて何が残るかを
// 1 か所の計算で出せるようにする（UI で式を持たない。数値の調整は content/params.ts の prestige だけ）
import { PARAMS } from '../content/params.ts';
import { yunohanaGain } from './formulas.ts';
import { add, mul, ONE, type Num } from './num.ts';
import type { GameState } from './state.ts';

const P = PARAMS.prestige;
const T = PARAMS.tickets;

export interface PrestigeView {
  /**
   * 転生タブの中身を見せるか: セーブ全体の最深（stats.bestDepth）が解放の深さ以上（一度でも届けば、次の周回の始めでも消えない）。
   * 届く前は「150m で解放」だけを出す（確認事項 #8 の技術リードの案。PM の確認待ち）
   */
  readonly unlocked: boolean;
  /** 解放の深さ（「150m で解放」の表示） */
  readonly unlockDepth: number;
  /** 今転生できるか（この周回の最深が解放の深さ以上＝得られる湯の華が 1 以上） */
  readonly canPrestige: boolean;
  /** 今転生すると得られる湯の華（この周回の最深から。floor((最深 ÷ 50)²)） */
  readonly gain: Num;
  /** この周回の最深 */
  readonly runMaxDepth: number;
  /** 得られる湯の華が 1 つ増える深さ（「あと 〇m で +1」。まだ 0 なら解放の深さ） */
  readonly nextGainDepth: number;
  /** 転生の推奨（今得られる湯の華が PARAMS.prestige.recommendGain 以上）。目標表 #10 と同じ基準 */
  readonly recommended: boolean;
  /** 累計の湯の華（今と、転生した後） */
  readonly lifetimeNow: Num;
  readonly lifetimeAfter: Num;
  /** 全生産（ドリル威力・入湯料）の倍率（今と、転生した後。1.18 なら +18%） */
  readonly multNow: Num;
  readonly multAfter: Num;
  /** 転生で得る温泉チケット（固定の枚数）と、上限で実際に増える枚数（足りない分はコインに替わるが、新しい周回では 0 に近い） */
  readonly ticketsGain: number;
  readonly ticketsAdded: number;
}

/** 得られる湯の華が g＋1 になる最小の深さ（m）。式は floor((d ÷ divisor)²) */
export function depthForGain(g: number): number {
  let d = Math.max(P.unlockDepth, Math.ceil(P.divisor * Math.sqrt(g)));
  while (d > P.unlockDepth && Math.floor((d - 1) / P.divisor) ** 2 >= g) d--; // 浮動小数の誤差の補正（小さい方へ）
  while (Math.floor((d / P.divisor) ** 2) < g) d++; // （大きい方へ）
  return d;
}

const multOf = (lifetime: Num): Num => add(ONE, mul(lifetime, P.bonusPerYunohana));

export function prestigeView(s: Readonly<GameState>): PrestigeView {
  const gain = yunohanaGain(s);
  const g = gain.toNumber();
  const lifetimeNow = s.meta.yunohana.lifetime;
  const lifetimeAfter = add(lifetimeNow, gain);
  return {
    unlocked: s.stats.bestDepth >= P.unlockDepth,
    unlockDepth: P.unlockDepth,
    canPrestige: gain.gt(0),
    gain,
    runMaxDepth: s.run.maxDepth,
    nextGainDepth: depthForGain(g + 1),
    recommended: g >= P.recommendGain,
    lifetimeNow,
    lifetimeAfter,
    multNow: multOf(lifetimeNow),
    multAfter: multOf(lifetimeAfter),
    ticketsGain: T.prestige,
    ticketsAdded: Math.min(Math.max(0, T.max - s.meta.tickets), T.prestige),
  };
}
