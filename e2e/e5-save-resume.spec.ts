// E2E E5 保存と再開（e2e_E5_save-resume.md）
// PR: TS-E5-01・02・03・05・10・11（S1）。毎晩: TS-E5-04（BL-089）。
// 保留: TS-E5-13（S3）、TS-E5-14（S2）。TS-E5-15 は手動（オーナーの iPhone）。
// 欠番: TS-E5-06〜09（壊れ方の種類は integration の TS-027-05・07 に統合。E2E は TS-E5-05 が代表）、TS-E5-12（TS-027-20・TS-COM-04）。
//
// 壊れた枠の試験は、context.storageState() を書き換えて新しい context で開き直す（reopenWithStorage）。
// 同じページの再読み込みでは pagehide の保存が壊した枠を上書きしてしまうため。
//
// 技術リードの回答（traceability.md §5-2）に合わせた前提
// - Q-16: seed() はストレージに書かない。pause() はロジックだけを止め、15 秒ごとの自動保存は止めない。game に壁時計の時刻はない
//   （TS-E5-01 の「game が getState() と深く等しい」、TS-E5-03 の H1＝H2 がそのまま成り立つ）。
// - Q-11: 最初の保存は a・seq 1、以後「今の正」と反対の枠に「有効な枠の最大の seq＋1」。壊れた X から復元した後の保存は X に Y.seq＋1（TS-E5-10）。
//   両方壊れていたら新しいゲーム・save:broken に 1 つ退避・a から書く（TS-E5-11）。hidden への visibilitychange と pagehide は
//   それぞれ 1 回書く（TS-E5-03 は、再読み込みで実際に来た契機の数だけ seq が増えることを見る）。
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, type Harness } from './support/fixtures.ts';
import { armUnloadTriggerProbe, bootGame, centerOf, pageNow, readUnloadTriggers, reloadGame, setHidden, triggerAutosave } from './support/boot.ts';
import { later, needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks, type SerializedState } from './support/hooks.ts';
import {
  BROKEN_SLOT_KEY,
  newerOlder,
  readLocalStorage,
  readSlots,
  reopenWithStorage,
  SLOT_KEYS,
  writtenSlots,
  type SlotName,
  type Slots,
} from './support/storage.ts';
import { SEED_A } from '../tests/helpers/seeds.ts';

/** 準備: 状態を作る（シナリオの「準備」の 1〜3） */
async function prepare(page: Page, harness: Harness): Promise<{ g: Hooks; base: Slots }> {
  const g = await bootGame(page);
  await g.pause();
  await g.seed(SEED_A);
  await g.pause(); // seed が新しいゲームでループを動かし直す実装でも、ロジックは止めたままにする
  await g.advance(30_000, { tapsPerSec: 2 });
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  await g.dispatch({ type: 'setAutoDig', on: true });
  await g.advance(30_000);
  // 起動直後に保存が起きるかは実装しだいなので、seq は基準からの増分で見る
  return { g, base: await readSlots(page.context(), harness.origin) };
}

const maxSeq = (s: Slots): number => Math.max(s.a.env?.seq ?? 0, s.b.env?.seq ?? 0);

/** 1 回の保存を起こし、書かれた枠と、その時点の getState() を返す */
async function saveOnce(page: Page, harness: Harness, g: Hooks, trigger: () => Promise<void>): Promise<{ slot: SlotName; slots: Slots; state: SerializedState }> {
  const before = await readSlots(page.context(), harness.origin);
  const state = await g.getState();
  await trigger();
  const slots = await readSlots(page.context(), harness.origin);
  const w = writtenSlots(before, slots);
  expect(w, '1 回の保存で書かれる枠は 1 つ').toHaveLength(1);
  return { slot: w[0]!, slots, state };
}

/** TS-E5-02 の 3 回の保存（15 秒ごと → 非表示 → 15 秒ごと） */
async function threeSaves(page: Page, harness: Harness, g: Hooks) {
  const s1 = await saveOnce(page, harness, g, () => triggerAutosave(page));
  await g.advance(5_000);
  const s2 = await saveOnce(page, harness, g, () => setHidden(page, true));
  await setHidden(page, false);
  await g.pause(); // 表示に戻るとループが再開する（arch §7）ので、ロジックは止めたままにする
  await g.advance(5_000);
  const s3 = await saveOnce(page, harness, g, () => triggerAutosave(page));
  return [s1, s2, s3] as const;
}

/**
 * 新しいほうの枠 X を書き換えたストレージで新しい context を開き、Y の savedAt に止めた時計で起動する。
 * 起動の間ロジックは進まないので、読み込んだ状態をそのまま比べられる
 */
async function reopenWithBrokenNewer(
  page: Page,
  harness: Harness,
  breakX: (raw: string, ls: Map<string, string>, key: string) => void,
): Promise<{ page: Page; context: BrowserContext; g: Hooks; x: SlotName; y: SlotName; slots: Slots }> {
  const slots = await readSlots(page.context(), harness.origin);
  const { newer: x, older: y } = newerOlder(slots);
  expect(slots[x].raw).not.toBeNull();
  expect(slots[y].env).not.toBeNull();
  const reopened = await reopenWithStorage(harness, page.context(), (ls) => breakX(slots[x].raw!, ls, SLOT_KEYS[x]));
  const g = await bootGame(reopened.page, { time: slots[y].env!.savedAt, startPaused: true });
  return { ...reopened, g, x, y, slots };
}

test.describe('E5 保存と再開', () => {
  test('TS-E5-01 15 秒ごとの保存で枠が 1 つ書かれ、封筒の中身が今の状態と一致する', async ({ page, harness }) => {
    needs('hook:seed', 'hook:advance.input');
    const { g, base } = await prepare(page, harness);
    const now0 = await pageNow(page);
    await triggerAutosave(page);
    const now1 = await pageNow(page);
    const after = await readSlots(page.context(), harness.origin);
    const w = writtenSlots(base, after);
    expect(w).toHaveLength(1);
    const env = after[w[0]!].env!;
    expect(env.seq).toBe(maxSeq(base) + 1);
    expect(env.schema).toBe(1);
    expect(env.savedAt).toBeGreaterThanOrEqual(now0);
    expect(env.savedAt).toBeLessThanOrEqual(now1);
    expect(env.appVersion).toBe(await g.version());
    expect(env.checksum).toMatch(/^[0-9a-f]{8}$/);
    // 壁時計のフィールドの扱いは Q-16。違えば差分がそのまま出る
    expect(env.game).toEqual(await g.getState());
  });

  test('TS-E5-02 3 回の保存の書き先が a・b 交互で、seq が 1 ずつ増える', async ({ page, harness }) => {
    needs('hook:seed', 'hook:advance.input', 'feature:twoSlotSave');
    const { g } = await prepare(page, harness);
    const saves = await threeSaves(page, harness, g);
    const order = saves.map((s) => s.slot);
    test.info().annotations.push({ type: '書き先の順', description: order.join(' → ') });
    expect(order[0]).not.toBe(order[1]);
    expect(order[1]).not.toBe(order[2]);
    expect(order[0]).toBe(order[2]);
    const seqs = saves.map((s) => s.slots[s.slot].env!.seq);
    expect(seqs[1]).toBe(seqs[0]! + 1);
    expect(seqs[2]).toBe(seqs[1]! + 1);
    for (const s of saves) expect(s.slots[s.slot].env!.game).toEqual(s.state);
  });

  test('TS-E5-03 再読み込みで stateHash が一致し、退出時の保存（pagehide ほか）の回数だけ seq が増える', async ({ page, harness }) => {
    needs('hook:seed', 'hook:advance.input', 'feature:twoSlotSave');
    const { g } = await prepare(page, harness);
    await threeSaves(page, harness, g);
    const t1 = await pageNow(page); // 時計は止まっている（= pauseAt(T1)）
    const h1 = await g.stateHash();
    const seqBefore = maxSeq(await readSlots(page.context(), harness.origin));
    await armUnloadTriggerProbe(page);
    const g2 = await reloadGame(page);
    // 退出時の保存の契機（arch §11・Q-11 の 6: pagehide と hidden への visibilitychange はそれぞれ 1 回書く。同じ内容でも省かない）。
    // シナリオの「pagehide の保存で seq がもう 1 増える」は pagehide だけが来る前提。Chromium の再読み込みでは両方来るので 2 増える
    const triggers = await readUnloadTriggers(page);
    test.info().annotations.push({ type: '再読み込みの退出時の保存の契機', description: JSON.stringify(triggers) });
    expect(triggers.pagehide, 'pagehide が来ている').toBeGreaterThanOrEqual(1);
    if ((await pageNow(page)) !== t1) {
      needs('hook:setClock');
      await g2.setClock(t1);
    }
    const h2 = await g2.stateHash(); // 何も入力しない
    expect(h2).toBe(h1);
    expect(maxSeq(await readSlots(page.context(), harness.origin))).toBe(seqBefore + triggers.pagehide + triggers.hidden);
    // おかえり画面が出ない（経過 60 秒未満）。画面の名前は S2 の BL-046 で決まるので、welcome で始まる testid を見る
    await expect(page.locator('[data-testid^="welcome"]')).toHaveCount(0);
  });

  test('TS-E5-04 再開後も遊べ、次の保存は直前とは別の枠に入る @nightly', async ({ page, harness }) => {
    needs('hook:seed', 'hook:advance.input', 'hook:rect', 'feature:twoSlotSave');
    const { g } = await prepare(page, harness);
    await threeSaves(page, harness, g);
    const g2 = await reloadGame(page);
    const lastWritten = newerOlder(await readSlots(page.context(), harness.origin)).newer;
    const c = centerOf((await g2.rect('drill'))!);
    const h0 = hitsOf(await g2.getState());
    await page.mouse.click(c.x, c.y);
    expect(hitsOf(await g2.getState())).toBeGreaterThan(h0);
    const next = await saveOnce(page, harness, g2, () => triggerAutosave(page));
    expect(next.slot).not.toBe(lastWritten);
  });

  test.describe('片方の枠が壊れている', () => {
    test('TS-E5-05 新しいほうの枠が途中で切れていたら、もう一方の枠から復元する', async ({ page, harness }) => {
      needs('hook:seed', 'hook:advance.input', 'feature:twoSlotSave');
      const { g } = await prepare(page, harness);
      await threeSaves(page, harness, g);
      const r = await reopenWithBrokenNewer(page, harness, (raw, ls, key) => ls.set(key, raw.slice(0, Math.floor(raw.length / 2))));
      expect(await r.g.getState()).toEqual(r.slots[r.y].env!.game);
      expect(harness.pageErrors).toEqual([]);
    });

    test('TS-E5-10 壊れた枠から復元した後の保存は、壊れていた X に書かれ、Y は 1 バイトも変わらない', async ({ page, harness }) => {
      needs('hook:seed', 'hook:advance.input', 'feature:twoSlotSave');
      const { g } = await prepare(page, harness);
      await threeSaves(page, harness, g);
      const r = await reopenWithBrokenNewer(page, harness, (raw, ls, key) => ls.set(key, raw.slice(0, Math.floor(raw.length / 2))));
      const yRaw = r.slots[r.y].raw;
      await triggerAutosave(r.page);
      const after = await readSlots(r.context, harness.origin);
      expect(after[r.y].raw, 'ただ 1 つの有効な控え（Y）を上書きしない').toBe(yRaw);
      expect(after[r.x].env, '次の保存は壊れていた X に書かれる').not.toBeNull();
      // Q-11 の 2: seq は「有効な枠の最大の seq」＋1（壊れた枠の seq は数えない）
      expect(after[r.x].env!.seq).toBe(after[r.y].env!.seq + 1);
    });
  });

  test('TS-E5-11 両方の枠が壊れていたら、例外で落ちずに新しいゲームで起動し、壊れた文字列を 1 つ退避してから a に書く', async ({ page, harness }) => {
    // Q-11 の 4: 新しいゲーム（チケット 2 枚）で起動する。上書きする前に、壊れていた生の文字列のうち seq の大きそうなほう
    // （読めなければ a）を onsen-driller:save:broken に 1 つだけ退避し、その後は通常どおり a から書く（seq 1）。
    // 案内（トースト）は S2 の BL-046 なので S1 では見ない
    needs('hook:seed', 'hook:advance.input', 'feature:twoSlotSave', 'feature:tickets');
    const { g } = await prepare(page, harness);
    await threeSaves(page, harness, g);
    const slots = await readSlots(page.context(), harness.origin);
    const half = (raw: string | null): string => (raw ?? '').slice(0, Math.floor((raw ?? '').length / 2));
    const broken = { a: half(slots.a.raw), b: half(slots.b.raw) };
    const reopened = await reopenWithStorage(harness, page.context(), (ls) => {
      ls.set(SLOT_KEYS.a, broken.a);
      ls.set(SLOT_KEYS.b, broken.b);
    });
    const g2 = await bootGame(reopened.page, { startPaused: true });
    expect(harness.pageErrors).toEqual([]);
    await expect(reopened.page.getByTestId('hud-coins')).toBeVisible();
    // 新しいゲーム
    const s = await g2.getState();
    expect(coinsOf(s)).toBe(0);
    expect(s.run.depth).toBe(0);
    expect(s.run.drill.tool).toBe(0);
    expect(s.meta.tickets).toBe(2);
    // 最初の保存の後: 退避があり、a に seq 1 の有効な封筒
    await triggerAutosave(reopened.page);
    const ls = await readLocalStorage(reopened.context, harness.origin);
    const backup = ls.get(BROKEN_SLOT_KEY) ?? null;
    const newer = newerOlder(slots).newer;
    test.info().annotations.push({ type: '退避した枠', description: backup === broken.a ? 'a' : backup === broken.b ? 'b' : String(backup?.slice(0, 20)) });
    expect([broken[newer], broken.a], 'seq の大きそうなほう（読めなければ a）を退避する').toContain(backup);
    const after = await readSlots(reopened.context, harness.origin);
    expect(after.a.env, 'その後は a から書く').not.toBeNull();
    expect(after.a.env!.seq).toBe(1);
    expect(after.a.env!.game).toEqual(await g2.getState());
  });

  test('TS-E5-13 新しい版のセーブで読み取り専用になり、ストレージを書き換えない', () => {
    later('S3:newerSave');
  });

  test('TS-E5-14 e2e-crazygames で data モジュールに保存・移行する', () => {
    later('S2:crazygames');
  });
});

