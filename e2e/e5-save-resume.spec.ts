// E2E E5 保存と再開（e2e_E5_save-resume.md）
// PR: TS-E5-01・02・03・05・10・11・16（S1）。毎晩: TS-E5-04（BL-089）。
// S2: TS-E5-13（BL-046 の読み取り専用の案内。BL-103）。S2: TS-E5-14（e2e-crazygames。BL-103）。TS-E5-15 は手動（オーナーの iPhone）。
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
// - Q-10 の 4・Q-22（S1 コードレビュー M-1）: 新しい版（schema 2）の枠は、v1 から見て形・checksum が壊れていても newer で、
//   そのセッションは一切書かない（TS-E5-16）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, type Harness } from './support/fixtures.ts';
import { armUnloadTriggerProbe, bootGame, centerOf, pageNow, readUnloadTriggers, reloadGame, setHidden, triggerAutosave } from './support/boot.ts';
import { needs } from './support/gaps.ts';
import { coinsOf, hitsOf, type Hooks, type SerializedState } from './support/hooks.ts';
import { stateHashOracle } from './support/hash.ts';
import { STORAGE_PREFIX } from './support/privacy.ts';
import { bootCrazyGames, CG_BASE_URL, cgMockState } from './support/crazygames.ts';
import { prepareSaveState as prepare } from './support/prepare.ts';
import {
  BROKEN_SLOT_KEY,
  newerOlder,
  readLocalStorage,
  readSlots,
  reopenWithStorage,
  saveKeysOf,
  SLOT_KEYS,
  writtenSlots,
  type SlotName,
  type Slots,
} from './support/storage.ts';

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
      expect(await harness.uncaughtErrors()).toEqual([]);
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
    // 4 回目の保存で新しいほうを b にする（3 回では新しいほうがいつも a で、「読めなければ a」と見分けられない。レビュー N-2）
    await triggerAutosave(page);
    const slots = await readSlots(page.context(), harness.origin);
    const newer = newerOlder(slots).newer;
    expect(newer, '4 回目の保存（a → b → a → b）で新しいほうは b').toBe('b');
    const half = (raw: string | null): string => (raw ?? '').slice(0, Math.floor((raw ?? '').length / 2));
    const broken = { a: half(slots.a.raw), b: half(slots.b.raw) };
    // 途中で切った文字列にも seq が残る（封筒の先頭のほうのキー）ので、仕様の「seq の大きいほう」で退避先は一意に決まる
    expect(broken.a).toContain('"seq":');
    expect(broken.b).toContain('"seq":');
    const reopened = await reopenWithStorage(harness, page.context(), (ls) => {
      ls.set(SLOT_KEYS.a, broken.a);
      ls.set(SLOT_KEYS.b, broken.b);
    });
    const g2 = await bootGame(reopened.page, { startPaused: true });
    expect(await harness.uncaughtErrors()).toEqual([]);
    await expect(reopened.page.getByTestId('hud-coins')).toBeVisible();
    // 新しいゲーム
    const s = await g2.getState();
    expect(coinsOf(s)).toBe(0);
    expect(s.run.depth).toBe(0);
    expect(s.run.drill.tool).toBe(0);
    expect(s.meta.tickets).toBe(2);
    // 最初の保存の後: 退避があり、a に seq 1 の有効な封筒。
    // ロジックは止めてから保存を起こす（止めないと、fastForward で最大 1 秒・その後の runFor(100) で 0.1 秒進み、
    // 保存した game と後で読む getState() が playedMs などでずれる。準備の 1〜3 と同じく pause() する）
    await g2.pause();
    await triggerAutosave(reopened.page);
    const ls = await readLocalStorage(reopened.context, harness.origin);
    const backup = ls.get(BROKEN_SLOT_KEY) ?? null;
    test.info().annotations.push({ type: '退避した枠', description: backup === broken.a ? 'a' : backup === broken.b ? 'b' : String(backup?.slice(0, 20)) });
    expect(backup, 'seq の大きいほう（b）の壊れた文字列を 1 つだけ退避する').toBe(broken[newer]);
    const after = await readSlots(reopened.context, harness.origin);
    expect(after.a.env, 'その後は a から書く').not.toBeNull();
    expect(after.a.env!.seq).toBe(1);
    expect(after.a.env!.game).toEqual(await g2.getState());
  });

  test('TS-E5-16 ロールバックの再現: v1 から見て壊れた新しい版（schema 2）の枠があるセッションは、どの枠も書き換えない（M-1）', async ({ page, harness }) => {
    // 本体は integration の TS-027-22（4 通り）。E2E は代表 1 件。案内の表示とストレージ全体の比較は S2 の TS-E5-13（BL-046）
    const { g } = await prepare(page, harness);
    await threeSaves(page, harness, g);
    const slots = await readSlots(page.context(), harness.origin);
    const { newer: x, older: y } = newerOlder(slots);
    // 将来の版を模した封筒: schema 2、seq のキーを消し、checksum を別の 8 桁の 16 進に、知らないキー checksumV2 を足す
    // （先頭のキーは schema のまま。arch §11「封筒の約束」）
    const env = JSON.parse(slots[x].raw!) as Record<string, unknown>;
    const rest: Record<string, unknown> = { ...env };
    delete rest.seq;
    delete rest.schema;
    const otherChecksum = env.checksum === '00000000' ? '11111111' : '00000000';
    const futureRaw = JSON.stringify({ schema: 2, ...rest, checksum: otherChecksum, checksumV2: 'deadbeef' });
    const reopened = await reopenWithStorage(harness, page.context(), (ls) => ls.set(SLOT_KEYS[x], futureRaw));
    const before = await readLocalStorage(reopened.context, harness.origin);
    expect(before.get(SLOT_KEYS[x])).toBe(futureRaw);
    const yRaw = before.get(SLOT_KEYS[y]) ?? null;
    const keysBefore = saveKeysOf(before);

    // 起動 → 15 秒ごとの保存 4 回 → 非表示 → 表示 → 再読み込み（pagehide）
    await bootGame(reopened.page);
    for (let i = 0; i < 4; i++) await triggerAutosave(reopened.page);
    await setHidden(reopened.page, true);
    await setHidden(reopened.page, false);
    await reloadGame(reopened.page);

    const after = await readLocalStorage(reopened.context, harness.origin);
    expect(await harness.uncaughtErrors(), '捕まえていない例外がない').toEqual([]);
    expect(after.get(SLOT_KEYS[x]), 'X（新しい版の枠）の生の文字列が 1 バイトも変わらない').toBe(futureRaw);
    expect(after.get(SLOT_KEYS[y]) ?? null, 'Y も変わらない').toBe(yRaw);
    expect(after.has(BROKEN_SLOT_KEY), 'onsen-driller:save:broken ができない').toBe(false);
    expect(saveKeysOf(after), 'onsen-driller:save: で始まるキーが増えない').toEqual(keysBefore);
  });

  test('TS-E5-13 新しい版のセーブで読み取り専用になり、起動直後から案内を出し、セッション中にストレージを 1 バイトも書き換えない（Q-26。BL-103）', async ({
    page,
    harness,
  }) => {
    // 正しい v2 を模した封筒: X の封筒の schema だけを 2 にする（game はそのままなので checksum も合う）
    const { g } = await prepare(page, harness);
    await threeSaves(page, harness, g);
    const slots = await readSlots(page.context(), harness.origin);
    const { newer: x } = newerOlder(slots);
    const env = JSON.parse(slots[x].raw!) as Record<string, unknown>;
    expect(env.checksum, '封筒の checksum は game の正規化 JSON の FNV-1a（v2 を模した封筒でも合う）').toBe(stateHashOracle(env.game));
    const futureRaw = JSON.stringify({ ...env, schema: 2 });
    // ja-JP の context で開き直す（reopenWithStorage は locale を変えられないので、同じ手順をここで行う）
    const st = await page.context().storageState();
    const o = st.origins.find((e) => e.origin === harness.origin)!;
    o.localStorage = o.localStorage.map((e) => (e.name === SLOT_KEYS[x] ? { name: e.name, value: futureRaw } : e));
    const ctx = await harness.newContext({ storageState: st, locale: 'ja-JP' });
    const p2 = await ctx.newPage();
    const snapshot = async (): Promise<[string, string][]> =>
      [...(await readLocalStorage(ctx, harness.origin))].filter(([k]) => k.startsWith(STORAGE_PREFIX)).sort(([a], [b]) => a.localeCompare(b));
    const before = await snapshot();
    expect(new Map(before).get(SLOT_KEYS[x])).toBe(futureRaw);

    const msg = (lang: 'ja' | 'en'): string =>
      (JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'src', 'i18n', `${lang}.json`), 'utf8')) as Record<string, string>)['save.newerVersion']!;
    const warning = p2.getByTestId('save-warning');
    const expectReadonly = async (lang: 'ja' | 'en', when: string): Promise<void> => {
      await expect(warning, `${when}: 案内が出ている`).toBeVisible();
      await expect(warning).toHaveAttribute('data-state', 'readonly');
      await expect(warning).toHaveAttribute('role', 'status');
      await expect(warning.locator('button'), `${when}: 閉じるボタンがない（出したまま）`).toHaveCount(0);
      await expect(warning, `${when}: 文言は今の言語の save.newerVersion`).toHaveText(msg(lang));
    };

    // 起動直後（最初の保存の前。bootGame は起動の後に時計を止めるので、15 秒ごとの保存はまだ来ていない）
    const g2 = await bootGame(p2);
    await expectReadonly('ja', '起動直後');
    // 60 秒遊ぶ（15 秒ごとの保存 4 回）
    await g2.pause();
    for (let i = 0; i < 4; i++) {
      await g2.advance(5_000, { tapsPerSec: 2 });
      await triggerAutosave(p2);
    }
    await expectReadonly('ja', '60 秒の後');
    // 言語の切り替え（メモリの設定だけを変え、書かない）
    await p2.getByTestId('tab-5').click();
    await p2.getByTestId('lang-toggle').click();
    await p2.clock.runFor(450);
    await expect(p2.locator('html')).toHaveAttribute('lang', 'en');
    await expectReadonly('en', '言語の切り替えの後');
    // 非表示 → 表示 → 再読み込み（pagehide）。設定を書いていないので、再読み込みの後は ja-JP の判定で日本語に戻る
    await setHidden(p2, true);
    await setHidden(p2, false);
    await reloadGame(p2);
    await expectReadonly('ja', '再読み込みの後');

    expect(await snapshot(), 'セッション中に onsen-driller: のキー（枠・save:broken・設定）が 1 バイトも変わらない').toEqual(before);
    expect(await harness.uncaughtErrors(), '捕まえていない例外がない').toEqual([]);
  });

  test.describe('e2e-crazygames', () => {
    test.use({ baseURL: CG_BASE_URL });

    test('TS-E5-14 e2e-crazygames: data モジュールに保存し、localStorage にある以前の枠（SDK が使えなかった起動の分）を最初の起動で移す（BL-103）', async ({
      page,
      harness,
    }) => {
      // 1. data モジュールのない SDK で起動（localStorage に保存する。Basic Launch 版・SDK が使えなかった起動を模す）
      const g = await bootCrazyGames(page, harness, { mock: { dataModule: false } });
      await g.pause();
      await g.seed(42);
      await g.pause();
      await g.advance(5_000, { tapsPerSec: 2 });
      await triggerAutosave(page);
      await g.advance(5_000, { tapsPerSec: 2 });
      await triggerAutosave(page);
      expect((await cgMockState(page)).calls.filter((c) => c.startsWith('data.')), 'data モジュールはない').toEqual([]);
      // 閉じるとき（pagehide）の保存も localStorage に入るので、閉じた後の枠を「以前の枠」とする
      const ctx = page.context();
      await page.close();
      const legacy = await readSlots(ctx, harness.origin);
      expect(legacy.a.raw, '以前の枠 a が localStorage にある').not.toBeNull();
      expect(legacy.b.raw, '以前の枠 b が localStorage にある').not.toBeNull();
      const { newer } = newerOlder(legacy);
      const newerEnv = legacy[newer].env!;

      // 2. 同じ context（localStorage はそのまま）で、data モジュールのある SDK で開く → 最初の起動で移す
      const p2 = await ctx.newPage();
      const g2 = await bootCrazyGames(p2, harness, { time: newerEnv.savedAt, startPaused: true });
      const moved = await cgMockState(p2);
      expect(moved.store[SLOT_KEYS.a], '枠 a が data モジュールへ移った（生の文字列のまま）').toBe(legacy.a.raw);
      expect(moved.store[SLOT_KEYS.b], '枠 b が data モジュールへ移った').toBe(legacy.b.raw);
      expect(saveKeysOf(await readLocalStorage(p2.context(), harness.origin)), '移した後は localStorage の枠を消す').toEqual([]);
      expect(await g2.getState(), '移した新しい方の枠から再開する').toEqual(newerEnv.game);

      // 3. 以後の保存は data モジュールへ（seq は移した枠の続き。localStorage には書かない）
      await g2.pause();
      await g2.advance(5_000, { tapsPerSec: 2 });
      await triggerAutosave(p2);
      const after = await cgMockState(p2);
      expect(after.calls).toContain(`data.setItem:${SLOT_KEYS[newerOlder(legacy).older]}`);
      const seqs = [SLOT_KEYS.a, SLOT_KEYS.b].map((k) => (JSON.parse(after.store[k]!) as { seq: number }).seq);
      expect(Math.max(...seqs), '次の保存の seq は移した枠の最大＋1').toBe(newerEnv.seq + 1);
      expect(saveKeysOf(await readLocalStorage(p2.context(), harness.origin))).toEqual([]);
      expect(await harness.uncaughtErrors()).toEqual([]);
    });
  });
});

