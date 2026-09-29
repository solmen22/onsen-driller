// ポータルの枠（iframe）を模した親ページの HTML（BL-097・BL-101）。
// - 同じオリジンの版: e2e/support/frame.ts が page.route で返す（TS-012-18・TS-042-02）
// - 別オリジンの版（TS-012-26・27）: e2e のサーバー（e2e/support/serve.mjs）が PARENT_PATH で返す。
//   page.route で返した localhost の親ページは、Chromium がローカルのアドレスと見なさず（応答に IP がない）、
//   ループバック（127.0.0.1）のゲームを枠に入れる要求を Local Network Access で止める（2026-09-29 の実測:
//   「公開ページでローカル ネットワーク上のデバイスまたはサーバーへの接続が開始されたため、接続がブロックされました」）。
//   本物のサーバーの応答にすると、親も枠もループバックで、実際のポータル（親も枠も公開のサイト）と同じく止まらない。
// serve.mjs（Node）が型を外して読むので、型の注釈だけの TypeScript で書く（enum・namespace などを使わない）。
// 親ページには実際のポータルと同じく viewport の meta を置く（PR #7 のレビュー S-1）。
// - 無いと mobile-safari で縮小表示になり、scrollTo(0, 400) の後の scrollY が 398 になる
// - minimum-scale=1 が無いと、枠（800px）が画面より広い mobile-chrome で、レイアウトのビューポートが中身に合わせて広がり
//   （801×1630）、↓ が視覚のビューポートだけを動かして scrollY が変わらない（TS-012-18 の対照が落ちる）

export const PARENT_PATH = '/__e2e_parent';

export interface ParentPage {
  /** 枠（iframe）の大きさ（CSS ピクセル） */
  width: number;
  height: number;
  /** 親ページの本文の高さ（縦に長いポータルのページ） */
  parentHeight: number;
  /** 枠の左上（親ページの座標） */
  left: number;
  top: number;
  /** 枠の src（'/'＝親と同じオリジン、または http(s) の絶対 URL） */
  gameSrc: string;
}

const escapeAttr = (s: string): string =>
  s.replace(/[&"<>]/g, (c) => (c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;'));

export function parentHtml(o: ParentPage): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1"><title>e2e portal</title>
<style>
  html, body { margin: 0; }
  body { height: ${o.parentHeight}px; position: relative; background: #ccc; font: 14px sans-serif; }
  #game { position: absolute; left: ${o.left}px; top: ${o.top}px; width: ${o.width}px; height: ${o.height}px; border: 0; display: block; }
</style></head>
<body><p id="above">portal page</p><iframe id="game" src="${escapeAttr(o.gameSrc)}" title="game"></iframe></body></html>`;
}

/** e2e のサーバーに渡す問い合わせの文字列（serve.mjs の parentFromQuery と対） */
export function parentQuery(o: ParentPage): string {
  return new URLSearchParams({
    w: String(o.width),
    h: String(o.height),
    ph: String(o.parentHeight),
    left: String(o.left),
    top: String(o.top),
    src: o.gameSrc,
  }).toString();
}

/** 問い合わせの文字列から親ページの設定を読む（数でない値・http(s) でも '/' でもない src は例外） */
export function parentFromQuery(q: URLSearchParams): ParentPage {
  const num = (k: string): number => {
    const v = Number(q.get(k));
    if (!Number.isFinite(v) || v < 0) throw new Error(`${PARENT_PATH}: ${k} が数ではありません: ${String(q.get(k))}`);
    return v;
  };
  const src = q.get('src') ?? '/';
  if (src !== '/' && !/^https?:\/\//.test(src)) throw new Error(`${PARENT_PATH}: src は '/' か http(s) の URL: ${src}`);
  return { width: num('w'), height: num('h'), parentHeight: num('ph'), left: num('left'), top: num('top'), gameSrc: src };
}
