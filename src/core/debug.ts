// テスト用フックの core 側の関数（arch §8-4・Q-16。フックの本体は PM の BL-071 が app/test-hooks.ts に作る）
// - applyGrant: コイン・チケットは「足す」、深さは「置き換え」。飛ばした帯と源泉は、幕間やイベントなしで「入った・見つけた」ことにする
import { PARAMS } from '../content/params.ts';
import { SPRINGS } from '../content/springs.ts';
import { STRATA } from '../content/strata.ts';
import type { GameEvent } from './events.ts';
import { add, num, ZERO } from './num.ts';
import type { GameState } from './state.ts';
import { discoverSpring, markStratumSeen } from './step.ts';

export interface GrantInput {
  /** 足すコイン（Decimal の文字列。例 "1e6"。数値も受け付ける） */
  coins?: string | number;
  /** 足すチケット（整数。10 で止め、超えた分は捨てる） */
  tickets?: number;
  /** 今の深さをこの値にする（整数。最深は大きいほう、ブロックのダメージは 0） */
  depth?: number;
}

const DECIMAL_TEXT = /^\s*[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * テスト用フックの grant（Q-16）。形の正しくない値は例外（テストの書き間違いに気づけるように。状態は変えない）。
 * 戻り値は起きたイベント（お客さんの来訪など。SpringFound・StratumEntered は出さない）
 */
export function applyGrant(s: GameState, p: GrantInput): GameEvent[] {
  if (typeof p !== 'object' || p === null) throw new TypeError('grant: object required');
  const { coins, tickets, depth } = p;
  if (coins !== undefined && !(typeof coins === 'number' ? Number.isFinite(coins) && coins >= 0 : typeof coins === 'string' && DECIMAL_TEXT.test(coins)))
    throw new TypeError(`grant: coins must be a non-negative Decimal string: ${String(coins)}`);
  if (tickets !== undefined && !isCount(tickets)) throw new TypeError(`grant: tickets must be a non-negative integer: ${String(tickets)}`);
  if (depth !== undefined && !isCount(depth)) throw new TypeError(`grant: depth must be a non-negative integer: ${String(depth)}`);

  const out: GameEvent[] = [];
  const r = s.run;
  if (coins !== undefined) {
    const c = num(coins);
    r.coins = add(r.coins, c);
    s.stats.totalCoins = add(s.stats.totalCoins, c);
  }
  if (tickets !== undefined) s.meta.tickets = Math.min(PARAMS.tickets.max, s.meta.tickets + tickets);
  if (depth !== undefined) {
    r.depth = depth;
    r.blockDmg = ZERO;
    r.interludeMs = 0;
    if (depth > r.maxDepth) r.maxDepth = depth;
    if (depth > s.stats.bestDepth) s.stats.bestDepth = depth;
    // 開始の深さが depth 以下の帯は「入ったことにする」（幕間・StratumEntered なし）
    STRATA.forEach((b, i) => {
      if (b.start <= depth) markStratumSeen(s, i);
    });
    // depth 以下の源泉は発見済みにする（ポンプ Lv1・空いている枠。SpringFound は出さない）
    for (const sp of SPRINGS) if (sp.depth <= depth) discoverSpring(s, sp.id, false, out);
  }
  return out;
}
