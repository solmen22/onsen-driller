// 保存の試験の準備（e2e_E5_save-resume.md「準備: 状態を作る」）。E5 と、E9 の TS-E9-14・15（既存のセーブがある V6・V7）で共用する
import { expect, type Page } from '@playwright/test';
import { SEED_A } from '../../tests/helpers/seeds.ts';
import { bootGame, triggerAutosave } from './boot.ts';
import type { Harness } from './fixtures.ts';
import type { Hooks } from './hooks.ts';
import { newerOlder, readSlots, type SlotName, type Slots } from './storage.ts';

/**
 * 準備の 1〜3: 0 クリックで起動 → pause → seed(SEED_A) → advance(30 秒, 毎秒 2 打) → ツルハシを買う → 自動掘りオン → advance(30 秒)。
 * 戻り値の base はこの時点の 2 枠（起動直後に保存が起きるかは実装しだいなので、seq は base からの増分で見る）
 */
export async function prepareSaveState(page: Page, harness: Harness): Promise<{ g: Hooks; base: Slots }> {
  const g = await bootGame(page);
  await g.pause();
  await g.seed(SEED_A);
  await g.pause(); // seed が新しいゲームでループを動かし直す実装でも、ロジックは止めたままにする
  await g.advance(30_000, { tapsPerSec: 2 });
  expect((await g.dispatch({ type: 'buy', item: 'tool', qty: 1 })).ok).toBe(true);
  await g.dispatch({ type: 'setAutoDig', on: true });
  await g.advance(30_000);
  return { g, base: await readSlots(page.context(), harness.origin) };
}

/**
 * TS-E9-14・15 の準備: 準備の 1〜3 → 15 秒ごとの保存を 2 回 → 2 枠（新しいほうを X〔seq n＋1〕、古いほうを Y〔seq n〕）。
 * ロジックは止めたまま保存するので、各枠の game はそのときの getState() と同じ
 */
export async function prepareTwoSlots(page: Page, harness: Harness): Promise<{ slots: Slots; x: SlotName; y: SlotName }> {
  await prepareSaveState(page, harness);
  await triggerAutosave(page);
  await triggerAutosave(page);
  const slots = await readSlots(page.context(), harness.origin);
  const { newer: x, older: y } = newerOlder(slots);
  expect(slots[x].env, 'X（新しいほうの枠）が有効').not.toBeNull();
  expect(slots[y].env, 'Y（古いほうの枠）が有効').not.toBeNull();
  expect(slots[x].env!.seq).toBe(slots[y].env!.seq + 1);
  return { slots, x, y };
}
