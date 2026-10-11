// 実時間の閾値を持つ単体テストを、このスレッドの CPU 時間で測る（BL-118。QA の記録 org/30_quality/qa-lead/2026-10-05_pr36-record-and-timing.md §2）
// - 守っているのは「計算量が爆発しない」こと。実時間には OS がこのスレッドを動かしていない待ち（PC の混み具合）が入るので、
//   `process.threadCpuUsage()`（user＋system）の差で判定する（条件 1。閾値・回数は呼び出し側で変えない）
// - 偽の緑を防ぐ（条件 2）: CPU の測定値の合計が 0、または `process.threadCpuUsage` がないときは、CPU 時間では合格にせず、
//   実時間の中央値で判定する（閾値は同じ）
// - どちらの方式で判定したかと値を毎回 console.log で出す（条件 3。TS-010-12 と同じ形）
// - Windows の `threadCpuUsage` の刻みは約 15.6ms。複数回を続けて測って回数で割ると、刻みの誤差が 1/回数 になる

export interface Timing {
  /** 判定に使った方式（cpu: CPU 時間の平均。wall: 実時間の中央値） */
  method: 'cpu' | 'wall';
  /** 判定に使う値（ms）。閾値と比べる */
  ms: number;
  /** 1 回あたりの CPU 時間（ms。測れなかったら null） */
  cpuMeanMs: number | null;
  /** 実時間の中央値（ms。参考。CPU が測れないときの判定にも使う） */
  wallMedianMs: number;
}

type CpuUsageFn = () => { user: number; system: number };
const threadCpuUsage = (process as { threadCpuUsage?: CpuUsageFn }).threadCpuUsage;

/** CPU 時間の読み取り（ms）。テストの自己テストで差し替えられるように、既定はこのスレッドの値 */
export type CpuReader = (() => number) | null;
export const defaultCpuReader: CpuReader = threadCpuUsage
  ? () => {
      const u = threadCpuUsage.call(process);
      return (u.user + u.system) / 1000;
    }
  : null;

/**
 * `body(i)`（i = 0..n−1）を n 回続けて行い、その前後の CPU 時間の差 ÷ n と、1 回ずつの実時間の中央値を測る。
 * 準備（状態の作成など）は body の外で行う（測る範囲に入れない）。結果の確認も body の外で行う
 * @param label console.log の見出し（例 'TS-012-13'）
 */
export function measure(label: string, n: number, body: (i: number) => void, read: CpuReader = defaultCpuReader): Timing {
  const walls: number[] = [];
  const c0 = read?.() ?? 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    body(i);
    walls.push(performance.now() - t0);
  }
  const cpuTotal = read ? read() - c0 : 0;
  const sorted = [...walls].sort((a, b) => a - b);
  const wallMedianMs = sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.POSITIVE_INFINITY;
  const cpuMeanMs = read ? cpuTotal / n : null;
  // CPU の合計が 0（測れていない）なら CPU では合格にしない（条件 2）
  const t: Timing =
    cpuMeanMs !== null && cpuTotal > 0
      ? { method: 'cpu', ms: cpuMeanMs, cpuMeanMs, wallMedianMs }
      : { method: 'wall', ms: wallMedianMs, cpuMeanMs, wallMedianMs };
  console.log(
    `[${label}] 判定: ${t.method === 'cpu' ? 'CPU 時間の平均' : '実時間の中央値'} ${t.ms.toFixed(2)}ms（CPU 平均 ${
      cpuMeanMs === null ? '測れない' : `${cpuMeanMs.toFixed(2)}ms`
    }・実時間 中央値 ${wallMedianMs.toFixed(2)}ms・${n} 回）`,
  );
  return t;
}

/** `fn` を 1 回だけ測り、その戻り値と測定を返す（1 秒の閾値のテスト用。刻み約 15.6ms は 1 秒に比べて小さいので 1 回でよい） */
export function measureOnce<T>(label: string, fn: () => T, read: CpuReader = defaultCpuReader): { value: T; timing: Timing } {
  const box: { value?: T } = {};
  const timing = measure(label, 1, () => {
    box.value = fn();
  }, read);
  return { value: box.value as T, timing };
}
