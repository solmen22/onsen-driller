// 画質の自動調整（arch §14・gdd §11-6。BL-037）。Phaser に依存しない純粋な状態機械
// - フレーム時間（ms）を受け取り、1 秒ごとの区切りで 95 パーセンタイルを出す
// - 95 パーセンタイルが 20ms を超える区切りが 3 つ続いたら、パーティクルの倍率を半分にする（1 → 0.5 → 0.25 まで）。
//   半分にしたら数え直す（続けて重ければ、さらに 3 秒後にもう半分）
// - 設定の画質: auto はこの調整、high は 1 のまま、low は 0.5 から（low でも重ければ 0.25 まで下げる）
// - 戻す（倍率を上げる）ことはしない（行ったり来たりでちらつかせない。次の起動で 1 から）

export type QualitySetting = 'auto' | 'high' | 'low';

export const QUALITY = {
  /** 区切りの長さ（ms） */
  windowMs: 1000,
  /** この 95 パーセンタイル（ms）を超えたら「重い区切り」 */
  slowP95Ms: 20,
  /** 重い区切りがこの数だけ続いたら半分にする */
  slowWindows: 3,
  /** 倍率の下限 */
  minScale: 0.25,
} as const;

/** 95 パーセンタイル（昇順に並べて、95% の位置。空なら 0） */
export function p95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
}

export class QualityGovernor {
  private readonly setting: QualitySetting;
  private scaleValue: number;
  private samples: number[] = [];
  private windowElapsed = 0;
  private slowStreak = 0;
  /** 半分にした回数（テスト・記録用） */
  drops = 0;

  constructor(setting: QualitySetting = 'auto') {
    this.setting = setting;
    this.scaleValue = setting === 'low' ? 0.5 : 1;
  }

  /** パーティクルの数に掛ける倍率（1・0.5・0.25） */
  get scale(): number {
    return this.scaleValue;
  }

  /** 1 フレームの時間（ms）を足す。倍率が変わったら true */
  push(deltaMs: number): boolean {
    if (this.setting === 'high' || !Number.isFinite(deltaMs) || deltaMs < 0) return false;
    // 隠れていた間などの長い 1 フレームは、区切りの時間には数えるが、重さの判定には 1 つの値として入るだけ
    this.samples.push(deltaMs);
    this.windowElapsed += deltaMs;
    if (this.windowElapsed < QUALITY.windowMs) return false;
    const slow = p95(this.samples) > QUALITY.slowP95Ms;
    this.samples = [];
    this.windowElapsed = 0;
    this.slowStreak = slow ? this.slowStreak + 1 : 0;
    if (this.slowStreak < QUALITY.slowWindows || this.scaleValue <= QUALITY.minScale) return false;
    this.slowStreak = 0;
    this.scaleValue = Math.max(QUALITY.minScale, this.scaleValue / 2);
    this.drops++;
    return true;
  }
}
