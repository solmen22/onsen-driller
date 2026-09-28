// 画素配列の型と、道具・湯船などの幾何形状を描く小さな道具（build-art.mjs が読む。ゲーム本体には入らない）

export type PaletteName = string;

/** 1 文字 = 1 画素。'.' は透明。key で文字 → パレットの名前に対応させる */
export interface SpriteDef {
  id: string;
  w: number;
  h: number;
  key: Record<string, PaletteName>;
  rows: string[];
  /** タイルは 1px 押し出してアトラスに置く（繰り返したときの継ぎ目を防ぐ） */
  tile?: boolean;
}

/** 名前（パレット）で塗る作業用のキャンバス。最後に rows と key を作る */
export class Grid {
  readonly w: number;
  readonly h: number;
  private readonly px: (PaletteName | null)[];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Array<PaletteName | null>(w * h).fill(null);
  }

  get(x: number, y: number): PaletteName | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x] ?? null;
  }

  set(x: number, y: number, c: PaletteName | null): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: PaletteName): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }

  /** ブレゼンハムの直線 */
  line(x0: number, y0: number, x1: number, y1: number, c: PaletteName): this {
    let x = x0;
    let y = y0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  /** 塗りつぶした楕円（中心 cx,cy、半径 rx,ry） */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: PaletteName): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, c);
      }
    return this;
  }

  /** 色のある画素の外周に輪郭を付ける（4 近傍） */
  outline(c: PaletteName): this {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== null) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }

  /** 文字の行で上書きする（' ' と '.' は何もしない） */
  stamp(x0: number, y0: number, rows: string[], key: Record<string, PaletteName>): this {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        if (ch === '.' || ch === ' ') return;
        const c = key[ch];
        if (!c) throw new Error(`stamp: unknown key '${ch}'`);
        this.set(x0 + i, y0 + j, c);
      });
    });
    return this;
  }

  toSprite(id: string): SpriteDef {
    const names = [...new Set(this.px.filter((p): p is string => p !== null))];
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const key: Record<string, PaletteName> = {};
    const rev = new Map<PaletteName, string>();
    names.forEach((n, i) => {
      const ch = chars[i];
      if (!ch) throw new Error('too many colors');
      key[ch] = n;
      rev.set(n, ch);
    });
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let r = '';
      for (let x = 0; x < this.w; x++) {
        const p = this.get(x, y);
        r += p === null ? '.' : (rev.get(p) ?? '.');
      }
      rows.push(r);
    }
    return { id, w: this.w, h: this.h, key, rows };
  }
}
