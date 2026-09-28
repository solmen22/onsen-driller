// 地層のスプライトの使い回し（arch §14。BL-036）。Phaser に依存しない（スプライトは作る関数を受け取る）。
// 画面に見える分（約 15 行 × 数列）だけを持ち、カメラが動いたら位置と見た目だけを付け替える。数は画面の大きさを変えたときだけ変わる

/** プールが使うスプライトの操作（Phaser の Image が満たす形） */
export interface PooledSprite {
  setVisible(v: boolean): unknown;
  setPosition(x: number, y: number): unknown;
  setFrame(frame: string): unknown;
  setTint(color: number): unknown;
  setAlpha?(a: number): unknown;
  destroy(): void;
}

/** 1 マスの見た目（null なら隠す） */
export interface CellLook {
  frame: string;
  tint?: number;
  alpha?: number;
}

export class TilePool<S extends PooledSprite> {
  private readonly create: () => S;
  private sprites: S[] = [];
  private colsValue = 0;
  private rowsValue = 0;
  /** 付け替えた前の見た目（同じなら setFrame などを呼ばない） */
  private readonly last: (string | null)[] = [];

  constructor(create: () => S) {
    this.create = create;
  }

  get size(): number {
    return this.sprites.length;
  }
  get cols(): number {
    return this.colsValue;
  }
  get rows(): number {
    return this.rowsValue;
  }

  /** 列と行の数を合わせる（足りなければ作り、余れば壊す） */
  resize(cols: number, rows: number): void {
    const c = Math.max(0, Math.floor(cols));
    const r = Math.max(0, Math.floor(rows));
    const want = c * r;
    while (this.sprites.length < want) this.sprites.push(this.create());
    while (this.sprites.length > want) this.sprites.pop()?.destroy();
    this.colsValue = c;
    this.rowsValue = r;
    this.last.length = 0;
  }

  /**
   * 左上のマス（firstRow, firstCol）から並べ直す。マス (row, col) は世界座標 (col × tile + offsetX, row × tile)。
   * look が null を返すマスは隠す
   */
  layout(firstRow: number, firstCol: number, tile: number, offsetX: number, look: (row: number, col: number) => CellLook | null): void {
    for (let j = 0; j < this.rowsValue; j++) {
      for (let i = 0; i < this.colsValue; i++) {
        const k = j * this.colsValue + i;
        const sp = this.sprites[k];
        if (!sp) continue;
        const row = firstRow + j;
        const col = firstCol + i;
        const l = look(row, col);
        const key = l ? `${l.frame}|${l.tint ?? 0xffffff}|${l.alpha ?? 1}` : null;
        if (key === null) {
          if (this.last[k] !== null) sp.setVisible(false);
          this.last[k] = null;
          continue;
        }
        sp.setPosition(col * tile + offsetX, row * tile);
        if (this.last[k] !== key && l) {
          sp.setFrame(l.frame);
          sp.setTint(l.tint ?? 0xffffff);
          sp.setAlpha?.(l.alpha ?? 1);
          sp.setVisible(true);
          this.last[k] = key;
        }
      }
    }
  }

  destroy(): void {
    this.resize(0, 0);
  }
}
