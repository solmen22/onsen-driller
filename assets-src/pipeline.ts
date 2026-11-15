// 画素配列 → PNG・アトラスの変換の本体（arch §3-2 の `art`・gdd §14-1・§14-3。BL-061）。scripts/build-art.mjs と
// tests/unit/art-pipeline.test.ts が使う（ゲーム本体には入らない）。ファイルを読み書きしない純粋な関数だけを置く
// - パレット: 32 色を 4 つの組（土の暖色 12・湯の青緑 6・湯けむりの白 4・UI 用 10）に 1 回ずつ割り当てる
// - パレットにない色を使うスプライト・地形の差し替えは失敗にする
// - 地形の配色は、同じパレットの中の色の差し替え（名前 → 名前）で地層タイルから作る
import { deflateSync, crc32 } from 'node:zlib';
import type { PaletteName, SpriteDef } from './lib.ts';

/** パレットの組と色の数（gdd §14-1） */
export const PALETTE_GROUPS = { soil: 12, water: 6, steam: 4, ui: 10 } as const;
export type PaletteGroup = keyof typeof PALETTE_GROUPS;

export interface PaletteFile {
  name?: string;
  note?: string;
  /** 名前 → #rrggbb */
  colors: Record<string, string>;
  /** 組 → 名前の並び */
  groups: Record<string, string[]>;
}

/** 地形ごとの色の差し替え（元の名前 → 新しい名前。どちらもパレットの名前） */
export type Swap = Readonly<Record<PaletteName, PaletteName>>;

/** パレットの検査（失敗の文の配列。空なら OK） */
export function paletteErrors(p: PaletteFile): string[] {
  const errors: string[] = [];
  const names = Object.keys(p.colors ?? {});
  const total = Object.values(PALETTE_GROUPS).reduce((a, b) => a + b, 0);
  if (names.length !== total) errors.push(`パレットの色の数 ${names.length} ≠ ${total}`);
  const hexes = new Map<string, string>();
  for (const [n, h] of Object.entries(p.colors ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(n)) errors.push(`色の名前 '${n}' は英字で始まる英数字だけ`);
    if (!/^#[0-9a-f]{6}$/.test(h)) errors.push(`${n}: 色 '${h}' は #rrggbb（小文字）`);
    const dup = hexes.get(h);
    if (dup) errors.push(`${n}: 色 ${h} が ${dup} と同じ`);
    hexes.set(h, n);
  }
  const seen = new Map<string, string>();
  const groups = p.groups ?? {};
  for (const g of Object.keys(groups)) if (!(g in PALETTE_GROUPS)) errors.push(`知らない組 '${g}'（${Object.keys(PALETTE_GROUPS).join('・')} だけ）`);
  for (const [g, want] of Object.entries(PALETTE_GROUPS)) {
    const list = groups[g];
    if (!list) {
      errors.push(`組 '${g}' がない`);
      continue;
    }
    if (list.length !== want) errors.push(`組 '${g}' の色の数 ${list.length} ≠ ${want}`);
    for (const n of list) {
      if (!(n in (p.colors ?? {}))) errors.push(`組 '${g}' の '${n}' がパレットにない`);
      const other = seen.get(n);
      if (other) errors.push(`'${n}' が組 '${other}' と '${g}' の両方にある`);
      seen.set(n, g);
    }
  }
  for (const n of names) if (!seen.has(n)) errors.push(`'${n}' がどの組にも入っていない`);
  return errors;
}

/** スプライトの検査（id・大きさ・文字・パレットにない色）。使った色の名前を used に足す */
export function spriteErrors(sprites: readonly SpriteDef[], colors: Readonly<Record<string, string>>, used = new Set<string>()): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of sprites) {
    if (ids.has(s.id)) errors.push(`${s.id}: id が重複`);
    ids.add(s.id);
    if (!/^[a-z0-9-]+$/.test(s.id)) errors.push(`${s.id}: id は英小文字・数字・ハイフンだけ`);
    if (s.rows.length !== s.h) errors.push(`${s.id}: 行数 ${s.rows.length} ≠ h ${s.h}`);
    s.rows.forEach((r, y) => {
      if ([...r].length !== s.w) errors.push(`${s.id}: ${y} 行目の長さ ${[...r].length} ≠ w ${s.w}`);
      for (const ch of r) {
        if (ch === '.') continue;
        const name = s.key[ch];
        if (!name) errors.push(`${s.id}: 未定義の文字 '${ch}'（${y} 行目）`);
        else if (!colors[name]) errors.push(`${s.id}: パレットにない色 '${name}'`);
        else used.add(name);
      }
    });
  }
  return errors;
}

/** 差し替えの検査（元・先ともパレットの名前） */
export function swapErrors(terrain: string, swap: Swap, colors: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  for (const [from, to] of Object.entries(swap)) {
    if (!colors[from]) errors.push(`地形 ${terrain}: 差し替えの元 '${from}' がパレットにない`);
    if (!colors[to]) errors.push(`地形 ${terrain}: 差し替えの先 '${to}' がパレットにない`);
  }
  return errors;
}

/** 色を差し替えたスプライト（形はそのまま。key の名前だけを置き換える。同時に置き換えるので連鎖しない） */
export function recolor(s: SpriteDef, id: string, swap: Swap): SpriteDef {
  const key: Record<string, PaletteName> = {};
  for (const [ch, name] of Object.entries(s.key)) key[ch] = swap[name] ?? name;
  return { ...s, id, key, rows: [...s.rows] };
}

/** 地層タイルの id（tile-<帯>-<変化形>）に地形を入れる（山あいは今の名前のまま: tile-<地形>-<帯>-<変化形>） */
export const terrainTileId = (terrain: string, id: string): string => id.replace(/^tile-/, `tile-${terrain}-`);

export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: number; h: number };
  sourceSize: { w: number; h: number };
}
export interface Atlas {
  width: number;
  height: number;
  /** RGBA */
  rgba: Buffer;
  frames: Record<string, AtlasFrame>;
}

export const ATLAS_W = 128;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** 1 画素の色（透明は null） */
export function pixelOf(s: SpriteDef, colors: Readonly<Record<string, string>>, x: number, y: number): [number, number, number] | null {
  const ch = [...(s.rows[y] ?? '')][x] ?? '.';
  if (ch === '.') return null;
  const name = s.key[ch];
  const h = name ? colors[name] : undefined;
  if (!h) throw new Error(`${s.id}: パレットにない色 '${name ?? ch}'`);
  return hex(h);
}

/** 詰め込み（高さ順の棚詰め。タイルは 1px 押し出し、それ以外は 1px の余白）。検査を済ませたスプライトを渡す */
export function packAtlas(sprites: readonly SpriteDef[], colors: Readonly<Record<string, string>>): Atlas {
  const items = sprites.map((s) => ({ s, w: s.w + 2, h: s.h + 2, x: 0, y: 0 })).sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0;
  let y = 0;
  let shelfH = 0;
  for (const it of items) {
    if (x + it.w > ATLAS_W) {
      x = 0;
      y += shelfH;
      shelfH = 0;
    }
    it.x = x;
    it.y = y;
    x += it.w;
    shelfH = Math.max(shelfH, it.h);
  }
  const height = 2 ** Math.ceil(Math.log2(Math.max(1, y + shelfH)));
  const rgba = Buffer.alloc(ATLAS_W * height * 4);
  const put = (px: number, py: number, rgb: [number, number, number]): void => {
    const i = (py * ATLAS_W + px) * 4;
    rgba[i] = rgb[0];
    rgba[i + 1] = rgb[1];
    rgba[i + 2] = rgb[2];
    rgba[i + 3] = 255;
  };
  const frames: Record<string, AtlasFrame> = {};
  for (const it of items) {
    const { s } = it;
    const ox = it.x + 1;
    const oy = it.y + 1;
    for (let j = -1; j <= s.h; j++)
      for (let i = -1; i <= s.w; i++) {
        const inside = i >= 0 && j >= 0 && i < s.w && j < s.h;
        if (!inside && !s.tile) continue;
        const p = pixelOf(s, colors, Math.min(Math.max(i, 0), s.w - 1), Math.min(Math.max(j, 0), s.h - 1));
        if (p) put(ox + i, oy + j, p);
      }
    frames[s.id] = {
      frame: { x: ox, y: oy, w: s.w, h: s.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: s.w, h: s.h },
      sourceSize: { w: s.w, h: s.h },
    };
  }
  return { width: ATLAS_W, height, rgba, frames };
}

/** アトラスの JSON（Phaser の JSON Hash 形式）の文字列 */
export function atlasJson(a: Atlas): string {
  return JSON.stringify(
    { frames: a.frames, meta: { app: 'onsen-driller build-art', image: 'atlas.png', format: 'RGBA8888', size: { w: a.width, h: a.height }, scale: '1' } },
    null,
    1,
  );
}

/** PNG（RGBA 8bit。zlib だけで書く） */
export function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let r = 0; r < h; r++) {
    raw[r * (w * 4 + 1)] = 0;
    rgba.copy(raw, r * (w * 4 + 1) + 1, r * w * 4, (r + 1) * w * 4);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface ArtInput {
  palette: PaletteFile;
  /** 地層タイル（地形の差し替えのもと） */
  strata: readonly SpriteDef[];
  /** そのほかのスプライト（差し替えない） */
  others: readonly SpriteDef[];
  /** 地形 → 差し替え（山あいは含めない＝元の色のまま） */
  terrains: Readonly<Record<string, Swap>>;
}

export interface ArtOutput {
  errors: string[];
  sprites: SpriteDef[];
  used: Set<string>;
  atlas?: Atlas;
  png?: Buffer;
  json?: string;
}

/** 検査 → 地形の差し替え → 詰め込み → PNG・JSON。失敗があれば atlas などは作らない */
export function buildArt(input: ArtInput): ArtOutput {
  const colors = input.palette.colors ?? {};
  const errors = paletteErrors(input.palette);
  const terrainTiles: SpriteDef[] = [];
  for (const [t, swap] of Object.entries(input.terrains)) {
    if (!/^[a-z]+$/.test(t)) errors.push(`地形の id '${t}' は英小文字だけ`);
    const se = swapErrors(t, swap, colors);
    errors.push(...se);
    if (se.length) continue; // 差し替えた後のタイルの「パレットにない色」は重ねて出さない
    for (const s of input.strata) terrainTiles.push(recolor(s, terrainTileId(t, s.id), swap));
  }
  const sprites = [...input.strata, ...terrainTiles, ...input.others];
  const used = new Set<string>();
  errors.push(...spriteErrors(sprites, colors, used));
  if (errors.length) return { errors, sprites, used };
  const atlas = packAtlas(sprites, colors);
  return { errors, sprites, used, atlas, png: encodePng(atlas.width, atlas.height, atlas.rgba), json: atlasJson(atlas) };
}
