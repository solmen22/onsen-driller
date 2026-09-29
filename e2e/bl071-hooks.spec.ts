// E2E: BL-071 テスト用フック window.__game（BL-071_test-hooks.md）の S1 の e2e — TS-071-01・04〜06・08・09・13・14・22、
// S2 の BL-089（繰り延べ）— TS-071-11・19・21。TS-071-10・12・16・18・20 は integration（QA リードの判断。traceability §6-4）
// - TS-071-03（本番に __game がない）の実行時の部分は e2e/bl007-prod-builds.spec.ts（TS-007-09 と共用。文字列の検査は check:size）
// - TS-071-07（advance の決定論と Node の期待値）は e2e/bl036-render.spec.ts の TS-036-08 と同じテスト（期待値は tests/replays/hook-seed42-60s.json）
// - シナリオの「実装のまとめ方」はページの読み込み 3 回程度を勧めているが、E1 と同じく ID ごとにテストを分けた
//   （起動は 1 回 約 0.5 秒で、分けても PR の時間は数十秒。失敗の場所が ID で分かる）
// フックの細部は技術リード・PM の Q-16 の回答（traceability.md §5-2）どおりに判定する
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './support/fixtures.ts';
import { bootGame, centerOf, pageNow, setHidden } from './support/boot.ts';
import { stateHashOracle, fnv1aOracle } from './support/hash.ts';
import { coinsOf, HOOK_MEMBERS, hitsOf, presentHookMembers, type GameEvent, type Hooks } from './support/hooks.ts';
import { newerOlder, readSlots } from './support/storage.ts';
import { zoomFor } from '../src/view/layout.ts';
import { SEED_A } from '../tests/helpers/seeds.ts';

const PKG_VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }).version;

/** ツルハシを買って自動掘りをオンにする（コインは grant で入れる。ロジックは止めたまま） */
async function autoDigOn(g: Hooks): Promise<void> {
  await g.grant({ coins: '10' });
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  expect((await g.dispatch({ type: 'setAutoDig', on: true })).ok).toBe(true);
}

const typesOf = (evs: GameEvent[]): string[] => evs.map((e) => e.type);

test.describe('BL-071 テスト用フック', () => {
  test('TS-071-01 window.__game に arch §8-4 のメンバーがすべてあり、version が package.json と一致、target が web', async ({ page }) => {
    const g = await bootGame(page);
    expect(await presentHookMembers(page)).toEqual([...HOOK_MEMBERS]);
    expect(await g.version()).toBe(PKG_VERSION);
    expect(await g.target()).toBe('web');
  });

  test('TS-071-04 getState() は JSON にでき、JSON を往復しても深く等しい（Decimal は文字列）', async ({ page }) => {
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    // 中身のある状態にする（コイン・深さ・道具・自動掘り・統計）
    await g.advance(20_000, { tapsPerSec: 2 });
    await autoDigOn(g);
    await g.advance(5_000);
    const r = await page.evaluate(() => {
      const s = (window as unknown as { __game: { getState(): unknown } }).__game.getState();
      const bad: string[] = [];
      const walk = (v: unknown, path: string): void => {
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
        if (typeof v === 'number') {
          if (!Number.isFinite(v)) bad.push(`${path}: ${v}`);
          return;
        }
        if (Array.isArray(v)) {
          v.forEach((x, i) => walk(x, `${path}[${i}]`));
          return;
        }
        if (typeof v === 'object') {
          const proto = Object.getPrototypeOf(v) as unknown;
          if (proto !== Object.prototype && proto !== null) bad.push(`${path}: プレーンなオブジェクトでない`);
          for (const [k, x] of Object.entries(v)) {
            if (x === undefined) bad.push(`${path}.${k}: undefined`);
            else walk(x, `${path}.${k}`);
          }
          return;
        }
        bad.push(`${path}: ${typeof v}`);
      };
      walk(s, 'state');
      const same = (a: unknown, b: unknown): boolean => {
        if (a === b) return true;
        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
      };
      const run = (s as { run: Record<string, unknown> }).run;
      const stats = (s as { stats: Record<string, unknown> }).stats;
      return {
        bad,
        roundTripEqual: same(s, JSON.parse(JSON.stringify(s))),
        decimals: { coins: typeof run['coins'], blockDmg: typeof run['blockDmg'], totalCoins: typeof stats['totalCoins'] },
      };
    });
    expect(r.bad).toEqual([]);
    expect(r.roundTripEqual).toBe(true);
    expect(r.decimals).toEqual({ coins: 'string', blockDmg: 'string', totalCoins: 'string' });
    // 中身のある状態で確かめた（初期状態だけでの合格でない）
    const s = await g.getState();
    expect(s.run.drill.tool).toBe(1);
    expect(s.run.autoDig.on).toBe(true);
    expect(s.run.depth).toBeGreaterThan(0);
  });

  test('TS-071-05 stateHash() は 2 回・setState(getState()) の後も同じで、getState() の JSON から計算した FNV-1a と一致する', async ({ page }) => {
    // 検算の実装そのものの確認（Q-10 の例）
    expect(fnv1aOracle('')).toBe('811c9dc5');
    expect(fnv1aOracle('a')).toBe('e40c292c');
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    await g.advance(15_000, { tapsPerSec: 2 });
    await autoDigOn(g);
    await g.advance(3_000);
    const h1 = await g.stateHash();
    const h2 = await g.stateHash();
    const s = await g.getState();
    await g.setState(s);
    const h3 = await g.stateHash();
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    expect([h2, h3]).toEqual([h1, h1]);
    expect(stateHashOracle(s)).toBe(h1);
    expect(stateHashOracle(await g.getState())).toBe(h3);
  });

  test('TS-071-06 seed(42) の直後の stateHash は何度取っても同じで、seed(43) では違う', async ({ page }) => {
    const g = await bootGame(page);
    await g.pause();
    await g.seed(42);
    const a1 = await g.stateHash();
    const a2 = await g.stateHash();
    const run42 = (await g.getState()).run.seed; // 周回のシード（createInitialState が seed から作る）
    await g.advance(3_000, { tapsPerSec: 2 }); // 間で状態を変えても
    expect(await g.stateHash()).not.toBe(a1);
    await g.seed(42); // もう一度 42 で始めると同じ
    const a3 = await g.stateHash();
    expect((await g.getState()).run.seed).toBe(run42);
    await g.seed(43);
    const b = await g.stateHash();
    expect((await g.getState()).run.seed).not.toBe(run42);
    expect([a2, a3]).toEqual([a1, a1]);
    expect(b).not.toBe(a1);
  });

  test('TS-071-08 自動掘りオンで pause() の間は page.clock.runFor(2000) でも stateHash が変わらず、resume() の後は変わる', async ({ page }) => {
    const g = await bootGame(page, { seed: SEED_A });
    await g.pause();
    await autoDigOn(g);
    const s0 = await g.getState();
    const h0 = await g.stateHash();
    await page.clock.runFor(2_000);
    expect(await g.stateHash()).toBe(h0);
    expect(hitsOf(await g.getState())).toBe(hitsOf(s0));
    await g.resume();
    await page.clock.runFor(2_000);
    const s2 = await g.getState();
    test.info().annotations.push({ type: 'resume の後 2 秒の打撃', description: String(hitsOf(s2) - hitsOf(s0)) });
    expect(await g.stateHash()).not.toBe(h0);
    // 自動掘り（毎秒 2 打）が実時間のループで動いた
    expect(hitsOf(s2) - hitsOf(s0)).toBeGreaterThanOrEqual(3);
    expect(s2.clock.playedMs).toBeGreaterThan(s0.clock.playedMs);
  });

  test('TS-071-09 時計を止めたまま advance(35000, {hold: true}) を深さ 29m から → ロジックだけが進み、BlockBroken と StratumEntered が返る', async ({ page }) => {
    const g = await bootGame(page); // bootGame が page.clock.pauseAt で時計を止めている
    await g.pause();
    await g.grant({ depth: 29 });
    const played0 = (await g.getState()).clock.playedMs; // 起動から pause までにループが進めた分（0 とは限らない）
    const wall0 = await pageNow(page);
    const started = Date.now();
    const evs = await g.advance(35_000, { hold: true });
    const took = Date.now() - started;
    test.info().annotations.push({ type: 'advance(35000) の実時間(ms)', description: String(took) });
    const types = typesOf(evs);
    expect(types).toContain('BlockBroken');
    const entered = evs.filter((e) => e.type === 'StratumEntered');
    expect(entered).toHaveLength(1);
    expect(entered[0]?.band).toBe(1); // 帯 2（粘土層。30m から。帯の番号は 0 始まり）
    // 起きた順: 29m のブロックが壊れてから帯 2 に入る
    expect(types.indexOf('BlockBroken')).toBeLessThan(types.indexOf('StratumEntered'));
    const s = await g.getState();
    expect(s.run.depth).toBeGreaterThanOrEqual(30);
    expect(s.clock.playedMs - played0).toBe(35_000);
    // 実時間を待たない（35 秒のロジックを数秒以内に）・ページの時計は止まったまま
    expect(took).toBeLessThan(5_000);
    expect(await pageNow(page)).toBe(wall0);
  });

  test('TS-071-13 grant: コインとチケットは足す（チケットは 10 で止まる）、深さは置き換え（最深は大きいほう。飛ばした帯・源泉のイベントは出さない）', async ({ page }) => {
    const g = await bootGame(page);
    await g.pause();
    await g.seed(7); // 新しいゲーム
    const s0 = await g.getState();
    expect(coinsOf(s0)).toBe(0);
    expect(s0.meta.tickets).toBe(2);
    await g.grant({ coins: '1e6' });
    expect(coinsOf(await g.getState())).toBe(1e6);
    await g.grant({ coins: '1e6' }); // 足す（置き換えでない。Q-16）
    expect(coinsOf(await g.getState())).toBe(2e6);
    await g.grant({ tickets: 3 });
    expect((await g.getState()).meta.tickets).toBe(5);
    await g.grant({ tickets: 10 });
    expect((await g.getState()).meta.tickets).toBe(10); // 上限 10
    const ev0 = (await g.events()).length;
    await g.grant({ depth: 29 });
    let s = await g.getState();
    expect([s.run.depth, s.run.maxDepth]).toEqual([29, 29]);
    // 飛ばした深さの帯・源泉（Q-16）: 29m までに源泉・帯の境目はないので、何も起きない
    expect(s.run['stratumSeen']).toEqual([0]);
    expect(s.run['springs']).toEqual({});
    // 帯・源泉の境目を飛ばす（30m の帯 2・単純温泉、80m の帯 3・二酸化炭素泉）: 入った・見つけたことになるが、イベントは出さない
    await g.grant({ depth: 80 });
    s = await g.getState();
    expect([s.run.depth, s.run.maxDepth]).toEqual([80, 80]);
    expect(s.run['stratumSeen']).toEqual([0, 1, 2]);
    expect(Object.keys(s.run['springs'] as object).sort()).toEqual(['co2', 'simple']);
    await g.grant({ depth: 10 }); // 浅くしても最深は大きいほう
    s = await g.getState();
    expect([s.run.depth, s.run.maxDepth]).toEqual([10, 80]);
    const newTypes = typesOf((await g.events(500)).slice(ev0));
    expect(newTypes.filter((t) => t === 'StratumEntered' || t === 'SpringFound')).toEqual([]);
  });

  test("TS-071-14 rect('drill') はビューポートの CSS ピクセルの矩形で中心を押すと打撃が入る。rect('foo') と S1 で未対応の ID は null", async ({ page }) => {
    const g = await bootGame(page);
    const r = await g.rect('drill');
    expect(r).not.toBeNull();
    const vp = page.viewportSize()!;
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(Number.isFinite(r![k]), k).toBe(true);
    expect(r!.w).toBeGreaterThan(0);
    expect(r!.h).toBeGreaterThan(0);
    // ビューポートの中（キャンバスの中）にある
    const canvas = (await page.locator('[data-testid="stage"] canvas').boundingBox())!;
    expect(r!.x).toBeGreaterThanOrEqual(canvas.x);
    expect(r!.y).toBeGreaterThanOrEqual(canvas.y);
    expect(r!.x + r!.w).toBeLessThanOrEqual(Math.min(vp.width, canvas.x + canvas.width));
    expect(r!.y + r!.h).toBeLessThanOrEqual(Math.min(vp.height, canvas.y + canvas.height));
    const h0 = hitsOf(await g.getState());
    const c = centerOf(r!);
    await page.mouse.click(c.x, c.y);
    expect(hitsOf(await g.getState()) - h0).toBe(1);
    for (const id of ['foo', 'vein', 'slot:0', 'guest:tanuki']) expect(await g.rect(id), `rect('${id}')`).toBeNull();
  });

  test.describe('TS-071-22 renderStats()', () => {
    /** 1 回の叩きで数十個のブロックが壊れるドリル（Lv 80: 威力 81×2^3×1.5＝972。購入数は 1・10・max なので 10 を 8 回）にして、叩きと描画を交互に 30 回 */
    async function breakMany(page: import('@playwright/test').Page, g: Hooks): Promise<{ maxPopups: number; firstTapBlocks: number }> {
      await g.pause();
      await g.grant({ coins: '1e9' });
      expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
      for (let i = 0; i < 8; i++) expect((await g.dispatch({ type: 'buy', item: 'drill', qty: 10 })).ok).toBe(true);
      expect((await g.getState()).run.drill.level).toBe(80);
      let maxPopups = 0;
      let firstTapBlocks = -1;
      for (let i = 0; i < 30; i++) {
        await g.advance(200); // 連打の上限の窓と幕間を進める（ロジックの時間）
        const r = await g.dispatch({ type: 'tap', count: 1 });
        if (firstTapBlocks < 0) firstTapBlocks = r.events.filter((e) => e.type === 'BlockBroken').length;
        await page.clock.fastForward(16); // 描画の 1 フレーム（ポップは描画の時間で消えるので、ロジックと別に進める）
        maxPopups = Math.max(maxPopups, (await g.renderStats()).popups);
      }
      return { maxPopups, firstTapBlocks };
    }

    test('TS-071-22 1280×720: 倍率が zoomFor(ステージの高さ) と同じ整数・横、数十個のブロックを壊してもタイルの数は同じでポップは 20 以下', async ({ page }) => {
      const g = await bootGame(page, { viewport: { width: 1280, height: 720 } });
      await page.clock.runFor(200);
      const st0 = await g.renderStats();
      const stageH = (await page.getByTestId('stage').boundingBox())!.height;
      test.info().annotations.push({ type: '1280×720 renderStats', description: `${JSON.stringify(st0)} stageH=${stageH}` });
      expect(Number.isInteger(st0.zoom)).toBe(true);
      expect(st0.zoom).toBe(zoomFor(stageH));
      expect([3, 4]).toContain(st0.zoom);
      expect(st0.layout).toBe('landscape');
      expect(st0.tileSprites).toBeGreaterThan(0);
      expect(Number.isFinite(st0.particles) && st0.particles >= 0).toBe(true);
      expect(st0.popups).toBeLessThanOrEqual(20);

      const s0 = await g.getState();
      const { maxPopups, firstTapBlocks } = await breakMany(page, g);
      const s1 = await g.getState();
      const st1 = await g.renderStats();
      test.info().annotations.push({
        type: '壊した後',
        description: `${JSON.stringify(st1)} maxPopups=${maxPopups} firstTapBlocks=${firstTapBlocks} blocks=${s1.stats.blocks - s0.stats.blocks} depth=${s1.run.depth}`,
      });
      expect(firstTapBlocks, '1 回の叩きで数十個のブロックが壊れる').toBeGreaterThanOrEqual(20);
      expect(s1.stats.blocks - s0.stats.blocks, "合わせて数十個以上").toBeGreaterThanOrEqual(30);
      expect(maxPopups).toBeGreaterThan(0);
      expect(maxPopups).toBeLessThanOrEqual(20);
      expect(st1.popups).toBeLessThanOrEqual(20);
      // 地層のスプライトは使い回し（深さで増えない）
      expect(st1.tileSprites).toBe(st0.tileSprites);
      expect(st1.zoom).toBe(st0.zoom);
      expect(Number.isFinite(st1.particles) && st1.particles >= 0).toBe(true);
    });

    test('TS-071-22 390×844: 倍率が zoomFor(ステージの高さ) と同じ整数・縦', async ({ page }) => {
      const g = await bootGame(page, { viewport: { width: 390, height: 844 } });
      await page.clock.runFor(200);
      const st = await g.renderStats();
      const stageH = (await page.getByTestId('stage').boundingBox())!.height;
      test.info().annotations.push({ type: '390×844 renderStats', description: `${JSON.stringify(st)} stageH=${stageH}` });
      expect(Number.isInteger(st.zoom)).toBe(true);
      expect(st.zoom).toBe(zoomFor(stageH));
      expect(st.layout).toBe('portrait');
      expect(st.tileSprites).toBeGreaterThan(0);
      expect(st.popups).toBeLessThanOrEqual(20);
    });
  });
});

// BL-089（S1 から繰り延べた中の e2e。QA §2-3 の TS-071-11・21、QA リードの判断で e2e に残した TS-071-19 の 1 件。traceability §6-3・§6-4）
test.describe('BL-071 テスト用フック（BL-089）', () => {
  test('TS-071-11 setClock(T) の後に保存を起こすと、封筒の savedAt が T（アプリの壁時計が差し替わる）', async ({ page, harness }) => {
    const g = await bootGame(page, { seed: SEED_A }); // Clock API の時計は止まっている（単調時計も進まない）
    await g.pause();
    // 対照: 差し替える前の保存の savedAt はページの時計（Date.now()）。差し替えが効いていないのに T と一致する偽の緑を防ぐ
    const wall = await pageNow(page);
    await setHidden(page, true); // hidden への visibilitychange で保存（時計を進めない契機）
    await setHidden(page, false);
    const before = await readSlots(page.context(), harness.origin);
    const first = before[newerOlder(before).newer].env;
    expect(first, '1 回目の保存がある').not.toBeNull();
    expect(first!.savedAt).toBe(wall);

    const T = Date.UTC(2031, 4, 6, 7, 8, 9); // ページの時計（2026-10-01 付近）から遠い時刻
    expect(T).not.toBe(wall);
    await g.setClock(T);
    await setHidden(page, true);
    await setHidden(page, false);
    const after = await readSlots(page.context(), harness.origin);
    const second = after[newerOlder(after).newer].env;
    expect(second!.seq, '2 回目の保存').toBe(first!.seq + 1);
    expect(second!.savedAt).toBe(T);
    // ページの時計は差し替えていない（アプリの壁時計だけが変わる）
    expect(await pageNow(page)).toBe(wall);
  });

  test('TS-071-19 本物のページで setTimeout の中の例外（x1）と処理されない reject（x2）が errors() に入る（main.ts の結線）', async ({ page, harness }) => {
    // 「25 件の後は直近 20 件」は unit（tests/unit/errors.test.ts）・integration（test-hooks.test.ts）で実施済み（traceability §6-4）
    // Playwright の Clock API を入れない（ブラウザ本来のタイマー）。Clock API の偽の setTimeout は、中の例外を window の
    // error にせず clock.runFor の呼び出し元に投げ返す（2026-09-29 の実測: runFor が「Error: x1」で失敗）ので、main.ts が
    // window に付けた error の購読（captureErrors）を通らない
    const g = await bootGame(page, { skipClockInstall: true, pauseClock: false });
    const before = await g.errors();
    expect(before.filter((e) => /\bx[12]\b/.test(e))).toEqual([]);
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('x1');
      }, 0);
      void Promise.reject(new Error('x2'));
    });
    await expect.poll(async () => (await g.errors()).slice(before.length)).toEqual(expect.arrayContaining(['Error: x1', 'Error: x2']));
    // ブラウザも同じ 2 件を捕まえていない例外として出している（ページの例外の見張り。わざと起こしたものだけ）。
    // 文の形はエンジンで違う（WebKit は reject を「Unhandled Promise Rejection: Error: x2」と出す。2026-09-29 の手元の毎晩の実行）
    for (const x of ['x1', 'x2']) expect(harness.pageErrors.some((e) => new RegExp(`\\bError: ${x}\\b`).test(e)), `ページの例外に ${x}`).toBe(true);
    expect(harness.pageErrors.filter((e) => !/\bx[12]\b/.test(e))).toEqual([]);
  });

  test('TS-071-21 Clock API で時計を止めたまま（__game.pause() なし）advance を使うと、advance の分だけロジックが進み、実時間のループは止まったまま', async ({ page }) => {
    const g = await bootGame(page, { seed: SEED_A }); // page.clock.install → 起動 → pauseAt（__game.pause() は呼ばない）
    await autoDigOn(g); // ループが動けば打撃が増える状態にする
    const s0 = await g.getState();
    const wall0 = await pageNow(page);
    // 実時間が過ぎても、Clock API の時計が止まっているので実時間のループは進まない
    await page.waitForTimeout(500);
    const s1 = await g.getState();
    expect(s1.clock.playedMs).toBe(s0.clock.playedMs);
    expect(hitsOf(s1)).toBe(hitsOf(s0));
    // advance はロジックだけを ms 進める（自動掘りの 10 秒分の打撃が入る）
    const evs = await g.advance(10_000);
    const s2 = await g.getState();
    expect(s2.clock.playedMs - s1.clock.playedMs).toBe(10_000);
    expect(hitsOf(s2) - hitsOf(s1)).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(evs)).toBe(true);
    expect(await pageNow(page)).toBe(wall0);
    // advance の後もループは止まったまま（勝手に追いつかない）
    await page.waitForTimeout(300);
    expect((await g.getState()).clock.playedMs).toBe(s2.clock.playedMs);
    // 対照: Clock API で時計を進めると、止めていないループが動いてロジックが進む（ループ自体は生きている）
    await page.clock.runFor(1_000);
    const s3 = await g.getState();
    test.info().annotations.push({ type: 'runFor(1000) で進んだロジックの時間(ms)', description: String(s3.clock.playedMs - s2.clock.playedMs) });
    expect(s3.clock.playedMs).toBeGreaterThan(s2.clock.playedMs);
    expect(hitsOf(s3)).toBeGreaterThan(hitsOf(s2));
  });
});
