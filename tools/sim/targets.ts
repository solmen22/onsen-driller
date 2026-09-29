// 目標表 24 項目（gdd §8-3）の定義と判定（BL-033）。判定の方法は docs/balance.md
// - 複数のシード（既定 1〜8）で流し、シードごとの値の中央値で判定する（1 秒・1 回の買い物の刻みの揺れで赤にならないように。
//   中央値は値の個数が偶数なら真ん中の 2 つの平均）。レポートにはシードごとの値と判定に使った値を出す
// - まだ入っていない要素に依存する項目は「保留」（値が出せるものは参考に出す）。該当チケットの完了で judge に変える
// - 範囲外を意図して受け入れる項目は ACCEPTED に理由・承認者・期限を書く（gdd §8-6。#20・#21 は QA リードの同意も要る）
import type { BotId } from './bots.ts';
import type { SimResult } from './sim.ts';

export type TargetKind = 'judge' | 'pending' | 'external';
export type ValueUnit = 'ms' | 'ratio' | 'm' | 'bool' | 'us';

export interface TargetDef {
  no: number;
  label: string;
  /** 目標（表示用） */
  goal: string;
  kind: TargetKind;
  /** 値をとるボット */
  bot?: BotId;
  unit?: ValueUnit;
  /** 1 回の実行から値を取り出す（出来事が起きていなければ null） */
  value?: (r: SimResult) => number | null;
  /** 範囲（両端を含む）。gt は下限を含まない（「50% 超」） */
  min?: number;
  max?: number;
  gt?: number;
  /** 保留の理由と、有効にするチケット */
  pending?: string;
  /** 外部で判定する項目（E2E・不変条件・性能テスト）の場所 */
  external?: string;
}

const MIN = 60_000;
const SEC = 1000;
const time = (id: keyof SimResult['milestones']) => (r: SimResult): number | null => r.milestones[id] ?? null;

export const TARGETS: readonly TargetDef[] = [
  { no: 1, label: 'ゲーム画面から始まり、すぐ掘れる', goal: '0 クリック', kind: 'external', external: 'E2E の E1（TS-E1-01〜02）' },
  { no: 2, label: '最初の強化（ツルハシ）', goal: '5〜15 秒', kind: 'judge', bot: 'standard', unit: 'ms', value: time('firstUpgrade'), min: 5 * SEC, max: 15 * SEC },
  { no: 3, label: '30m・単純温泉 → 放置収入の開始', goal: '30〜60 秒', kind: 'judge', bot: 'standard', unit: 'ms', value: time('simple'), min: 30 * SEC, max: 60 * SEC },
  { no: 4, label: '80m・二酸化炭素泉', goal: '2:00〜5:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('co2'), min: 2 * MIN, max: 5 * MIN },
  { no: 5, label: 'Lv10 で来るお客さん（1 種目）', goal: '4:00〜8:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('lv10Guest'), min: 4 * MIN, max: 8 * MIN },
  { no: 6, label: '湯船の枠 2', goal: '4:00〜8:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('slot2'), min: 4 * MIN, max: 8 * MIN },
  { no: 7, label: '150m・塩化物泉（転生の解放）', goal: '7:00〜12:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('salt'), min: 7 * MIN, max: 12 * MIN },
  { no: 8, label: '250m・硫黄泉', goal: '14:00〜20:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('sulfur'), min: 14 * MIN, max: 20 * MIN },
  {
    no: 9,
    label: '最初の 20 分の新しい要素の間隔の最大',
    goal: '3 分以内',
    kind: 'pending',
    pending: '改良（BL-018。後半は S3 の BL-020）が入るまで',
    bot: 'standard',
    unit: 'ms',
    value: (r) => r.newElementGapMs,
    max: 3 * MIN,
  },
  { no: 10, label: '転生の推奨（今転生すると湯の華 30 以上。1 周目）', goal: '25:00〜40:00', kind: 'judge', bot: 'standard', unit: 'ms', value: time('recommend'), min: 25 * MIN, max: 40 * MIN },
  {
    no: 11,
    label: '2 周目で 1 周目の最深に届くまで（1 周目の長さとの比）',
    goal: '35〜50%',
    kind: 'pending',
    pending: '転生の本実装・湯の華の木（S3 の BL-021・022）が入るまで',
    bot: 'standard',
    unit: 'ratio',
    value: (r) => r.secondRunRatio,
    min: 0.35,
    max: 0.5,
  },
  {
    no: 12,
    label: '400m・含鉄泉（累計。MVP の源泉が出そろう）',
    goal: '50〜90 分',
    kind: 'pending',
    pending: '転生の本実装・木・地形（S3 の BL-021・022・024）が入るまで',
    bot: 'standard',
    unit: 'ms',
    value: time('iron'),
    min: 50 * MIN,
    max: 90 * MIN,
  },
  { no: 13, label: '500m・伝説の源泉（エンディング。累計）', goal: '3〜5 時間', kind: 'pending', pending: '伝説の源泉とエンディング（S3 の BL-023）が入るまで', bot: 'standard', unit: 'ms', value: time('ending'), min: 180 * MIN, max: 300 * MIN },
  { no: 14, label: '空白時間（何も買えない最長。0〜10 分）', goal: '60 秒以内', kind: 'pending', pending: '改良（BL-018）が入るまで', bot: 'standard', unit: 'ms', value: (r) => r.buyGapMs[0], max: 60 * SEC },
  { no: 15, label: '空白時間（10〜30 分）', goal: '120 秒以内', kind: 'pending', pending: '改良（BL-018）が入るまで', bot: 'standard', unit: 'ms', value: (r) => r.buyGapMs[1], max: 120 * SEC },
  { no: 16, label: '空白時間（転生の推奨の後）', goal: '300 秒まで', kind: 'pending', pending: '転生の本実装（S3 の BL-021）が入るまで' },
  { no: 17, label: '放置ボットの 60 分の到達深さ', goal: '250m 以上', kind: 'judge', bot: 'idle', unit: 'm', value: (r) => r.depthAt60, min: 250 },
  { no: 18, label: '5〜60 分の収入のうち入湯料の割合', goal: '50% 超', kind: 'judge', bot: 'standard', unit: 'ratio', value: (r) => (Number.isFinite(r.bathShare) ? r.bathShare : null), gt: 0.5 },
  { no: 19, label: '60 分で得た温泉チケット', goal: '8〜12 枚', kind: 'pending', pending: 'ご褒美・チケット（BL-058）が入るまで' },
  { no: 20, label: '広告なしボットの到達（標準との比）・全コンテンツの解放', goal: '1.2 倍以内・6 時間以内', kind: 'pending', pending: '広告なしボット（BL-032）とご褒美（BL-058）が入るまで。QA の必須項目' },
  { no: 21, label: '広告の報酬が 1 時間の総収入に占める割合', goal: '20% 以内', kind: 'pending', pending: 'ご褒美（BL-058）が入るまで。QA の必須項目' },
  { no: 22, label: '数値の健全性（NaN・Infinity・負がない・上限以内）', goal: 'すべての実行で健全', kind: 'judge', unit: 'bool', value: (r) => (r.healthy ? 1 : 0), min: 1 },
  { no: 23, label: '1 回の step の処理時間（20 時間後の状態）', goal: '中央値 50µs 未満（かつ 1ms 未満）', kind: 'external', external: '`npm run test:balance` の計測（本判定は性能テストの BL-079）' },
  { no: 24, label: '有効な構成の数（400m が最速の +25% 以内の構成）', goal: '3（最低 2）', kind: 'pending', pending: '構成別ボット（BL-032）と転生・地形（S3）が入るまで' },
];

/**
 * 範囲外を意図して受け入れる項目（gdd §8-6: 理由を書き、技術リードが承認する）。受け入れた項目は範囲外でも失敗にしない。
 * 期限（until）のチケットで数値を直したら、ここから消す
 */
export interface Accepted {
  no: number;
  reason: string;
  approvedBy: string;
  until: string;
}

export const ACCEPTED: readonly Accepted[] = [
  {
    no: 8,
    reason:
      '既存の数値（S1〜S2 の初期値）の結果。1 周目の 150m 以降が gdd の暫定値より速く、中央値 13:54（下限 14:00 に 6 秒足りない。シード 1〜8 で 13:23〜14:04）。#10 と同じ原因。数値の調整は BL-034（数値だけの PR）で、BL-032（転生の規則のボット）の後に流し直して切り分ける',
    approvedBy: '技術リード（2026-09-29。暫定。S2 の完了条件では範囲内が要るので、CEO の判断待ち）',
    until: 'BL-034',
  },
  {
    no: 10,
    reason:
      '#8 と同じ原因（1 周目の 150m 以降が速い）。中央値 17:14（範囲 25:00〜40:00。シード 1〜8 で 16:47〜17:22）。転生の推奨の表示の時期は、転生の本実装（S3 の BL-021・022）と BL-034 の数値で合わせる',
    approvedBy: '技術リード（2026-09-29。暫定。CEO の判断待ち）',
    until: 'BL-034',
  },
];

export type Verdict = 'pass' | 'fail' | 'accepted' | 'pending' | 'external';

export interface TargetResult {
  def: TargetDef;
  /** シードごとの値（その項目のボットの実行の順） */
  values: { seed: number; value: number | null }[];
  /** 判定に使った値（中央値）。値がなければ null */
  judged: number | null;
  verdict: Verdict;
  accepted?: Accepted;
}

/** 中央値（個数が偶数なら真ん中の 2 つの平均）。空なら null */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? (a[mid] ?? null) : ((a[mid - 1] ?? 0) + (a[mid] ?? 0)) / 2;
}

export function inRange(def: TargetDef, v: number): boolean {
  if (def.min !== undefined && v < def.min) return false;
  if (def.max !== undefined && v > def.max) return false;
  if (def.gt !== undefined && !(v > def.gt)) return false;
  return true;
}

/**
 * 目標を判定する。runs はボット・シードごとの実行。値の出ない実行（その時刻まで流していない・出来事が起きていない）は
 * 中央値から除く。判定する項目で値が半分以上のシードで出ていなければ失敗（出来事が起きていない＝範囲外）
 */
export function judgeTargets(runs: readonly SimResult[], accepted: readonly Accepted[] = ACCEPTED): TargetResult[] {
  return TARGETS.map((def) => {
    const own = def.no === 22 ? runs : runs.filter((r) => r.bot === def.bot);
    const values = def.value ? own.map((r) => ({ seed: r.seed, value: def.value?.(r) ?? null })) : [];
    const nums = values.map((x) => x.value).filter((v): v is number => v !== null && Number.isFinite(v));
    const judged = def.no === 22 ? (nums.length > 0 ? Math.min(...nums) : null) : median(nums);
    if (def.kind !== 'judge') return { def, values, judged, verdict: def.kind };
    const enough = nums.length * 2 >= Math.max(1, values.length);
    const ok = judged !== null && enough && inRange(def, judged);
    if (ok) return { def, values, judged, verdict: 'pass' };
    const acc = accepted.find((a) => a.no === def.no);
    return acc ? { def, values, judged, verdict: 'accepted', accepted: acc } : { def, values, judged, verdict: 'fail' };
  });
}

/** 値の表示（時刻は m:ss、割合は %、深さは m） */
export function fmtValue(unit: ValueUnit | undefined, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'ms': {
      const sec = Math.round(v / 1000);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = String(sec % 60).padStart(2, '0');
      return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }
    case 'ratio':
      return `${(v * 100).toFixed(1)}%`;
    case 'm':
      return `${Math.round(v)}m`;
    case 'bool':
      return v >= 1 ? '健全' : '不健全';
    case 'us':
      return `${v.toFixed(2)}µs`;
    default:
      return String(v);
  }
}

export const VERDICT_MARK: Readonly<Record<Verdict, string>> = { pass: '○', fail: '×', accepted: '△ 受け入れ', pending: '保留', external: '外部' };
