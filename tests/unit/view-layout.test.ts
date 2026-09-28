// BL-035: 表示の倍率・2 層の境目・補間・カメラ・画面の矩形（TS-035-04・06、TS-036-03 の関数。Q-18）。Phaser に依存しない
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpolateDepth, layerRects, projectRect, TILE, tileGridSize, undergroundCenterY, zoomFor } from '../../src/view/layout.ts';

describe('TS-035-04 zoomFor（600px 以上 ×4、180px 以上 ×3、それ未満 ×2。常に整数）', () => {
  it('閾値の前後', () => {
    expect([599, 600, 601, 179, 180, 181].map(zoomFor)).toEqual([3, 4, 4, 2, 3, 3]);
  });
  it('代表の画面（1280×720・800×450・1920×1080・390×844 の縦のステージ約 473px）と、×3 でも入らない高さ', () => {
    expect([720, 450, 1080, 473, 100, 0, -5, Number.NaN].map(zoomFor)).toEqual([4, 3, 4, 3, 2, 2, 2, 2]);
    for (let h = 0; h < 2000; h += 7) expect(Number.isInteger(zoomFor(h))).toBe(true);
  });
});

describe('TS-035-06 layerRects（地上＝上から round(高さ × 0.25)、地下＝残り）', () => {
  it('450・720・1080・縦 473', () => {
    expect(layerRects(450)).toEqual({ surface: { y: 0, h: 113 }, underground: { y: 113, h: 337 } });
    expect(layerRects(720)).toEqual({ surface: { y: 0, h: 180 }, underground: { y: 180, h: 540 } });
    expect(layerRects(1080)).toEqual({ surface: { y: 0, h: 270 }, underground: { y: 270, h: 810 } });
    expect(layerRects(473)).toEqual({ surface: { y: 0, h: 118 }, underground: { y: 118, h: 355 } });
  });
  it('どの高さでも隙間と重なりがなく、合計がキャンバスの高さ', () => {
    for (let h = 0; h <= 2200; h++) {
      const r = layerRects(h);
      expect(r.underground.y).toBe(r.surface.h);
      expect(r.surface.h + r.underground.h).toBe(h);
      expect(Number.isInteger(r.surface.h)).toBe(true);
    }
    expect(layerRects(Number.NaN)).toEqual({ surface: { y: 0, h: 0 }, underground: { y: 0, h: 0 } });
  });
});

describe('TS-036-03 interpolateDepth（直近 2 ステップの間を線形に）', () => {
  it('割合 0 で前、1 で次、途中は線形。範囲外は端に丸める', () => {
    expect(interpolateDepth(10, 12, 0)).toBe(10);
    expect(interpolateDepth(10, 12, 1)).toBe(12);
    expect(interpolateDepth(10, 12, 0.5)).toBe(11);
    expect(interpolateDepth(10, 12, -1)).toBe(10);
    expect(interpolateDepth(10, 12, 3)).toBe(12);
    expect(interpolateDepth(10, 12, Number.NaN)).toBe(12);
  });
});

describe('地下のカメラ（道具の先を上から 30% に置き、地表より上は映さない）', () => {
  it('深いところでは道具が上から 30%、浅いところは画面の上端が地表', () => {
    const viewH = 100;
    const c = undergroundCenterY(1000, viewH);
    expect(1000 - (c - viewH / 2)).toBeCloseTo(30, 9);
    expect(undergroundCenterY(0, viewH)).toBe(50);
    expect(undergroundCenterY(10, viewH)).toBe(50);
  });
  it('道具を 0〜40 タイル（m）まで 1/4 タイルずつ動かすと、道具はいつも見える範囲の中で、地表を離れた後は上から 30%（BL-097 のレビュー S-1）', () => {
    // viewH は地下の見える高さ（世界の画素）: 1280×720（地下 499px・×4）、800×450（297px・×3）、390×844 の縦（314px・×3）、1920×1080（770px・×4）
    for (const viewH of [499 / 4, 297 / 3, 314 / 3, 770 / 4]) {
      let followed = false;
      for (let q = 0; q <= 40 * 4; q++) {
        const toolY = (q / 4) * TILE;
        const c = undergroundCenterY(toolY, viewH);
        const top = c - viewH / 2;
        expect(top, `viewH ${viewH} toolY ${toolY}: 地表より上を映さない`).toBeGreaterThanOrEqual(0);
        expect(toolY, `viewH ${viewH} toolY ${toolY}: 道具が見える範囲の中`).toBeGreaterThanOrEqual(top);
        expect(toolY, `viewH ${viewH} toolY ${toolY}: 道具が見える範囲の中`).toBeLessThanOrEqual(top + viewH * 0.3 + 1e-9);
        if (top > 0) {
          followed = true;
          expect(toolY - top, `viewH ${viewH} toolY ${toolY}: 地表を離れたら上から 30%`).toBeCloseTo(viewH * 0.3, 9);
        }
      }
      expect(followed, `viewH ${viewH}: 40 タイルまでに地表を離れて追い始める`).toBe(true);
    }
  });
  it('見える分のタイルの数は画面の大きさだけで決まる（深さによらない）', () => {
    expect(tileGridSize(426, 180)).toEqual({ cols: Math.ceil(426 / TILE) + 2, rows: Math.ceil(180 / TILE) + 2 });
    expect(tileGridSize(-1, Number.NaN)).toEqual({ cols: 2, rows: 2 });
  });
});

describe('projectRect（世界座標 → ビューポートの CSS ピクセル。rect("drill")）', () => {
  it('カメラのビューポート・倍率・キャンバスの位置と CSS の縮尺を反映する', () => {
    const r = projectRect({ x: -12, y: 100, w: 24, h: 24 }, { x: 0, y: 180, worldX: -80, worldY: 90, zoom: 4 }, { left: 10, top: 20 }, 0.5);
    expect(r).toEqual({ x: 10 + (68 * 4) * 0.5, y: 20 + (10 * 4 + 180) * 0.5, w: 48, h: 48 });
  });
});

describe('TS-035-05 Phaser の入力系を使わない（入力は DOM。arch §7）', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  it('src に setInteractive・this.input・input.on・input.keyboard がない', () => {
    const files = walk(resolve(process.cwd(), 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/setInteractive|this\.input\b|\binput\.on\(|input\.keyboard\b/);
    }
  });
});
