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
  /**
   * 値が出来事の時刻（unit 'ms'）の項目（BL-122・PR #37 のレビューの S-2）。実行の長さが max 以上なのに起きなかった実行は
   * 「範囲より遅い」（+Infinity）として中央値に入れる。実行が max より短く、起きなかった実行は今のとおり除く（その時刻まで流していない）
   */
  event?: true;
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
  { no: 2, label: '最初の強化（ツルハシ）', goal: '5〜15 秒', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('firstUpgrade'), min: 5 * SEC, max: 15 * SEC },
  { no: 3, label: '30m・単純温泉 → 放置収入の開始', goal: '30〜60 秒', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('simple'), min: 30 * SEC, max: 60 * SEC },
  { no: 4, label: '80m・二酸化炭素泉', goal: '2:00〜5:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('co2'), min: 2 * MIN, max: 5 * MIN },
  { no: 5, label: 'Lv10 で来るお客さん（1 種目）', goal: '4:00〜8:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('lv10Guest'), min: 4 * MIN, max: 8 * MIN },
  { no: 6, label: '湯船の枠 2', goal: '4:00〜8:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('slot2'), min: 4 * MIN, max: 8 * MIN },
  { no: 7, label: '150m・塩化物泉（転生の解放）', goal: '7:00〜12:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('salt'), min: 7 * MIN, max: 12 * MIN },
  { no: 8, label: '250m・硫黄泉', goal: '14:00〜20:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('sulfur'), min: 14 * MIN, max: 20 * MIN },
  {
    no: 9,
    label: '最初の 20 分の新しい要素の間隔の最大',
    goal: '3 分以内',
    kind: 'pending',
    pending: '改良の後半 12 項目（S4 の BL-020）が入るまで。前半 12 項目〔BL-018〕の後の値は 5:33〔改良の解放から購入までの待ち。BL-034 の検討材料 H-1〕',
    bot: 'standard',
    unit: 'ms',
    value: (r) => r.newElementGapMs,
    max: 3 * MIN,
  },
  { no: 10, label: '転生の推奨（今転生すると湯の華 30 以上。1 周目）', goal: '25:00〜40:00', kind: 'judge', bot: 'standard', unit: 'ms', event: true, value: time('recommend'), min: 25 * MIN, max: 40 * MIN },
  {
    no: 11,
    label: '2 周目で 1 周目の最深に届くまで（1 周目の長さとの比）',
    goal: '35〜50%',
    // 標準ボットは転生のたびに木を安い順に取る（gdd §8-2・CEO 決定 0011〔2026-10-26〕）。この前提で判定に戻した
    kind: 'judge',
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
    event: true,
    value: time('iron'),
    min: 50 * MIN,
    max: 90 * MIN,
  },
  { no: 13, label: '500m・伝説の源泉（エンディング。累計）', goal: '3〜5 時間', kind: 'pending', pending: '伝説の源泉とエンディング（S3 の BL-023）が入るまで', bot: 'standard', unit: 'ms', event: true, value: time('ending'), min: 180 * MIN, max: 300 * MIN },
  { no: 14, label: '空白時間（何も買えない最長。0〜10 分）', goal: '60 秒以内', kind: 'judge', bot: 'standard', unit: 'ms', value: (r) => r.buyGapMs[0], max: 60 * SEC },
  { no: 15, label: '空白時間（10〜30 分）', goal: '120 秒以内', kind: 'judge', bot: 'standard', unit: 'ms', value: (r) => r.buyGapMs[1], max: 120 * SEC },
  { no: 16, label: '空白時間（転生の推奨の後）', goal: '300 秒まで', kind: 'pending', pending: '測り方を BL-034 で決めるまで（標準ボットは推奨に届いた時点で転生するので、推奨の後の区間がない。CEO 決定 2026-10-26）' },
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
 * 範囲外を意図して受け入れる項目（gdd §8-6: 理由を書き、技術リードが承認する）。受け入れた項目は、判定に使った値が
 * 受け入れる幅（bounds。両端を含む）の中で、かつ半分以上のシードで値があるときだけ失敗にしない（BL-122・PR #37 のレビューの S-1）。
 * 幅の外・値がなければ失敗。範囲内に戻ったらレポートで知らせる（stale）。期限（until）のチケットで数値を直したら、ここから消す
 */
export interface Accepted {
  no: number;
  reason: string;
  approvedBy: string;
  until: string;
  /** 受け入れる幅（受け入れたときの値の幅に余裕を足す。目標の単位と同じ） */
  bounds: { min: number; max: number };
}

export const ACCEPTED: readonly Accepted[] = [
  // #8（250m・硫黄泉）は BL-018 の数値（改良のコスト ×10・g_h 1.072。CEO 決定 0010）で範囲内に戻ったので消した
  // （中央値 14:24。シード 1〜8 で 14:01〜14:52。下限 14:00 との差は小さい。g_h は BL-034 までの暫定）
  {
    no: 10,
    reason:
      '1 周目の 150m 以降が gdd の暫定値より速い（S1〜S2 の初期値から）。BL-018（改良）の後は、改良のコスト ×10 と地層の硬さの伸び g_h 1.066→1.072（BL-034 までの暫定）を組にして、中央値 17:04（範囲 25:00〜40:00。シード 1〜8 で 16:41〜17:30）。受け入れたとき（S2）の 17:14 とほぼ同じ。転生の推奨の表示の時期は、転生の本実装（S3 の BL-021・022）と BL-034 の数値（g_h の最終の値を含む）で合わせる',
    approvedBy:
      '技術リード（2026-09-29。暫定）。CEO 決定 2026-09-29: #8 と同じ扱い（期限 BL-034 の暫定の受け入れ）。BL-018 の後も幅のままで受け入れ: CEO 決定 0010（2026-10-18。案 c、g_h は BL-034 までの暫定）',
    until: 'BL-034',
    // 受け入れたときの値 16:47〜17:22（BL-018 の後は 16:41〜17:30）の下に約 1.5〜2 分の余裕。上限は目標の上限（25:00〜40:00 は合格になる）
    bounds: { min: 15 * MIN, max: 40 * MIN },
  },
  {
    no: 11,
    reason:
      '標準ボットが転生のたびに湯の華の木を安い順に取る（CEO 決定 0011）と、2 周目は 1 周目より速い: 中央値 26.0%（範囲 35〜50%。シード 1〜8 で 25.3〜30.2%）。木の安いノードで 2 周目が速くなる（1 周目の 36 前後の湯の華で、研いだ刃〔威力 ×2〕・湯守の心得〔入湯料 ×2〕・旅の支度金などがすぐ取れる）。BL-034 で木のコストか効果を合わせる（転生の推奨の時期 #10 と一緒に）',
    approvedBy: '技術リード（2026-10-26。暫定）。CEO 承認（2026-10-26。幅 22〜50%・期限 BL-034）',
    until: 'BL-034',
    // 受け入れたときの値 25.3〜30.2% の下に約 3 ポイントの余裕。上限は目標の上限（35〜50% は合格になる）
    bounds: { min: 0.22, max: 0.5 },
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
  /** この項目の受け入れ（verdict が accepted のほか、幅の外で fail・範囲内に戻って pass のときも付く） */
  accepted?: Accepted;
  /** 受け入れた項目が範囲内に戻った（失敗にはしない。ACCEPTED から消し忘れないためにレポートで知らせる） */
  stale?: true;
}

/** 中央値（個数が偶数なら真ん中の 2 つの平均）。空なら null */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const a = [...xs].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); // +Infinity 同士でも順序が決まる比較
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? (a[mid] ?? null) : ((a[mid - 1] ?? 0) + (a[mid] ?? 0)) / 2;
}

export function inRange(def: TargetDef, v: number): boolean {
  if (def.min !== undefined && v < def.min) return false;
  if (def.max !== undefined && v > def.max) return false;
  if (def.gt !== undefined && !(v > def.gt)) return false;
  return true;
}

/** 値の出ない実行の扱い（BL-122）: 出来事の時刻の項目で、実行の長さが目標の上限以上なのに起きていなければ「範囲より遅い」 */
function sampleOf(def: TargetDef, r: SimResult): number | null {
  const v = def.value?.(r) ?? null;
  if (v !== null && Number.isFinite(v)) return v;
  if (v === null && def.event && def.max !== undefined && r.hours * 3_600_000 >= def.max) return Number.POSITIVE_INFINITY;
  return null;
}

/**
 * 目標を判定する。runs はボット・シードごとの実行。値の出ない実行は、出来事の時刻の項目（event）で実行が上限より長ければ
 * +Infinity（範囲より遅い）として中央値に入れ、それ以外（その時刻まで流していない・値がない）は中央値から除く。
 * 判定する項目で値が半分以上のシードで出ていなければ失敗（出来事が起きていない＝範囲外）
 */
export function judgeTargets(runs: readonly SimResult[], accepted: readonly Accepted[] = ACCEPTED): TargetResult[] {
  return TARGETS.map((def) => {
    const own = def.no === 22 ? runs : runs.filter((r) => r.bot === def.bot);
    const values = def.value ? own.map((r) => ({ seed: r.seed, value: sampleOf(def, r) })) : [];
    const nums = values.map((x) => x.value).filter((v): v is number => v !== null);
    const judged = def.no === 22 ? (nums.length > 0 ? Math.min(...nums) : null) : median(nums);
    if (def.kind !== 'judge') return { def, values, judged, verdict: def.kind };
    const enough = nums.length * 2 >= Math.max(1, values.length);
    const usable = judged !== null && Number.isFinite(judged) && enough;
    const acc = accepted.find((a) => a.no === def.no);
    if (usable && inRange(def, judged)) return acc ? { def, values, judged, verdict: 'pass', accepted: acc, stale: true } : { def, values, judged, verdict: 'pass' };
    if (!acc) return { def, values, judged, verdict: 'fail' };
    const inBounds = usable && judged >= acc.bounds.min && judged <= acc.bounds.max;
    return { def, values, judged, verdict: inBounds ? 'accepted' : 'fail', accepted: acc };
  });
}

/** 値の表示（時刻は m:ss、割合は %、深さは m） */
export function fmtValue(unit: ValueUnit | undefined, v: number | null): string {
  if (v === Number.POSITIVE_INFINITY) return '未達';
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
