// テスト用フック window.__game を Node 側から呼ぶための型付きの薄い包み（arch §8-4・BL-071）。
// ここに書く API は設計書どおり。いまのビルドに無いものは gaps.ts の KNOWN_GAPS に載せ、使うテストを保留にする。
import type { Page } from '@playwright/test';
import { blockHp, deserializeState, drillPower } from '../../src/core/index.ts';

/** getState() の戻り値（JSON。Decimal は文字列）。E2E が読むフィールドだけを型にする（arch §6-1） */
export interface SerializedState {
  schema: number;
  clock: { lastWallMs?: number; playedMs: number };
  run: {
    seed: number;
    coins: string;
    depth: number;
    maxDepth: number;
    blockDmg: string;
    drill: { level: number; tool: number };
    autoDig: { level: number; on: boolean };
    [k: string]: unknown;
  };
  meta: { tickets?: number; [k: string]: unknown };
  stats: { hits?: number; taps?: number; blocks: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface GameEvent {
  type: string;
  [k: string]: unknown;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  events: GameEvent[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlatformCall {
  name: string;
  [k: string]: unknown;
}

export type AdResult = 'rewarded' | 'failed' | 'unavailable';

/** arch §8-4 の TestHooks のメンバー名（TS-071-01 の一覧。platform は 2 つに分けて数える） */
export const HOOK_MEMBERS = [
  'version',
  'target',
  'getState',
  'stateHash',
  'setState',
  'seed',
  'pause',
  'resume',
  'advance',
  'setClock',
  'dispatch',
  'grant',
  'rect',
  'events',
  'platform.calls',
  'platform.setAdResult',
  'errors',
] as const;
export type HookMember = (typeof HOOK_MEMBERS)[number];

/** window.__game のメンバーを path（'platform.calls' など）で呼ぶ。引数・戻り値は JSON で受け渡す */
async function call<T>(page: Page, path: string, args: unknown[] = []): Promise<T> {
  return page.evaluate(
    ([p, a]) => {
      const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
      if (!g) throw new Error('window.__game がありません（e2e ビルドで実行してください）');
      const parts = p.split('.');
      let owner: Record<string, unknown> = g;
      for (const k of parts.slice(0, -1)) owner = owner[k] as Record<string, unknown>;
      const fn = owner[parts[parts.length - 1] ?? ''];
      if (typeof fn !== 'function') throw new Error(`window.__game.${p} がありません（BL-071 の API）`);
      const r = (fn as (...x: unknown[]) => unknown).apply(owner, a);
      // Decimal などのクラスを JSON にしてから返す（getState の仕様: JSON）
      return r === undefined ? undefined : (JSON.parse(JSON.stringify(r)) as unknown);
    },
    [path, args] as const,
  ) as Promise<T>;
}

async function read<T>(page: Page, prop: 'version' | 'target'): Promise<T> {
  return page.evaluate((k) => (window as unknown as { __game: Record<string, unknown> }).__game[k], prop) as Promise<T>;
}

/** arch §8-4 の API。各メソッドはページの中の window.__game をそのまま呼ぶ */
export function hooks(page: Page) {
  return {
    version: () => read<string>(page, 'version'),
    target: () => read<string>(page, 'target'),
    getState: () => call<SerializedState>(page, 'getState'),
    stateHash: () => call<string>(page, 'stateHash'),
    setState: (s: SerializedState) => call<void>(page, 'setState', [s]),
    /** シードを指定して新しいゲームを始める */
    seed: (n: number) => call<void>(page, 'seed', [n]),
    /** 実時間のループを止める／再開する */
    pause: () => call<void>(page, 'pause'),
    resume: () => call<void>(page, 'resume'),
    /** ロジックだけを ms 進める。input は毎秒の打数・長押し */
    advance: (ms: number, input?: { tapsPerSec?: number; hold?: boolean }) =>
      call<GameEvent[]>(page, 'advance', input === undefined ? [ms] : [ms, input]),
    /** アプリの壁時計を差し替える（オフライン・保存時刻のテスト） */
    setClock: (wallMs: number) => call<void>(page, 'setClock', [wallMs]),
    dispatch: (a: Record<string, unknown>) => call<ActionResult>(page, 'dispatch', [a]),
    grant: (p: { coins?: string; tickets?: number; depth?: number }) => call<void>(page, 'grant', [p]),
    /** キャンバス内の要素の画面上の矩形（CSS ピクセル）。無ければ null */
    rect: (id: string) => call<Rect | null>(page, 'rect', [id]),
    events: (limit?: number) => call<GameEvent[]>(page, 'events', limit === undefined ? [] : [limit]),
    calls: () => call<PlatformCall[]>(page, 'platform.calls'),
    setAdResult: (r: AdResult) => call<void>(page, 'platform.setAdResult', [r]),
    errors: () => call<string[]>(page, 'errors'),
  };
}
export type Hooks = ReturnType<typeof hooks>;

/** いまのページの window.__game にあるメンバー（HOOK_MEMBERS のうち） */
export async function presentHookMembers(page: Page): Promise<HookMember[]> {
  const present = await page.evaluate((names) => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return [];
    return names.filter((n) => {
      let v: unknown = g;
      for (const k of n.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
      return v !== undefined;
    });
  }, [...HOOK_MEMBERS]);
  return present;
}

/**
 * 打撃の総数（E1 の「打撃数の数え方」）。state.stats.hits があればそれを使う。
 * 無ければ「壊したブロックの HP の合計＋今のブロックのダメージ」÷ ドリル威力 で求める
 * （測る間は威力が変わらない前提。式は core の blockHp・drillPower をそのまま使う）
 */
export function hitsOf(s: SerializedState): number {
  if (typeof s.stats.hits === 'number') return s.stats.hits;
  const gs = deserializeState(JSON.stringify(s));
  let dmg = Number(s.run.blockDmg);
  for (let d = 0; d < s.run.depth; d++) dmg += blockHp(gs, d).toNumber();
  return Math.round(dmg / drillPower(gs).toNumber());
}

/** Decimal の文字列（"3.418"・"1.2e45"）を number に（E2E で扱う範囲は小さい） */
export const coinsOf = (s: SerializedState): number => Number(s.run.coins);
