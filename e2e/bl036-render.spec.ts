// E2E: BL-036 地下の描画（BL-036_underground-render.md）の S1 の e2e — TS-036-02・08（TS-036-08 は BL-071 の TS-071-07 と共用）
// - ブラウザの要らない確認（スプライトの使い回し・ひび・ポップ・道具の見た目・補間）は unit（tests/unit/view-parts.test.ts など）
// - TS-036-08・TS-071-07 の Node 側の期待値は tests/replays/hook-seed42-60s.json（tests/unit/hook-replay.test.ts が core で確かめる）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures.ts';
import { bootGame } from './support/boot.ts';
import { hitsOf } from './support/hooks.ts';
import { layerRects } from '../src/view/layout.ts';
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

test.describe('BL-036 地下の描画', () => {
  test('TS-036-02 自動掘りで 0m → 100m まで掘る間、1 秒ごとに読んだ道具がいつもキャンバスの地下の範囲の中に見えている（カメラが道具の先を追う）', async ({
    page,
  }) => {
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    // 100m まで約 20 秒で届く強さ（ドリル Lv 80: 威力 81×2^3×1.5＝972）。自動掘り（毎秒 2 打）で掘る。
    // 1 秒ごとの読み取りのたびに描画のフレームを約 9 回描くので、読み取りの回数が CI（GPU なし・ソフトウェアの WebGL）の時間に効く
    // （Lv 60〔100m まで 53 秒・54 回〕では PR #6 の CI で 45.6 秒かかった。上限 60 秒）
    await g.grant({ coins: '1e9' });
    expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
    for (let i = 0; i < 8; i++) expect((await g.dispatch({ type: 'buy', item: 'drill', qty: 10 })).ok).toBe(true);
    expect((await g.dispatch({ type: 'setAutoDig', on: true })).ok).toBe(true);
    const canvas = (await page.locator('[data-testid="stage"] canvas').boundingBox())!;
    const layer = layerRects(Math.round(canvas.height));
    // 地下の範囲（ビューポートの CSS ピクセル）。layerRects はキャンバスの画素なので、CSS との比で直す
    const ug = { top: canvas.y + (layer.underground.y * canvas.height) / Math.round(canvas.height), bottom: canvas.y + canvas.height, left: canvas.x, right: canvas.x + canvas.width };
    const samples: string[] = [];
    const outside: string[] = [];
    let depth = (await g.getState()).run.depth;
    expect(depth).toBe(0);
    let seconds = 0;
    await page.clock.runFor(RENDER_MS);
    for (;;) {
      // 0 秒（0m）から、1 秒ごとに読む。
      // 判定: 道具の先（矩形の下端＝掘っている所）がいつも地下の範囲の中で、横もキャンバスの中。
      // 掘り始めた後（1m 以降）は道具の全体が地下の範囲の中。0m（掘る前）は、道具は地表に立っている作り
      // （mine-scene の道具は原点 0.9 で両方のカメラに映り、先が地面の線にある）ので、先だけを見る（実行記録に解釈を記録）
      const r = await g.rect('drill');
      if (!r) outside.push(`${seconds}s ${depth}m: rect が null`);
      else {
        const tip = r.y + r.h;
        samples.push(`${seconds}s ${depth}m y=${Math.round(r.y)}..${Math.round(tip)}`);
        const tipInside = tip >= ug.top && tip <= ug.bottom && r.x >= ug.left && r.x + r.w <= ug.right;
        const wholeInside = r.y >= ug.top && tipInside;
        if (!(depth === 0 ? tipInside : wholeInside)) outside.push(`${seconds}s ${depth}m: 道具 ${JSON.stringify(r)} 地下の範囲 ${JSON.stringify(ug)}`);
      }
      if (depth >= 100) break;
      expect(seconds, '120 秒以内に 100m に届く').toBeLessThan(120);
      await g.advance(1_000);
      seconds++;
      await page.clock.runFor(RENDER_MS);
      depth = (await g.getState()).run.depth;
    }
    test.info().annotations.push({ type: 'TS-036-02 の道具の位置（秒・深さ・上端〜下端）', description: samples.join(' / ') });
    test.info().annotations.push({ type: '地下の範囲', description: JSON.stringify(ug) });
    expect(outside).toEqual([]);
    expect(samples.length).toBeGreaterThanOrEqual(10); // 途中を十分な回数読んだ（0m・帯 2〔30m〕・帯 3〔80m〕の境目を越える間）
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
