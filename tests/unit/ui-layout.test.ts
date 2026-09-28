// BL-042: 縦・横の判定と領域の割合（ui/layout.ts の layoutOf。TS-042-01・03）と、スタイルシートの要件（TS-042-04・09 の静的な確認）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyLayout, LANDSCAPE_MIN_RATIO, layoutOf, PANEL_SHARE_PORTRAIT, STAGE_SHARE_LANDSCAPE } from '../../src/ui/layout.ts';

describe('layoutOf（TS-042-01・03）', () => {
  it('横 ÷ 縦が 1.1 以上なら横、未満なら縦（境界 1.10 は横・1.099 は縦）', () => {
    expect(LANDSCAPE_MIN_RATIO).toBe(1.1);
    expect(layoutOf(1100, 1000).name).toBe('landscape');
    expect(layoutOf(1099, 1000).name).toBe('portrait');
    expect(layoutOf(1920, 1080).name).toBe('landscape');
    expect(layoutOf(800, 450).name).toBe('landscape');
    expect(layoutOf(1280, 720).name).toBe('landscape');
    expect(layoutOf(390, 844).name).toBe('portrait');
    expect(layoutOf(844, 390).name).toBe('landscape'); // 回転
  });
  it('大きさが 0・負・数でないときは縦（例外にしない）', () => {
    for (const [w, h] of [
      [0, 0],
      [800, 0],
      [-1, 450],
      [Number.NaN, 450],
      [800, Number.POSITIVE_INFINITY],
    ] as const)
      expect(layoutOf(w, h).name).toBe('portrait');
  });
  it('横はキャンバス（HUD の帯を含む左の列）約 58%・パネル約 42%（±3 ポイント）', () => {
    for (const [w, h] of [
      [1280, 720],
      [1920, 1080],
      [800, 450],
    ] as const) {
      const l = layoutOf(w, h);
      expect(Math.abs(l.stageShare - 0.58)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(l.panelShare - 0.42)).toBeLessThanOrEqual(0.03);
      expect(l.stageShare + l.panelShare).toBeCloseTo(1, 10);
    }
    expect(STAGE_SHARE_LANDSCAPE).toBe(0.58);
  });
  it('縦は一覧とタブバーが高さの約 44%', () => {
    const l = layoutOf(390, 844);
    expect(l.panelShare).toBe(PANEL_SHARE_PORTRAIT);
    expect(l.stageShare + l.panelShare).toBeCloseTo(1, 10);
  });
});

describe('applyLayout', () => {
  /** HTMLElement の代わり（dataset と style.setProperty だけ） */
  const fakeEl = () => {
    const props = new Map<string, string>();
    return { el: { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => props.set(k, v) } }, props };
  };
  it('data-layout と CSS 変数（--stage-share・--panel-share）を写し、変わらなければ何もしない', () => {
    const { el, props } = fakeEl();
    const target = el as unknown as HTMLElement;
    expect(applyLayout(target, layoutOf(800, 450))).toBe(true);
    expect(el.dataset['layout']).toBe('landscape');
    expect(props.get('--stage-share')).toBe('58%');
    expect(props.get('--panel-share')).toBe('42%');
    expect(applyLayout(target, layoutOf(1920, 1080))).toBe(false);
    expect(applyLayout(target, layoutOf(390, 844))).toBe(true);
    expect(el.dataset['layout']).toBe('portrait');
    expect(props.get('--panel-share')).toBe('44%');
  });
});

describe('スタイルシート（styles/global.css）の要件', () => {
  const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');
  const block = (selector: string): string => {
    const i = css.indexOf(`${selector} {`);
    if (i < 0) throw new Error(`${selector} がない`);
    return css.slice(i, css.indexOf('}', i));
  };
  it('縦は上から HUD → キャンバス → 一覧（パネル）。パネルの中はタブバーが下（TS-042-04 の静的な確認）', () => {
    expect(block("#app[data-layout='portrait']").replace(/\s+/g, ' ')).toContain("grid-template-areas: 'hud' 'stage' 'panel'");
    expect(block("#app[data-layout='portrait'] .panel")).toContain('flex-direction: column-reverse');
  });
  it('横は左の列が HUD の帯とキャンバス、右の列がパネル。HUD はキャンバスと別の領域（重ねない）', () => {
    expect(block("#app[data-layout='landscape']").replace(/\s+/g, ' ')).toContain("grid-template-areas: 'hud panel' 'stage panel'");
    expect(block('.hud')).toContain('grid-area: hud');
  });
  it('ルートに -webkit-touch-callout: none・user-select: none・touch-action: manipulation・100dvh・セーフエリアの余白（TS-042-09 の静的な確認）', () => {
    const app = block('#app');
    for (const decl of ['-webkit-touch-callout: none', 'user-select: none', '-webkit-user-select: none', 'touch-action: manipulation', 'height: 100dvh'])
      expect(app).toContain(decl);
    for (const side of ['top', 'right', 'bottom', 'left']) expect(app).toContain(`env(safe-area-inset-${side})`);
  });
  it('DOM の文字は 12px 以上（font-size の指定に 12px 未満がない。TS-042-05 の補助。本判定は e2e）', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    expect(css).not.toMatch(/font-size:\s*\d*\.?\d+(em|rem|%)/);
  });
  it('押せるもの（ボタン・タブ・購入数・一覧の行・下端のボタン）は 44px 以上（TS-042-08 の補助。本判定は e2e）', () => {
    for (const sel of ['.hud-settings,\n.chip-vein', '.act', '.qty-btn', '.row'])
      expect(block(sel)).toMatch(/min-height: (4[4-9]|[5-9]\d)px/);
    expect(block('.tab')).toMatch(/min-height: (4[4-9]|[5-9]\d)px/);
  });
});
