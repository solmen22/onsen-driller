// PoC 用の URL パラメータ（iPhone 確認・性能試験用）。S1 で quality.ts・デバッグパネルに置き換え、公開前に外す
export interface PocParams {
  /** 左上にフレーム時間・タップの反応時間を表示 */
  fps: boolean;
  /** 常に N 個のパーティクルを出す負荷試験 */
  particles: number;
  /** 自動掘り＋長押しを最初からオン（ロジックを動かし続ける） */
  auto: boolean;
  /** 深い地層と道具を見るためのデモ状態（コイン・深さを付与） */
  demo: boolean;
  seed: number;
}

export function readPocParams(search: string): PocParams {
  const p = new URLSearchParams(search);
  const n = (k: string, d: number): number => {
    const x = Number(p.get(k));
    return Number.isFinite(x) && p.has(k) ? x : d;
  };
  return {
    fps: p.has('fps'),
    particles: Math.max(0, Math.min(1000, n('particles', 0))),
    auto: p.has('auto'),
    demo: p.has('demo'),
    seed: n('seed', 1),
  };
}
