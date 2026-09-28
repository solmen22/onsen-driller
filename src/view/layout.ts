// 描画の配置の計算（arch §14・Q-18。BL-035）。Phaser に依存しない純粋な関数（tests/unit/view-layout.test.ts）

/** 地層タイルの大きさ（アートの画素） */
export const TILE = 16;

/**
 * 表示の倍率（ステージの CSS の高さから。常に整数。Q-18）: 600px 以上 ×4、180px 以上 ×3、それ未満 ×2。
 * 例: 1280×720 → 4、800×450 → 3、1920×1080 → 4、390×844 の縦（ステージ約 473px）→ 3
 */
export function zoomFor(stageHeight: number): 2 | 3 | 4 {
  if (!(stageHeight >= 180)) return 2; // NaN も ×2
  return stageHeight >= 600 ? 4 : 3;
}

export interface LayerRects {
  /** 地上（上から round(高さ × 0.25)） */
  surface: { y: number; h: number };
  /** 地下（残り。合計は必ずキャンバスの高さ） */
  underground: { y: number; h: number };
}

/** 地上と地下の層の境目（キャンバスの画素。Q-18） */
export function layerRects(canvasHeight: number): LayerRects {
  const h = Number.isFinite(canvasHeight) && canvasHeight > 0 ? Math.floor(canvasHeight) : 0;
  const top = Math.round(h * 0.25);
  return { surface: { y: 0, h: top }, underground: { y: top, h: h - top } };
}

/** 直近 2 ステップの位置（深さ＋ブロックの進み具合）を、ステップの間の割合 alpha（0〜1）で線形に補間する */
export function interpolateDepth(prev: number, next: number, alpha: number): number {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  return prev + (next - prev) * a;
}

/**
 * 地下のカメラの中心（世界座標の y）。道具の先を地下の画面の上から toolAt（既定 30%）の高さに置き、
 * 残りの下の部分に「これから掘るところ」（鉱石のきらめき・源泉の気配）を見せる。地表より上は映さない
 */
export function undergroundCenterY(toolY: number, viewH: number, toolAt = 0.3): number {
  const c = toolY + (0.5 - toolAt) * viewH;
  return Math.max(c, viewH / 2);
}

/** 画面に見える分のタイルの行・列の数（カメラの移動で端が欠けないよう 1 行・1 列ずつ余分に持つ） */
export function tileGridSize(viewW: number, viewH: number, tile = TILE): { cols: number; rows: number } {
  const w = Number.isFinite(viewW) && viewW > 0 ? viewW : 0;
  const h = Number.isFinite(viewH) && viewH > 0 ? viewH : 0;
  return { cols: Math.ceil(w / tile) + 2, rows: Math.ceil(h / tile) + 2 };
}

export interface CameraView {
  /** カメラのビューポートの左上（キャンバスの画素） */
  x: number;
  y: number;
  /** 見えている世界の左上（世界座標） */
  worldX: number;
  worldY: number;
  zoom: number;
}

/** 世界座標の矩形 → ビューポートの CSS ピクセルの矩形（`__game.rect()`。canvasRect はキャンバスの getBoundingClientRect、scale は CSS 画素 ÷ キャンバス画素） */
export function projectRect(
  world: { x: number; y: number; w: number; h: number },
  cam: CameraView,
  canvasRect: { left: number; top: number },
  scale = 1,
): { x: number; y: number; w: number; h: number } {
  const px = (world.x - cam.worldX) * cam.zoom + cam.x;
  const py = (world.y - cam.worldY) * cam.zoom + cam.y;
  return { x: canvasRect.left + px * scale, y: canvasRect.top + py * scale, w: world.w * cam.zoom * scale, h: world.h * cam.zoom * scale };
}
