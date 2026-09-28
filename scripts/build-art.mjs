// 画素配列 → PNG・アトラス（arch §3-2 の `art`）。固定パレットの検査つき。
// 使い方: node scripts/build-art.mjs [--preview <path.png>]
// 出力: src/generated/atlas.png・atlas.json（Phaser の JSON Hash 形式。Vite がハッシュ付きの名前で dist/*/assets に出す）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const palette = JSON.parse(readFileSync(resolve(root, 'assets-src/palette.json'), 'utf8')).colors;
// 地層タイルは 6 帯 × 4 種の変化形（strata.ts が tiles.ts の手で打ったタイルから作る）。tiles.ts のタイル自体はアトラスに入れない
const { strataTiles } = await import('../assets-src/sprites/strata.ts');
const { objects } = await import('../assets-src/sprites/objects.ts');
const { props } = await import('../assets-src/sprites/props.ts');
const sprites = [...strataTiles, ...objects, ...props];

// ---- 検査 ----
const errors = [];
const used = new Set();
const ids = new Set();
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
      else if (!palette[name]) errors.push(`${s.id}: パレットにない色 '${name}'`);
      else used.add(name);
    }
  });
}
if (Object.keys(palette).length > 32) errors.push(`パレットが 32 色を超えている（${Object.keys(palette).length}）`);
if (errors.length) {
  console.error('build-art: 検査に失敗\n' + errors.map((e) => ' - ' + e).join('\n'));
  process.exit(1);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pixelOf = (s, x, y) => {
  const ch = s.rows[y][x];
  return ch === '.' ? null : hex(palette[s.key[ch]]);
};

// ---- 詰め込み（高さ順の棚詰め。タイルは 1px 押し出し、それ以外は 1px の余白） ----
const ATLAS_W = 128;
const items = sprites
  .map((s) => ({ s, pad: 1, w: s.w + 2, h: s.h + 2 }))
  .sort((a, b) => b.h - a.h || b.w - a.w);
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
const ATLAS_H = 2 ** Math.ceil(Math.log2(y + shelfH));
const buf = Buffer.alloc(ATLAS_W * ATLAS_H * 4);
const put = (px, py, rgb) => {
  const i = (py * ATLAS_W + px) * 4;
  buf[i] = rgb[0];
  buf[i + 1] = rgb[1];
  buf[i + 2] = rgb[2];
  buf[i + 3] = 255;
};
const frames = {};
for (const it of items) {
  const { s } = it;
  const ox = it.x + it.pad;
  const oy = it.y + it.pad;
  for (let j = -1; j <= s.h; j++)
    for (let i = -1; i <= s.w; i++) {
      const inside = i >= 0 && j >= 0 && i < s.w && j < s.h;
      if (!inside && !s.tile) continue;
      const sx = Math.min(Math.max(i, 0), s.w - 1);
      const sy = Math.min(Math.max(j, 0), s.h - 1);
      const p = pixelOf(s, sx, sy);
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

// ---- PNG（RGBA 8bit。zlib だけで書く） ----
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let r = 0; r < h; r++) {
    raw[r * (w * 4 + 1)] = 0;
    rgba.copy(raw, r * (w * 4 + 1) + 1, r * w * 4, (r + 1) * w * 4);
  }
  const chunk = (type, data) => {
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

const outDir = resolve(root, 'src/generated');
mkdirSync(outDir, { recursive: true });
const png = encodePng(ATLAS_W, ATLAS_H, buf);
writeFileSync(resolve(outDir, 'atlas.png'), png);
writeFileSync(
  resolve(outDir, 'atlas.json'),
  JSON.stringify({ frames, meta: { app: 'onsen-driller build-art', image: 'atlas.png', format: 'RGBA8888', size: { w: ATLAS_W, h: ATLAS_H }, scale: '1' } }, null, 1),
);
console.log(`build-art: ${sprites.length} sprites, atlas ${ATLAS_W}x${ATLAS_H}, ${png.length} bytes, palette used ${used.size}/${Object.keys(palette).length}`);

// ---- 確認用の拡大図（×8、市松模様の背景、名前順） ----
const pi = process.argv.indexOf('--preview');
if (pi >= 0 && process.argv[pi + 1]) {
  const S = 8;
  const gap = 4;
  const cols = 4;
  const cellW = 48 * S + gap * 2;
  const cellH = 24 * S + gap * 2;
  const rowsN = Math.ceil(sprites.length / cols);
  const W = cols * cellW;
  const H = rowsN * cellH;
  const pv = Buffer.alloc(W * H * 4);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const c = ((px >> 4) + (py >> 4)) & 1 ? 200 : 225;
      const i = (py * W + px) * 4;
      pv[i] = c;
      pv[i + 1] = c;
      pv[i + 2] = c;
      pv[i + 3] = 255;
    }
  sprites.forEach((s, k) => {
    const cx = (k % cols) * cellW + gap;
    const cy = Math.floor(k / cols) * cellH + gap;
    for (let j = 0; j < s.h; j++)
      for (let i = 0; i < s.w; i++) {
        const p = pixelOf(s, i, j);
        if (!p) continue;
        for (let yy = 0; yy < S; yy++)
          for (let xx = 0; xx < S; xx++) {
            const q = ((cy + j * S + yy) * W + (cx + i * S + xx)) * 4;
            pv[q] = p[0];
            pv[q + 1] = p[1];
            pv[q + 2] = p[2];
            pv[q + 3] = 255;
          }
      }
  });
  const out = resolve(process.argv[pi + 1]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(W, H, pv));
  console.log(`build-art: preview -> ${out}`);
}
