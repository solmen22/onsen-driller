// E2E: BL-036 地下の描画（BL-036_underground-render.md）の S1 の e2e — TS-036-02・08（TS-036-08 は BL-071 の TS-071-07 と共用）
// - TS-036-02 は 2 つに分ける（PR の e2e の時間のため。QA の記録は org/30_quality/qa-lead/2026-10-18_e2e-time-trigger.md §3-1 の 1-3）
//   - (a) PR: grant({depth}) で深さを置いて読む。浅い所 0〜29m と深い所 30・50・75・100m（カメラが道具の先を追うことを深い所でも PR で見る）
//   - (b) 毎晩（@nightly）: 0m → 100m を自動掘りで掘りながら 1 秒ごとに読む
// - ブラウザの要らない確認（スプライトの使い回し・ひび・ポップ・道具の見た目・補間）は unit（tests/unit/view-parts.test.ts など）
// - TS-036-08・TS-071-07 の Node 側の期待値は tests/replays/hook-seed42-60s.json（tests/unit/hook-replay.test.ts が core で確かめる）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { hitsOf, type Hooks } from './support/hooks.ts';
import { layerRects, TILE } from '../src/view/layout.ts';
import { SEED_A } from '../tests/helpers/seeds.ts';

interface HookReplayFile {
  seed: number;
  advanceMs: number;
  input: { tapsPerSec?: number; hold?: boolean };
  expectedHash: string;
}
const REPLAY = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'tests', 'replays', 'hook-seed42-60s.json'), 'utf8')) as HookReplayFile;

/** 描画の INTERP_MS（100ms）より長く、描画のフレームを進める（ロジックは __game.pause() で止めておく） */
const RENDER_MS = 150;

/** TS-036-02 の読み取りの準備（地下の範囲・1 ブロックの高さ）と判定 */
async function renderProbe(page: Page, g: Hooks) {
  const canvas = (await page.locator('[data-testid="stage"] canvas').boundingBox())!;
  const layer = layerRects(Math.round(canvas.height));
  // 地下の範囲（ビューポートの CSS ピクセル）。layerRects はキャンバスの画素なので、CSS との比で直す
  const ug = { top: canvas.y + (layer.underground.y * canvas.height) / Math.round(canvas.height), bottom: canvas.y + canvas.height, left: canvas.x, right: canvas.x + canvas.width };
  // 1 ブロック（1m）の画面の高さ: タイル × 表示の倍率 × キャンバスの CSS の拡大率
  const cssScale = canvas.width / (await page.evaluate(() => (document.querySelector('[data-testid="stage"] canvas') as HTMLCanvasElement).width));
  const blockPx = TILE * (await g.renderStats()).zoom * cssScale;
  const samples: string[] = [];
  const outside: string[] = [];
  const surfaceAt: number[] = [];

  /**
   * 判定（2026-09-29 のレビュー S-1 で見直し）
   * - 道具の先（矩形の下端＝掘っている所）は、どの深さでも地下の範囲の中（横もキャンバスの中）。
   * - 道具の全体が地下の範囲の中。ただし、カメラが地表で止まっている間（地面の線が地下の範囲の上端にある間）だけは、
   *   道具の上（柄）が地上の範囲にはみ出してよい（地下のカメラは地表より上を映さない作り: arch §14。道具は 1 ブロックより背が高いので、
   *   0m・1m では柄が地面の線より上に出る。レビューの実測 P1）。
   *   「地表で止まっている」は、道具の先が「地面の線＝地下の範囲の上端」から深さ d ブロックぶん下（d〜d+2 ブロック）にあることで確かめる
   *   （カメラが地表を離れて下に動いていれば、先はそれより上に来るので、柄のはみ出しを許さない）
   */
  const check = async (label: string, depth: number): Promise<void> => {
    const r = await g.rect('drill');
    if (!r) {
      outside.push(`${label} ${depth}m: rect が null`);
      return;
    }
    const tip = r.y + r.h;
    const tipInside = tip >= ug.top && tip <= ug.bottom && r.x >= ug.left && r.x + r.w <= ug.right;
    const fromGround = (tip - ug.top) / blockPx; // 地面の線が上端にあるとしたときの、先の深さ（ブロック）
    const surface = r.y < ug.top && fromGround >= depth - 0.05 && fromGround <= depth + 2;
    if (surface) surfaceAt.push(depth);
    samples.push(`${label} ${depth}m y=${Math.round(r.y)}..${Math.round(tip)}${r.y < ug.top ? `（柄が地上へ。先は地面から ${fromGround.toFixed(2)} ブロック）` : ''}`);
    if (!tipInside || (r.y < ug.top && !surface)) outside.push(`${label} ${depth}m: 道具 ${JSON.stringify(r)} 地下の範囲 ${JSON.stringify(ug)} 1 ブロック ${blockPx}px`);
  };

  /** 結果の注記と、共通の期待（範囲の外が 0 件。柄のはみ出しを許したのは、カメラが地表で止まっている浅い所だけ〔どの画面でも数ブロックまで〕） */
  const finish = (minSamples: number): void => {
    test.info().annotations.push({ type: 'TS-036-02 の道具の位置（深さ・上端〜下端）', description: samples.join(' / ') });
    test.info().annotations.push({ type: '地下の範囲・1 ブロック', description: `${JSON.stringify(ug)} ${blockPx}px` });
    expect(outside).toEqual([]);
    expect(samples.length).toBeGreaterThanOrEqual(minSamples);
    expect(surfaceAt.length).toBeGreaterThanOrEqual(1);
    expect(surfaceAt.length).toBeLessThanOrEqual(8);
    expect(surfaceAt.every((d) => d < 30), `柄のはみ出しを許したのは浅い所だけ（${surfaceAt.join('・')}m）`).toBe(true);
  };

  return { check, finish };
}

test.describe('BL-036 地下の描画', () => {
  test('TS-036-02 (a) 深さを置いて読む: 0〜29m と 30・50・75・100m で、道具の先がいつもキャンバスの地下の範囲の中に見えている（カメラが道具の先を追う）', async ({
    page,
  }) => {
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    const { check, finish } = await renderProbe(page, g);

    // grant({depth}) で深さを置いて読む（grant の深さは置き換え。描画は深さとブロックの進み具合だけから道具とカメラの位置を決め、
    // 変わった時点から INTERP_MS〔100ms〕で補間するので、RENDER_MS 進めれば掘って来た場合と同じ位置になる）。
    // - 浅い所（カメラが地表に止まっている所から、道具を追い始める所まで）: 強いドリルで掘ると 1 秒で 0m → 30m に進み、
    //   この範囲を一度も読まない（レビュー S-1。カメラが 25m まで追わない変更で緑のままだった）
    // - 深い所（帯 2〔30m〕・帯 3〔80m〕の前後と 100m）: カメラが道具の先を追い続けることを PR で見る（掘りながらの読み取りは (b)・毎晩）
    await page.clock.runFor(RENDER_MS);
    await check('浅い所', 0);
    for (const d of [1, 2, 3, 4, 6, 8, 12, 16, 20, 25, 29, 30, 50, 75, 100]) {
      await g.grant({ depth: d });
      await page.clock.runFor(RENDER_MS);
      expect((await g.getState()).run.depth).toBe(d);
      await check(d < 30 ? '浅い所' : '深い所', d);
    }
    finish(16); // 浅い所 12 点＋深い所 4 点
  });

  test('TS-036-02 (b) 0m → 100m を自動掘りで掘りながら 1 秒ごとに読み、道具の先がいつもキャンバスの地下の範囲の中に見えている @nightly', async ({
    page,
  }) => {
    test.slow(); // 毎晩の webkit・mobile で 1 件の上限 60 秒に届きうる（QA 判定書 2026-10-18_e2e-time-trigger.md §3-0）
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    const { check, finish } = await renderProbe(page, g);

    // 0m → 100m を自動掘りで掘りながら 1 秒ごとに読む。100m まで約 20 秒で届く強さ（ドリル Lv 80: 威力 81×2^3×1.5＝972。自動掘り 毎秒 2 打）。
    // 1 秒ごとの読み取りのたびに描画のフレームを約 9 回描くので、読み取りの回数が CI（GPU なし・ソフトウェアの WebGL）の時間に効く
    // （Lv 60〔100m まで 53 秒・54 回〕では PR #6 の CI で 45.6 秒かかった）
    await g.grant({ coins: '1e9' });
    expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
    for (let i = 0; i < 8; i++) expect((await g.dispatch({ type: 'buy', item: 'drill', qty: 10 })).ok).toBe(true);
    expect((await g.dispatch({ type: 'setAutoDig', on: true })).ok).toBe(true);
    let depth = (await g.getState()).run.depth;
    expect(depth).toBe(0);
    let seconds = 0;
    await page.clock.runFor(RENDER_MS);
    for (;;) {
      await check(`${seconds}s`, depth);
      if (depth >= 100) break;
      expect(seconds, '120 秒以内に 100m に届く').toBeLessThan(120);
      await g.advance(1_000);
      seconds++;
      await page.clock.runFor(RENDER_MS);
      depth = (await g.getState()).run.depth;
    }
    finish(10); // 掘りながら 10 回以上（0m・帯 2〔30m〕・帯 3〔80m〕の境目を越える間）
  });

  test('TS-036-08・TS-071-07 描画が動いている状態で seed(42) → pause() → advance(60000, {tapsPerSec: 2}) の stateHash が 2 回とも同じで、Node の core の値と一致する', async ({
    page,
  }) => {
    const g = await bootGame(page);
    // 1 回目: 前後で描画のフレームを回す（描画が core の状態を書き換えていれば、ここで食い違う）
    await g.seed(REPLAY.seed);
    await g.pause();
    await page.clock.runFor(500);
    await g.advance(REPLAY.advanceMs, REPLAY.input);
    await page.clock.runFor(500);
    const s1 = await g.getState();
    const h1 = await g.stateHash();
    // 2 回目（TS-071-07）
    await g.seed(REPLAY.seed);
    await g.pause();
    await g.advance(REPLAY.advanceMs, REPLAY.input);
    const h2 = await g.stateHash();
    test.info().annotations.push({ type: 'stateHash', description: `${h1} / ${h2}（Node ${REPLAY.expectedHash}）depth=${s1.run.depth} hits=${hitsOf(s1)}` });
    expect(hitsOf(s1)).toBe(120); // 60 秒・毎秒 2 打
    expect(h2).toBe(h1);
    expect(h1).toBe(REPLAY.expectedHash);
  });
});
