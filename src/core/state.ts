// GameState（arch §6-1 の PoC 版の部分集合）。core だけが書き換える。
import type { SpringId } from '../content/springs.ts';
import type { GuestId } from '../content/guests.ts';
import { num, type Num } from './num.ts';
import { seedSfc32, sfc32Next, type Sfc32State } from './rng.ts';

export const SAVE_SCHEMA_VERSION = 1;

export interface RunState {
  seed: number;
  coins: Num;
  depth: number;
  maxDepth: number;
  blockDmg: Num;
  /** 端数の打撃（刻み幅によらず同じ打数にするため繰り越す） */
  hitCarry: number;
  hold: boolean;
  drill: { level: number; tool: number };
  autoDig: { level: number; on: boolean };
  springs: Partial<Record<SpringId, { pump: number }>>;
  bath: { level: number; slots: (SpringId | null)[] };
  guests: GuestId[];
}

export interface GameState {
  schema: number;
  rng: { run: Sfc32State };
  clock: { playedMs: number };
  run: RunState;
  meta: { yunohanaLifetime: Num; prestiges: number };
  collection: { guestsSeen: GuestId[]; springsSeen: SpringId[] };
  stats: { totalCoins: Num; hits: number; blocks: number; bestDepth: number };
}

export function createRun(seed: number): RunState {
  return {
    seed: seed >>> 0,
    coins: num(0),
    depth: 0,
    maxDepth: 0,
    blockDmg: num(0),
    hitCarry: 0,
    hold: false,
    drill: { level: 0, tool: 0 },
    autoDig: { level: 0, on: false },
    springs: {},
    bath: { level: 0, slots: [null] },
    guests: [],
  };
}

export function createInitialState(seed: number): GameState {
  const rng = seedSfc32(seed);
  const runSeed = sfc32Next(rng);
  return {
    schema: SAVE_SCHEMA_VERSION,
    rng: { run: rng },
    clock: { playedMs: 0 },
    run: createRun(runSeed),
    meta: { yunohanaLifetime: num(0), prestiges: 0 },
    collection: { guestsSeen: [], springsSeen: [] },
    stats: { totalCoins: num(0), hits: 0, blocks: 0, bestDepth: 0 },
  };
}
