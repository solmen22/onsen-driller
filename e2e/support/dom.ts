// 画面の DOM を調べる補助（BL-097。E1 の TS-E1-12・BL-042 の TS-042-05・08・10・11・BL-035 の描画の確認で共用）
import type { Frame, Page } from '@playwright/test';

type Target = Page | Frame;

/** 画面の要素のうち、全画面を思わせるボタン（テキスト・aria-label・data-testid・title） */
export async function fullscreenButtons(page: Target): Promise<string[]> {
  return (page as Frame).evaluate(() =>
    [...document.querySelectorAll('button, [role="button"], a, input[type="button"]')]
      .map((el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('title')].join(' '))
      .filter((s) => /full\s*-?\s*screen|全画面/i.test(s)),
  );
}

/**
 * タイトル画面・開始の前置きを思わせる要素（TS-042-10）
 * - ボタン・リンクの文字・aria-label・data-testid・title が「Start」「Play」「Begin」「Tap to start」「Click to play」「Press any key」
 *   「開始」「スタート」「はじめる」「プレイ」など
 * - 要素の data-testid・id・class が「title-screen」「splash」「start-screen」「overlay」など（文字の中身は見ない。
 *   遊び方の案内「Tap to dig」のような文は開始の前置きではない）
 */
export async function startScreenElements(page: Target): Promise<string[]> {
  return (page as Frame).evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('button, [role="button"], a, input[type="button"]')) {
      const s = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('title')].join(' ');
      if (/\b(start|play|begin)\b|(tap|click|touch) to (start|play|begin|continue)|press any key|開始|スタート|はじめる|プレイ/i.test(s)) out.push(`button: ${s.trim()}`);
    }
    for (const el of document.querySelectorAll('[data-testid], [id], [class]')) {
      const s = [el.getAttribute('data-testid'), el.id, el.getAttribute('class')].join(' ');
      if (/title[-_]?screen|splash|start[-_]?(screen|button|overlay)|overlay/i.test(s)) out.push(`element: ${s.trim()}`);
    }
    return out;
  });
}

/** TS-042-11 の「操作できる要素」 */
export const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

export interface InteractiveInfo {
  tag: string;
  testid: string | null;
  label: string;
  visible: boolean;
  disabled: boolean;
  w: number;
  h: number;
}

/** 操作できる要素（表示中かどうか・大きさつき） */
export async function interactiveElements(page: Target): Promise<InteractiveInfo[]> {
  return (page as Frame).evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible =
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== 'hidden' &&
        cs.display !== 'none' &&
        (typeof (el as HTMLElement).checkVisibility !== 'function' || (el as HTMLElement).checkVisibility());
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        label: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30),
        visible,
        disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
      };
    });
  }, INTERACTIVE_SELECTOR);
}

export interface TextInfo {
  /** 要素の data-testid か、無ければ祖先の data-testid＋タグ */
  where: string;
  text: string;
  /** 計算済みの font-size × 祖先の transform の倍率（px） */
  px: number;
  fontSize: number;
  scale: number;
  /** 文字が要素の幅からはみ出しているか（scrollWidth > clientWidth） */
  overflow: boolean;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * 表示中で文字を持つ DOM の要素ごとの、文字の大きさとはみ出し（TS-042-05。PM の Q-20 回答の測り方）。
 * - 文字を持つ＝空白でない文字のテキストノードを直接の子に持つ
 * - 倍率＝getBoundingClientRect().height ÷ offsetHeight（祖先の transform の倍率）
 * - display: none・visibility: hidden・大きさ 0・画面の外の要素は除く。キャンバスの中の文字は DOM に無いので対象外
 */
export async function visibleTexts(page: Target): Promise<TextInfo[]> {
  return (page as Frame).evaluate(() => {
    const out: TextInfo[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (!(el instanceof HTMLElement)) continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue; // 画面の外
      const fontSize = parseFloat(cs.fontSize);
      const scale = el.offsetHeight > 0 ? r.height / el.offsetHeight : 1;
      const tid = el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
      out.push({
        where: `${tid}>${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(/\s+/).join('.')}` : ''}`,
        text: text.slice(0, 40),
        px: Math.round(fontSize * scale * 100) / 100,
        fontSize,
        scale: Math.round(scale * 1000) / 1000,
        overflow: el.clientWidth > 0 && el.scrollWidth > el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
    return out;
  });
}

/** 画面の状態（起動直後と、タブ 1〜5 を開いた状態）を順に作って fn を呼ぶ。タブは data-testid の tab-1〜5（Q-17） */
export async function forEachScreen(page: Page, fn: (name: string) => Promise<void>, settle: () => Promise<void>): Promise<string[]> {
  const names: string[] = [];
  names.push('起動直後');
  await fn('起動直後');
  for (let i = 1; i <= 5; i++) {
    const tab = page.getByTestId(`tab-${i}`);
    if ((await tab.count()) === 0) continue;
    await tab.click();
    await settle();
    names.push(`tab-${i}`);
    await fn(`tab-${i}`);
  }
  return names;
}

/**
 * PNG（page.screenshot の出力）の色の数と、最も多い色の割合を、ページの中の 2D キャンバスで数える（真っ黒・真っ白の検出。TS-035-09）。
 * 画素は 1 つおきに間引いて数える
 */
export async function pngColorStats(page: Page, png: Buffer): Promise<{ w: number; h: number; colors: number; dominantShare: number }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d のコンテキストがない');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const count = new Map<number, number>();
    let n = 0;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const k = ((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0);
        count.set(k, (count.get(k) ?? 0) + 1);
        n++;
      }
    }
    const top = Math.max(...count.values());
    return { w: c.width, h: c.height, colors: count.size, dominantShare: Math.round((top / Math.max(1, n)) * 1000) / 1000 };
  }, png.toString('base64'));
}
