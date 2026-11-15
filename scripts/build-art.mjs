// 画素配列 → PNG・アトラス（arch §3-2 の `art`。BL-061）。固定パレット（32 色・4 つの組）と地形の配色（同じパレットの中の差し替え）の検査つき。
// 変換の本体は assets-src/pipeline.ts（tests/unit/art-pipeline.test.ts が同じ関数で、コミットした生成物と一致することを確かめる）。
// 使い方: node scripts/build-art.mjs [--preview <path.png>]
// 出力: src/generated/atlas.png・atlas.json（Phaser の JSON Hash 形式。Vite がハッシュ付きの名前で dist/*/assets に出す）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { buildArt, encodePng, pixelOf } = await import('../assets-src/pipeline.ts');
const { loadArtInput } = await import('../assets-src/sources.ts');
const input = await loadArtInput(JSON.parse(readFileSync(resolve(root, 'assets-src/palette.json'), 'utf8')));
const out = buildArt(input);
if (out.errors.length) {
  console.error(['build-art: 検査に失敗', ...out.errors.map((e) => ` - ${e}`)].join('\n'));
  process.exit(1);
}
const { sprites } = out;
const colors = input.palette.colors;

const outDir = resolve(root, 'src/generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'atlas.png'), out.png);
writeFileSync(resolve(outDir, 'atlas.json'), out.json);
console.log(
  `build-art: ${sprites.length} sprites, atlas ${out.atlas.width}x${out.atlas.height}, ${out.png.length} bytes, palette used ${out.used.size}/${Object.keys(colors).length}`,
);

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
        const p = pixelOf(s, colors, i, j);
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
  const previewPath = resolve(process.argv[pi + 1]);
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, encodePng(W, H, pv));
  console.log(`build-art: preview -> ${previewPath}`);
}
