// E2E: BL-042 レイアウト（縦・横）と HUD（BL-042_layout-hud.md）の S1 の e2e — TS-042-02・05・08・09・11
// - TS-042-10（起動直後にタイトル画面・開始ボタン・独自の全画面ボタンがなく、全画面を要求しない）は、ほぼ同じ E1 の TS-E1-12 に
//   「0 クリックの時点の確認」を足して統合した（e2e/e1-first-play.spec.ts。BL-042 の判定の記録の「TS-E1-01・12 に対応づけてよい」）
// - 縦横の判定・比率・HUD の中身は unit・integration（tests/unit/ui-layout.test.ts・tests/integration/ui-hud.test.ts）
// - 画面の状態は「起動直後」と「タブ 1〜5 を開いた状態」を順に調べる（S1 の画面のすべて）
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { forEachScreen, interactiveElements, visibleTexts } from './support/dom.ts';
import { openGameInFrame } from './support/frame.ts';

/** UI の更新（5Hz）と描画を待つ（時計は bootGame で止めてある） */
const settle = (page: Page) => () => page.clock.runFor(250);

test.describe('BL-042 レイアウトと HUD', () => {
  test('TS-042-02 iframe の大きさを 1280×720 → 600×900 → 1280×720 と変えると、再読み込みなしで横 → 縦 → 横に切り替わり、進行（stateHash）が変わらない', async ({
    page,
    isMobile,
  }) => {
    const { frame, g, resize } = await openGameInFrame(page, { width: 1280, height: 720 });
    await g.pause();
    await g.advance(5_000, { tapsPerSec: 2 }); // 進行のある状態
    const h0 = await g.stateHash();
    const root = frame.getByTestId('app-root');
    // 再読み込みされていないことの印（文書が入れ替われば消える）
    await frame.evaluate(() => {
      (window as unknown as { __e2eDoc?: number }).__e2eDoc = 1;
    });
    await expect(root).toHaveAttribute('data-layout', 'landscape');
    await resize(600, 900);
    await expect(root).toHaveAttribute('data-layout', 'portrait');
    await resize(1280, 720);
    await expect(root).toHaveAttribute('data-layout', 'landscape');
    expect(await frame.evaluate(() => (window as unknown as { __e2eDoc?: number }).__e2eDoc)).toBe(1);
    expect(await g.stateHash()).toBe(h0);
    if (isMobile) {
      // モバイルのエミュレーション（毎晩）: 端末の回転を模して縦横を入れ替える
      const vp = page.viewportSize()!;
      await resize(vp.width, vp.height);
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await resize(vp.height, vp.width);
      await expect(root).toHaveAttribute('data-layout', vp.height / vp.width >= 1.1 ? 'landscape' : 'portrait');
      await page.setViewportSize(vp);
      await resize(vp.width, vp.height);
      await expect(root).toHaveAttribute('data-layout', vp.width / vp.height >= 1.1 ? 'landscape' : 'portrait');
      expect(await g.stateHash()).toBe(h0);
    }
  });

  test.describe('800×450', () => {
    test.use({ viewport: { width: 800, height: 450 } });
    test('TS-042-05 800×450 で、表示中の DOM の文字がすべて 12px 相当以上で、はみ出さない（起動直後とタブ 1〜5）', async ({ page }) => {
      await bootGame(page);
      const small: string[] = [];
      const overflow: string[] = [];
      let measured = 0;
      let min = Infinity;
      const screens = await forEachScreen(
        page,
        async (name) => {
          const texts = await visibleTexts(page);
          expect(texts.length, `${name}: 文字のある要素がある`).toBeGreaterThan(0);
          measured += texts.length;
          for (const t of texts) {
            min = Math.min(min, t.px);
            if (t.px < 12) small.push(`${name} ${t.where} "${t.text}" ${t.px}px（font-size ${t.fontSize} × ${t.scale}）`);
            if (t.overflow) overflow.push(`${name} ${t.where} "${t.text}" scrollWidth ${t.scrollWidth} > clientWidth ${t.clientWidth}`);
          }
        },
        settle(page),
      );
      test.info().annotations.push({ type: '測った画面・要素の数・最小', description: `${screens.join('・')} / ${measured} 要素 / ${min}px` });
      expect(screens).toHaveLength(6);
      expect(small).toEqual([]);
      expect(overflow).toEqual([]);
    });
  });

  test.describe('390×844（タッチ）', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: async ({ browserName }, use) => {
        await use(browserName !== 'firefox');
      },
    });
    test('TS-042-08 390×844 で、操作できる要素すべての幅・高さが 44px 以上（btn-boost は状態によらず含む。起動直後とタブ 1〜5）', async ({ page }) => {
      await bootGame(page);
      const tooSmall: string[] = [];
      let measured = 0;
      const seenIds = new Set<string>();
      const screens = await forEachScreen(
        page,
        async (name) => {
          const els = (await interactiveElements(page)).filter((e) => e.visible);
          measured += els.length;
          for (const e of els) {
            if (e.testid) seenIds.add(e.testid);
            if (e.w < 44 || e.h < 44) tooSmall.push(`${name} ${e.testid ?? e.tag} "${e.label}" ${e.w}×${e.h}`);
          }
        },
        settle(page),
      );
      test.info().annotations.push({ type: '測った要素', description: `${measured} 件（${[...seenIds].join('・')}）` });
      expect(screens).toHaveLength(6);
      expect(seenIds.has('btn-boost'), 'btn-boost も測った').toBe(true);
      expect(seenIds.has('toggle-auto-dig')).toBe(true);
      expect(tooSmall).toEqual([]);
    });
  });

  test('TS-042-09 ルートとステージが user-select: none・touch-action（manipulation が効く）、高さ 100dvh・セーフエリアの余白があり、ステージを 1 秒長押ししても文字が選択されない', async ({
    page,
  }) => {
    await bootGame(page);
    const st = await page.evaluate(async () => {
      const pick = (el: Element) => {
        const cs = getComputedStyle(el) as CSSStyleDeclaration & { webkitTouchCallout?: string; webkitUserSelect?: string };
        return { userSelect: cs.userSelect || cs.webkitUserSelect || '', touchAction: cs.touchAction, touchCallout: cs.webkitTouchCallout ?? null };
      };
      const rules: string[] = [];
      for (const sheet of [...document.styleSheets]) {
        try {
          for (const r of [...sheet.cssRules]) rules.push(r.cssText);
        } catch {
          /* 別オリジンのスタイルシートは読めない（本作には無い） */
        }
      }
      const appRule = rules.filter((t) => /^#app\s*\{/.test(t)).join('\n');
      // 解釈する前の CSS の文（同じオリジンの <link rel="stylesheet"> を読み直す）の #app の規則。エンジンが知らない性質も残る（BL-111）
      const raw: string[] = [];
      for (const link of [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]) {
        if (new URL(link.href).origin !== location.origin) continue;
        const text = await (await fetch(link.href)).text();
        for (const m of text.matchAll(/(?:^|[}\s,;])#app\s*\{([^}]*)\}/g)) raw.push(m[1] ?? '');
      }
      return {
        root: pick(document.querySelector('[data-testid="app-root"]')!),
        stage: pick(document.querySelector('[data-testid="stage"]')!),
        appRule,
        rawAppRule: raw.join('\n'),
        supportsCallout: typeof CSS !== 'undefined' && CSS.supports('-webkit-touch-callout', 'none'),
      };
    });
    test.info().annotations.push({ type: '計算済みのスタイル', description: JSON.stringify({ root: st.root, stage: st.stage }) });
    test.info().annotations.push({ type: '-webkit-touch-callout', description: `CSS.supports=${st.supportsCallout}・計算済み=${st.root.touchCallout}` });
    expect(st.root.userSelect).toBe('none');
    expect(st.stage.userSelect).toBe('none');
    expect(st.root.touchAction).toBe('manipulation');
    // ステージは touch-action: none（manipulation より強い制限。タッチの動作は祖先との共通部分になるので、manipulation の制限〔ダブルタップの拡大なし〕も効く）
    expect(['manipulation', 'none']).toContain(st.stage.touchAction);
    // -webkit-touch-callout: none（iOS の Safari で長押しの OS のメニューを出さない。iOS だけの性質）。
    // この性質を持たないエンジン（Windows の Playwright の WebKit などは CSS.supports が false）は、解釈した時点で宣言を捨てるので、
    // 計算済みの値にも cssRules の文にも残らない（PR #23 のレビュー ③。BL-111）。そこで配信した CSS の文（解釈する前）で、
    // #app の規則にあることを全プロジェクトで確かめる。計算済みの値は、エンジンがこの性質を持つときだけ見る。
    // 実際の効果（長押しで OS のメニューが出ない）はオーナーの iPhone の確認（TS-042-14）で見る
    expect(st.rawAppRule, '配信した CSS の #app の規則に -webkit-touch-callout: none がある').toMatch(/-webkit-touch-callout\s*:\s*none/);
    if (st.supportsCallout) expect(st.root.touchCallout).toBe('none');
    // 高さ 100dvh とセーフエリアの余白（スタイルシートの規則。計算済みの値は px になるので規則の文で見る）
    expect(st.appRule).toContain('100dvh');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(st.appRule).toContain(`env(safe-area-inset-${side})`);
    // ステージを 1 秒長押しする → 文字の選択が起きない
    const box = (await page.getByTestId('stage').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.mouse.down();
    await page.clock.runFor(1_000);
    await page.mouse.up();
    // 押したまま HUD の上まで動かしても選択されない（ドラッグでの選択）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
    await page.mouse.down();
    const hud = (await page.getByTestId('hud').boundingBox())!;
    await page.mouse.move(hud.x + 5, hud.y + 5, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  });

  test('TS-042-11 操作できる要素（button・a[href]・input・select・textarea・[role=button]・[tabindex]）すべてに空でない data-testid がある（起動直後とタブ 1〜5）', async ({
    page,
  }) => {
    await bootGame(page);
    const missing: string[] = [];
    let measured = 0;
    const screens = await forEachScreen(
      page,
      async (name) => {
        // 表示中でないものも含めて DOM にある操作できる要素すべて
        const els = await interactiveElements(page);
        measured += els.length;
        for (const e of els) if (!e.testid || !e.testid.trim()) missing.push(`${name} <${e.tag}> "${e.label}"`);
      },
      settle(page),
    );
    test.info().annotations.push({ type: '調べた要素', description: `${measured} 件（${screens.join('・')}）` });
    expect(screens).toHaveLength(6);
    expect(measured).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
