// dev・e2e のビルドだけで読む URL パラメータ（PoC の iPhone 確認・性能試験用。arch §16-1）。
// main.ts が import.meta.env.DEV か VITE_TEST_HOOKS のときだけ動的に読み込むので、本番の 4 ビルドには入らない
export interface DevParams {
  /** 右上にフレーム時間・タップの反応時間を表示 */
  fps: boolean;
  /** 常に N 個のパーティクルを出す負荷試験 */
  particles: number;
  /** 自動掘り＋長押しを最初からオン（ロジックを動かし続ける） */
  auto: boolean;
  /** 深い地層と道具を見るためのデモ状態（コイン・ドリル Lv40・ツルハシを付与） */
  demo: boolean;
  /** 最初のシード（なければ時計から作る） */
  seed: number | null;
}

export const NO_DEV_PARAMS: DevParams = { fps: false, particles: 0, auto: false, demo: false, seed: null };

export function readDevParams(search: string): DevParams {
  const p = new URLSearchParams(search);
  const n = (k: string): number | null => {
    const x = Number(p.get(k));
    return p.has(k) && Number.isFinite(x) ? x : null;
  };
  return {
    fps: p.has('fps'),
    particles: Math.max(0, Math.min(1000, n('particles') ?? 0)),
    auto: p.has('auto'),
    demo: p.has('demo'),
    seed: n('seed'),
  };
}
