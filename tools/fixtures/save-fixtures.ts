// セーブの見本（gdd §10・arch §11。BL-028）: 版ごとに 序盤・転生前・転生後・最大状態 の 4 種を tests/fixtures/saves/v{N}/ に置き、永久に残す。
// - 見本は「その版のビルドが書く封筒の文字列」そのもの（ストレージの値と同じ。1 行の JSON）
// - 状態は標準ボットで遊んで作る（決定的。シード 1）。最大状態は、どの欄も上限・すべての ID・最長の ID で作る
// - 版 1 の見本は、同じ状態から版 2 で足した欄（meta.lastPrestigeGain・run.startDepth）を除き、schema を 1 にして checksum を付け直す
//   （版 1 と版 2 の違いはこの 2 つの欄と schema だけ。arch §11 の版の履歴）
// - どの見本にも run.pendingOffline の欄がある（BL-058 が版 1 のまま足した欄）。転生後の見本は受け取り待ちのオフラインの報酬を持つ
// 書くのは tools/fixtures/make-save-fixtures.ts（ない見本だけを書く。見本は消さない・上書きしない）
import { GUESTS } from '../../src/content/guests.ts';
import { ORE_IDS } from '../../src/content/ores.ts';
import { PARAMS } from '../../src/content/params.ts';
import { PERK_IDS, PERK_BY_ID } from '../../src/content/perks.ts';
import { SPRINGS } from '../../src/content/springs.ts';
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
  step,
  toSaveGame,
  yunohanaGain,
  type GameState,
} from '../../src/core/index.ts';
import { encodeSave } from '../../src/save/codec.ts';
import { MAX_ID_LIST } from '../../src/save/schema.ts';
import { botAct, botTap, BOTS, newBotMemory } from '../sim/bots.ts';

export type FixtureKind = 'early' | 'pre-prestige' | 'post-prestige' | 'max';
export const FIXTURE_KINDS: readonly FixtureKind[] = ['early', 'pre-prestige', 'post-prestige', 'max'];

/** 見本の封筒の固定の値（決定的にするため） */
const SAVED_AT = 1_790_000_000_000;
const APP_VERSION = 'fixture';

/** 標準ボットで ms だけ遊ぶ（5 秒ごとに判断、1 秒刻み）。until が true になったらその時点で止める */
function play(s: GameState, ms: number, until: (s: GameState) => boolean = () => false): GameState {
  const bot = BOTS.standard;
  const mem = newBotMemory(1);
  for (let t = 0; t < ms; t += 1000) {
    if (until(s)) break;
    if (t % 5000 === 0) botAct(s, bot, mem);
    botTap(s, bot, mem, 1000);
    step(s, 1000);
  }
  return s;
}

/** 序盤: 3 分（ツルハシ・ドリル・単純温泉・タヌキのころ） */
function early(): GameState {
  return play(createInitialState(1), 3 * 60_000);
}

/** 転生前: 1 周目で、転生の推奨の手前（湯の華 25 以上・まだ転生していない） */
function prePrestige(): GameState {
  const s = play(createInitialState(1), 60 * 60_000, (x) => yunohanaGain(x).gte(25));
  if (s.meta.prestiges !== 0 || yunohanaGain(s).lt(25)) throw new Error('pre-prestige: 転生の前で止められなかった');
  return s;
}

/** 転生後: 2 回転生して少し遊び、木を少し取った（前回の獲得・使った湯の華）。受け取り待ちのオフラインの報酬を持つ */
function postPrestige(): GameState {
  const s = play(createInitialState(1), 90 * 60_000, (x) => x.meta.prestiges >= 2 && x.run.maxDepth >= 60);
  if (s.meta.prestiges < 2) throw new Error('post-prestige: 2 回転生しなかった');
  for (const perk of ['sharpBlade', 'yumori', 'travelFunds', 'nightDig']) dispatch(s, { type: 'takePerk', perk }); // 木を少し取った（BL-022）
  if (s.meta.perks.length === 0) throw new Error('post-prestige: 木を取れなかった');
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
