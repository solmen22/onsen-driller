// フレーム時間とタップの反応時間の計測（PoC-1。本番では quality.ts の画質の自動調整に使う）
export interface PerfStats {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
  latency: { n: number; p50: number; p95: number; max: number };
}

const pct = (sorted: number[], p: number): number =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? NaN) : NaN;

export class PerfMonitor {
  private deltas: number[] = [];
  private latencies: number[] = [];
  private pendingInputs: number[] = [];
  private last = 0;
  private raf = 0;

  start(): void {
    const tick = (t: number): void => {
      if (this.last) this.deltas.push(t - this.last);
      if (this.deltas.length > 20_000) this.deltas.splice(0, 10_000);
      this.last = t;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  reset(): void {
    this.deltas = [];
    this.latencies = [];
    this.pendingInputs = [];
  }

  /** 入力イベントの timeStamp（performance.now と同じ基準） */
  markInput(ts: number): void {
    this.pendingInputs.push(ts);
  }

  hasPendingInput(): boolean {
    return this.pendingInputs.length > 0;
  }

  /** 入力を反映したフレームの描画が終わった時刻 */
  markRendered(now: number): void {
    for (const ts of this.pendingInputs) this.latencies.push(now - ts);
    this.pendingInputs = [];
  }

  stats(): PerfStats {
    const d = [...this.deltas].sort((a, b) => a - b);
    const l = [...this.latencies].sort((a, b) => a - b);
    const sum = this.deltas.reduce((a, b) => a + b, 0);
    return {
      frames: d.length,
      fps: sum > 0 ? (d.length * 1000) / sum : 0,
      p50: pct(d, 0.5),
      p95: pct(d, 0.95),
      p99: pct(d, 0.99),
      max: d[d.length - 1] ?? NaN,
      over33: d.filter((x) => x > 33.4).length,
      latency: { n: l.length, p50: pct(l, 0.5), p95: pct(l, 0.95), max: l[l.length - 1] ?? NaN },
    };
  }

  /** ?fps=1 のときの表示（オーナーの iPhone 確認用）。タップを邪魔しない */
  mountOverlay(extra: () => string): void {
    const el = document.createElement('div');
    el.dataset.testid = 'fps-overlay';
    el.style.cssText =
      'position:fixed;right:max(4px,env(safe-area-inset-right));top:max(4px,env(safe-area-inset-top));z-index:50;pointer-events:none;' +
      'background:#000b;color:#9f9;font:11px/1.35 monospace;padding:4px 6px;border-radius:4px;white-space:pre';
    document.body.appendChild(el);
    let windowStart = this.deltas.length;
    setInterval(() => {
      const recent = this.deltas.slice(windowStart).sort((a, b) => a - b);
      windowStart = this.deltas.length;
      const sum = recent.reduce((a, b) => a + b, 0);
      const fps = sum > 0 ? (recent.length * 1000) / sum : 0;
      const s = this.stats();
      el.textContent =
        `FPS ${fps.toFixed(0)}  p95 ${pct(recent, 0.95).toFixed(1)}ms\n` +
        `all p95 ${s.p95.toFixed(1)}ms >33ms ${s.over33}/${s.frames}\n` +
        `tap ${s.latency.n ? `${s.latency.p50.toFixed(0)}/${s.latency.p95.toFixed(0)}ms` : '-'}\n` +
        extra();
    }, 1000);
  }
}
