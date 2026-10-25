// セーブの見本（gdd §10・arch §11。BL-028）: 版ごとに 序盤・転生前・転生後・最大状態 の 4 種を tests/fixtures/saves/v{N}/ に置き、永久に残す。
// - 見本は「その版のビルドが書く封筒の文字列」そのもの（ストレージの値と同じ。1 行の JSON）
// - 状態は直接組み立てる（ボットで遊ばない。ボットの規則で見本が変わらないように）。最大状態は、どの欄も上限・すべての ID・最長の ID で作る
// - **見本は凍結のデータ**: 一度置いたら変えない（ハッシュを固定）。道具の出力が後で変わっても、置いてある見本は作り直さない
// - 版 1 の見本は**合成**: 同じ状態から版 2 で足した欄（meta.lastPrestigeGain・run.startDepth）を除き、schema を 1 にして checksum を付け直す
//   （版 1 と版 2 の違いはこの 2 つの欄と schema だけ。arch §11 の版の履歴）。版 1 のビルド（main `9b16498`。SAVE_SCHEMA_VERSION = 1）で
//   4 本とも補正なしに読めることを確かめた（2026-10-26。PR #87 のレビュー N-1）
// - どの見本にも run.pendingOffline の欄がある（BL-058 が版 1 のまま足した欄）。転生後の見本は受け取り待ちのオフラインの報酬を持つ
// 書くのは tools/fixtures/make-save-fixtures.ts（ない見本だけを書く。見本は消さない・上書きしない）
import { GUESTS } from '../../src/content/guests.ts';
import { ORE_IDS } from '../../src/content/ores.ts';
import { PARAMS } from '../../src/content/params.ts';
import { PERK_IDS, PERK_BY_ID } from '../../src/content/perks.ts';
import { SPRINGS, type SpringId } from '../../src/content/springs.ts';
import { STRATA } from '../../src/content/strata.ts';
import { TERRAIN_IDS } from '../../src/content/terrains.ts';
import { TOOLS } from '../../src/content/tools.ts';
import { UPGRADES } from '../../src/content/upgrades.ts';
import {
  checksumOf,
  computeGuests,
  createInitialState,
  dispatch,
  NUM_MAX,
  num,
  slotsForBathLevel,
  toSaveGame,
  type GameState,
} from '../../src/core/index.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { MAX_ID_LIST } from '../../src/save/schema.ts';

export type FixtureKind = 'early' | 'pre-prestige' | 'post-prestige' | 'max';
export const FIXTURE_KINDS: readonly FixtureKind[] = ['early', 'pre-prestige', 'post-prestige', 'max'];

/** 見本の封筒の固定の値（決定的にするため） */
const SAVED_AT = 1_790_000_000_000;
const APP_VERSION = 'fixture';

/**
 * 状態を直接組み立てる（ボットで遊ばない。PR #87 の合成の赤: ボットの規則〔#86〕で道具の出力が変わったため。CEO 方針: 見本は凍結のデータ）。
 * 道具の出力は content の ID と式（お客さん・枠の数）だけに依存する。置いてある見本は、作ったときの出力のまま変えない（ハッシュを固定）
 */
interface Spec {
  depth: number;
  coins: string;
  drill: number;
  tool: number;
  digger: number;
  autoOn: boolean;
  bath: number;
  pumps: Partial<Record<SpringId, number>>;
  upgrades: number;
  playedMs: number;
  tickets: number;
  bestDepth?: number;
}
function build(sp: Spec): GameState {
  const s = createInitialState(1);
  const r = s.run;
  r.coins = num(sp.coins);
  r.depth = sp.depth;
  r.maxDepth = sp.depth;
  r.drill = { level: sp.drill, tool: sp.tool };
  r.autoDig = { level: sp.digger, on: sp.autoOn && sp.tool >= 1 };
  for (const [id, lv] of Object.entries(sp.pumps)) if (lv && lv > 0) r.springs[id as SpringId] = { pump: lv };
  r.bath.level = sp.bath;
  const found = Object.keys(r.springs) as SpringId[];
  r.bath.slots = Array.from({ length: slotsForBathLevel(sp.bath) }, (_, i) => found[i] ?? null);
  r.upgrades = UPGRADES.slice(0, sp.upgrades).map((u) => u.id);
  r.stratumSeen = STRATA.map((b, i) => (b.start <= sp.depth ? i : -1)).filter((i) => i >= 0);
  r.vein = { nextAtMs: sp.playedMs + PARAMS.vein.minIntervalMs, active: null };
  s.clock.playedMs = sp.playedMs;
  s.meta.tickets = sp.tickets;
  s.collection.springsSeen = [...found];
  s.collection.ores = { quartz: Math.floor(sp.depth * 0.04), copper: Math.floor(sp.depth * 0.02) };
  s.stats = { totalCoins: num(sp.coins).mul(40), taps: sp.depth * 6, hits: sp.depth * 9, blocks: sp.depth, bestDepth: Math.max(sp.depth, sp.bestDepth ?? 0), offlineMaxMs: 0 };
  r.guests = computeGuests(s);
  s.collection.guestsSeen = Object.fromEntries(r.guests.map((g, i) => [g, SAVED_AT - 3_600_000 + i * 60_000]));
  return s;
}

/** 序盤: 3 分ごろ（ツルハシ・ドリル Lv12・63m・単純温泉・タヌキ） */
function early(): GameState {
  return build({ depth: 63, coins: '842', drill: 12, tool: 1, digger: 0, autoOn: false, bath: 0, pumps: { simple: 6 }, upgrades: 0, playedMs: 180_000, tickets: 3 });
}

/** 転生前: 1 周目の 250m（湯の華 25。推奨の手前）。源泉 4 つ・改良 8 つ・自動掘り */
function prePrestige(): GameState {
  return build({
    depth: 250,
    coins: '3.1e9',
    drill: 83,
    tool: 5,
    digger: 24,
    autoOn: true,
    bath: 15,
    pumps: { simple: 40, co2: 31, salt: 26, sulfur: 12 },
    upgrades: 8,
    playedMs: 14 * 60_000,
    tickets: 6,
  });
}

/** 転生後: 2 回転生した 3 周目の 60m。木を少し取り（使った 23）、前回の獲得 45、受け取り待ちのオフラインの報酬がある */
function postPrestige(): GameState {
  const s = build({ depth: 60, coins: '1.5e3', drill: 12, tool: 1, digger: 0, autoOn: false, bath: 0, pumps: { simple: 5 }, upgrades: 0, playedMs: 41 * 60_000, tickets: 8, bestDepth: 300 });
  s.meta.prestiges = 2;
  s.meta.yunohana = { lifetime: num(75), spent: num(0) };
  s.meta.lastPrestigeGain = num(45);
  for (const perk of ['sharpBlade', 'yumori', 'travelFunds', 'nightDig']) dispatch(s, { type: 'takePerk', perk });
  if (s.meta.yunohana.spent.toNumber() !== 23) throw new Error('post-prestige: 木を取れなかった');
  s.run.pendingOffline = { coins: num('1.25e9'), ms: 2 * 3_600_000 };
  return s;
}

/** 最大状態: どの欄も上限・すべての ID（実績は形の正しい最長の ID を上限の数まで）。保存データの大きさの上限を確かめる */
function maxState(): GameState {
  const s = createInitialState(1);
  const r = s.run;
  const L = PARAMS.levelMax;
  r.coins = NUM_MAX;
  r.blockDmg = NUM_MAX;
  r.depth = 1_000_000;
  r.maxDepth = 1_000_000;
  r.startDepth = 250_000;
  r.drill = { level: L, tool: TOOLS.length - 1 };
  r.autoDig = { level: L, on: true };
  for (const sp of SPRINGS) r.springs[sp.id] = { pump: L };
  r.bath.level = L;
  const ids = SPRINGS.map((sp) => sp.id);
  r.bath.slots = Array.from({ length: slotsForBathLevel(L) }, (_, i) => ids[i] ?? null);
  r.upgrades = UPGRADES.map((u) => u.id);
  r.boost = { remainingMs: PARAMS.boost.durationMs, readyAtWallMs: 9_007_199_254_740 };
  r.vein = { nextAtMs: 9_007_199_254_740, active: { depth: 1_000_001, hits: PARAMS.vein.hits - 1, expiresAtMs: 9_007_199_254_740 } };
  r.pendingOffline = { coins: NUM_MAX, ms: 12 * 3_600_000 };
  r.stratumSeen = [0, 1, 2, 3, 4, 5];
  r.interludeMs = PARAMS.interludeMs;
  s.clock.playedMs = 9_007_199_254_740;
  s.meta.yunohana = { lifetime: NUM_MAX, spent: num(PERK_IDS.reduce((a, id) => a + PERK_BY_ID[id].cost, 0)) };
  s.meta.perks = [...PERK_IDS];
  s.meta.prestiges = 1_000_000;
  s.meta.lastPrestigeGain = NUM_MAX;
  s.meta.terrainsUnlocked = [...TERRAIN_IDS];
  s.meta.endingSeen = true;
  s.meta.tickets = PARAMS.tickets.max;
  s.collection.ores = Object.fromEntries(ORE_IDS.map((id) => [id, 9_007_199_254_740]));
  s.collection.springsSeen = [...ids];
  s.collection.guestsSeen = Object.fromEntries(GUESTS.map((g) => [g.id, 9_007_199_254_740]));
  s.collection.achievements = Array.from({ length: MAX_ID_LIST }, (_, i) => `a${String(i).padStart(3, '0')}_${'x'.repeat(59)}`);
  s.stats = { totalCoins: NUM_MAX, taps: 9_007_199_254_740, hits: 9_007_199_254_740, blocks: 9_007_199_254_740, bestDepth: 1_000_000, offlineMaxMs: 12 * 3_600_000 };
  s.tutorial = { step: 99, dismissed: true };
  r.guests = computeGuests(s);
  return s;
}

/** 4 種の状態（今の版） */
export function fixtureStates(): Record<FixtureKind, GameState> {
  return { early: early(), 'pre-prestige': prePrestige(), 'post-prestige': postPrestige(), max: maxState() };
}

/** 今の版の封筒の文字列 */
export const envelopeV2 = (s: GameState, seq: number): string => encodeSave(s, seq, SAVED_AT, APP_VERSION);

/** 版 1 の封筒の文字列（版 2 で足した欄を除き、schema 1。checksum は版 1 の game に付ける） */
export function envelopeV1(s: GameState, seq: number): string {
  const game = JSON.parse(JSON.stringify(toSaveGame(s))) as Record<string, unknown> & { run: Record<string, unknown>; meta: Record<string, unknown> };
  delete game.meta.lastPrestigeGain;
  delete game.run.startDepth;
  // 版 1 の木は形だけを見ていた（ID を定義していない）。版 1 のビルドで木を取る手段はなかったので、版 1 の見本の木は空
  game.meta.perks = [];
  (game.meta.yunohana as Record<string, unknown>).spent = '0';
  game.schema = 1;
  return JSON.stringify({ schema: 1, seq, savedAt: SAVED_AT, appVersion: `${APP_VERSION}-v1`, checksum: checksumOf(game), game });
}

/** 新しい版（今の版より大きい）の見本: 封筒の schema だけを大きくし、知らない欄を足す（将来の版を模す） */
export function envelopeNewer(s: GameState, schema: number): string {
  const env = JSON.parse(envelopeV2(s, 9)) as Record<string, unknown> & { game: Record<string, unknown> };
  return JSON.stringify({ ...env, schema, game: { ...env.game, schema, futureField: { note: 'unknown to this build' } } });
}
