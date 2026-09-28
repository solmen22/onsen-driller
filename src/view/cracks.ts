// ひびの段（arch §14・Q-19。BL-036）。Phaser に依存しない

/**
 * ひびの段（ratio＝今のブロックに入ったダメージ ÷ HP）: 0 以下 → 0（ひびなし）、0 超 0.25 未満 → 1、
 * 0.25 以上 0.5 未満 → 2、0.5 以上 0.75 未満 → 3、0.75 以上 → 4
 */
export function crackStage(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (!(ratio > 0)) return 0; // NaN も 0
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

/** 段のテクスチャのキー（0 は null＝隠す） */
export const crackFrame = (stage: number): string | null => (stage >= 1 && stage <= 4 ? `crack-${stage}` : null);

/** 同じブロック（深さ）の間は段を下げない（泉質の効果で HP が変わっても戻らない。Q-19） */
export class CrackTracker {
  private depth = -1;
  private stage: 0 | 1 | 2 | 3 | 4 = 0;

  update(depth: number, ratio: number): 0 | 1 | 2 | 3 | 4 {
    if (depth !== this.depth) {
      this.depth = depth;
      this.stage = 0;
    }
    const s = crackStage(ratio);
    if (s > this.stage) this.stage = s;
    return this.stage;
  }
}
