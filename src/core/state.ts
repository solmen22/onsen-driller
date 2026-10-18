// GameState（arch §6-1。BL-010）。core だけが書き換える。UI と描画は selectors で読む
import { PARAMS } from '../content/params.ts';
import type { GuestId } from '../content/guests.ts';
import type { OreId } from '../content/ores.ts';
import type { SpringId } from '../content/springs.ts';
import { INITIAL_TERRAIN, type TerrainId } from '../content/terrains.ts';
import { ZERO, type Num } from './num.ts';
import { normalizeSeed, seedSfc32, sfc32Next, type Sfc32State } from './rng.ts';

/** 保存データの版（save/schema.ts が再輸出する。形を変えたら上げて移行関数を足す） */
export const SAVE_SCHEMA_VERSION = 1;

export type { OreId } from '../content/ores.ts';
/** 改良・湯の華の木・実績の ID（S2 以降で定義する） */
export type UpgradeId = string;
export type PerkId = string;
export type AchId = string;

export interface RunState {
  /** 周回のシード（鉱石の配置など） */
  seed: number;
  terrain: TerrainId;
  coins: Num;
  /** 今掘っているブロックの深さ（掘り終えた m 数）。最初のブロックは 0 */
  depth: number;
  /** 周回の最深 */
  maxDepth: number;
  /** 今のブロックに入ったダメージ */
  blockDmg: Num;
  /** 長押し・自動掘りの基本の打撃の端数（刻み幅によらないため） */
  digCarry: number;
  /** 自動掘削機の打撃の端数 */
  diggerCarry: number;
  /** 幕間の残り（ロジックの時間。0 なら幕間ではない。Q-06） */
  interludeMs: number;
  drill: { level: number; tool: number };
  autoDig: { level: number; on: boolean };
  /** 発見済みの源泉とポンプのレベル */
  springs: Partial<Record<SpringId, { pump: number }>>;
  bath: { level: number; slots: (SpringId | null)[] };
  upgrades: UpgradeId[];
  guests: GuestId[];
  /** 掘削ブースト（S2）: 効果の残り（オンライン中だけ減る）と、次に使える壁時計の時刻 */
  boost: { remainingMs: number; readyAtWallMs: number };
  /**
   * ラッキー鉱脈（S2。BL-058）。時刻はすべてロジックの時間（clock.playedMs）。nextAtMs は次の出現の時刻（0 は未予約で、次のステップで予約する）。
   * active は出ている鉱脈（depth は出たときの深さ、hits はタップの打撃の数、expiresAtMs で消える）
   */
  vein: {
    nextAtMs: number;
    active: null | { depth: number; hits: number; expiresAtMs: number };
    /**
     * 動画の要求の予約（PR #55 のレビュー S-5。BL-059）。R3 の動画を要求した時点の鉱脈（at は その expiresAtMs）を予約し、
     * 要求の間に消えたら gone にする。消えた予約の鉱脈は、広告を見終えたときに 1 回だけ報酬を付ける（Q-45 と同じ考え方）。
     * タップで開いたら予約は外れる（二重にしない）。**保存しない**（toSaveGame に入れない。読み込み・転生で消える＝要求も消えているため）
     */
    reserved?: { at: number; gone: boolean };
  };
  /**
   * チケットで払って、まだ返していない回の印（決定 0010 の 11。QA の条件 2・5）。R2 はチケットのブーストが始めた今の回、
   * R1 はチケットで ×2 を受け取った今の復帰。refundAdTicket が 1 回だけ返して外す。広告で始めた回・×1・広告の ×2 では外す。
   * **保存しない**（toSaveGame に入れない。読み込み・転生で消え、返さない側に倒れる。遅れた報酬はセッションをまたがない）。
   * BL-030 が新しい復帰の pendingOffline を入れるときは R1 を外すこと（前の復帰の分を返さない）
   */
  ticketPaid?: { R1?: true; R2?: true };
  /**
   * 未受け取りのオフライン収入（R1。BL-058・Q-36 (d)）。coins は「受け取る」で入る額、ms はオフラインの経過時間（壁時計）。
   * 付けるのは S3 の BL-030。受け取ったら null に戻す（復帰 1 回につき 1 回）。保存する（おかえりを閉じても失わない）
   */
  pendingOffline: { coins: Num; ms: number } | null;
  /** 幕間を出した帯（0 始まり） */
  stratumSeen: number[];
}

export interface MetaState {
  yunohana: { lifetime: Num; spent: Num };
  perks: PerkId[];
  prestiges: number;
  terrainsUnlocked: TerrainId[];
  endingSeen: boolean;
  /** 温泉チケット（0〜10） */
  tickets: number;
}

export interface GameState {
  schema: number;
  rng: { run: Sfc32State };
  /** ロジックの時間の累計。壁時計の「最後に保存した時刻」は持たない（封筒の savedAt を使う） */
  clock: { playedMs: number };
  run: RunState;
  meta: MetaState;
  collection: {
    ores: Partial<Record<OreId, number>>;
    springsSeen: SpringId[];
    /** 初来訪の壁時計（ms）。core は時刻を読まないので来訪時は 0 を入れ、app が埋める（S2） */
    guestsSeen: Partial<Record<GuestId, number>>;
    achievements: AchId[];
  };
  stats: { totalCoins: Num; taps: number; hits: number; blocks: number; bestDepth: number; offlineMaxMs: number };
  tutorial: { step: number; dismissed: boolean };
  /** 入力の一時状態。保存しない（読み込み後は初期値。Q-10） */
  input: InputState;
}

export interface InputState {
  /** 長押し中か */
  hold: boolean;
  /** 直近の手動の打撃の時刻（playedMs。古い順、最大 8 件。連打の上限を移動窓で数える。Q-04） */
  manualLog: number[];
}

export const createInput = (): InputState => ({ hold: false, manualLog: [] });

export function createRun(seed: number, terrain: TerrainId = INITIAL_TERRAIN): RunState {
  return {
    seed: normalizeSeed(seed),
    terrain,
    coins: ZERO,
    depth: 0,
    maxDepth: 0,
    blockDmg: ZERO,
    digCarry: 0,
    diggerCarry: 0,
    interludeMs: 0,
    drill: { level: 0, tool: 0 },
    autoDig: { level: 0, on: false },
    springs: {},
    bath: { level: 0, slots: [null] },
    upgrades: [],
    guests: [],
    boost: { remainingMs: 0, readyAtWallMs: 0 },
    vein: { nextAtMs: 0, active: null },
    pendingOffline: null,
    stratumSeen: [0],
  };
}

/** 新しいゲーム。シードから擬似乱数の状態と周回のシードを作る（同じシードなら同じ状態） */
export function createInitialState(seed: number): GameState {
  const rng = seedSfc32(seed);
  const runSeed = sfc32Next(rng);
  return {
    schema: SAVE_SCHEMA_VERSION,
    rng: { run: rng },
    clock: { playedMs: 0 },
    run: createRun(runSeed),
    meta: {
      yunohana: { lifetime: ZERO, spent: ZERO },
      perks: [],
      prestiges: 0,
      terrainsUnlocked: [INITIAL_TERRAIN],
      endingSeen: false,
      tickets: PARAMS.tickets.initial,
    },
    collection: { ores: {}, springsSeen: [], guestsSeen: {}, achievements: [] },
    stats: { totalCoins: ZERO, taps: 0, hits: 0, blocks: 0, bestDepth: 0, offlineMaxMs: 0 },
    tutorial: { step: 0, dismissed: false },
    input: createInput(),
  };
}
