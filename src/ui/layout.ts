// レイアウトの判定（gdd §11-1・arch §15。BL-042）。縦・横の判定と領域の割合は、この純粋な関数だけで決める（tests/unit/ui-layout.test.ts）。
// CSS（styles/global.css）は #app の data-layout と、ここで決めた割合（CSS 変数 --stage-share・--panel-share）に従う。
// - 横（表示領域の横 ÷ 縦 ≥ 1.1）: 左の列（HUD の帯＋キャンバス）が約 58%、右の列（タブ・一覧）が約 42%
// - 縦（それ未満）: 上から HUD の帯 → キャンバス → 一覧 → タブバー。一覧とタブバーで高さの約 44%
// HUD はキャンバスに重ねず、キャンバスの上の帯に置く（地上の絵〔タヌキ・湯船〕を隠さないため。800×450 と縦画面で重なっていた）

export type LayoutName = 'landscape' | 'portrait';

/** 横レイアウトにする最小の横 ÷ 縦（この値ちょうどは横） */
export const LANDSCAPE_MIN_RATIO = 1.1;
/** 横: 左の列（HUD＋キャンバス）が画面の横幅に占める割合 */
export const STAGE_SHARE_LANDSCAPE = 0.58;
/** 縦: 一覧とタブバーが画面の高さに占める割合 */
export const PANEL_SHARE_PORTRAIT = 0.44;

export interface LayoutSpec {
  name: LayoutName;
  /** HUD＋キャンバスの割合（横なら横幅、縦なら高さに対して） */
  stageShare: number;
  /** タブ・一覧の割合（stageShare との合計は 1） */
  panelShare: number;
}

/** 表示領域の大きさ（CSS ピクセル）からレイアウトを決める。大きさが 0 以下・数でないときは縦 */
export function layoutOf(width: number, height: number): LayoutSpec {
  const ok = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (ok && width / height >= LANDSCAPE_MIN_RATIO)
    return { name: 'landscape', stageShare: STAGE_SHARE_LANDSCAPE, panelShare: round4(1 - STAGE_SHARE_LANDSCAPE) };
  return { name: 'portrait', stageShare: round4(1 - PANEL_SHARE_PORTRAIT), panelShare: PANEL_SHARE_PORTRAIT };
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** 判定の結果をルートの要素に写す（data-layout と CSS 変数）。変わらなければ何もしない。変わったら true */
export function applyLayout(el: HTMLElement, spec: LayoutSpec): boolean {
  if (el.dataset.layout === spec.name) return false;
  el.dataset.layout = spec.name;
  el.style.setProperty('--stage-share', `${round4(spec.stageShare * 100)}%`);
  el.style.setProperty('--panel-share', `${round4(spec.panelShare * 100)}%`);
  return true;
}
