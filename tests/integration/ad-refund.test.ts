// BL-059・決定 0010 の 11: 払ったチケットの返却（adRefund）を、本物の store・ご褒美の口（app/rewards.ts）・広告の流れ（app/ad-flow.ts）で確かめる。
// 条件は QA の判断 org/30_quality/qa-lead/2026-10-18_compensation-and-public.md §1-3 の 1〜6、場面は §1-6 の ①〜⑦。
// - 流れ: 動画の要求が開始の時間切れ（failed）→ チケットで R2（R1 の ×2）を使う → 遅れて始まった広告を最後まで見る（onLateReward）
//   → grantAd が core に断られる → refundAd → core の refundAdTicket が返すかを決める
// - ⑦（最後まで見なかった）はアダプタが onLateReward を出さない（crazygames-adapter.test.ts の「遅れて始まった後の失敗」）。ここでは
//   知らせが来なければ何も変わらないことだけを見る
import { describe, expect, it } from 'vitest';
import { createAdFlow, type LateKind } from '../../src/app/ad-flow.ts';
import { createRewardHooks } from '../../src/app/rewards.ts';
import { GameStore } from '../../src/app/store.ts';
import { PARAMS } from '../../src/content/params.ts';
import { num, type GameEvent } from '../../src/core/index.ts';
import type { LateReward, Platform, RewardPlacement, RewardResult } from '../../src/platform/types.ts';
import { stateWith } from '../support/states.ts';

const NOW = 1_800_000_000_000;
const CD = PARAMS.boost.cooldownMs;
const MAX = PARAMS.tickets.max;

function rig(tickets = 2) {
  const wall = { t: NOW };
  const s = stateWith({ depth: 10, coins: '1e6' });
  s.meta.tickets = tickets;
  const store = new GameStore(s, {
    onError: (e) => {
      throw e;
    },
  });
  store.useWallClock(() => wall.t);
  const rewards = createRewardHooks(store);
  const lateCbs: ((r: LateReward) => void)[] = [];
  let resolve: ((r: RewardResult) => void) | null = null;
  const ads: Platform['ads'] = {
    rewardedAvailable: () => true,
    showRewarded: () =>
      new Promise<RewardResult>((r) => {
        resolve = r;
      }),
    breakOpportunity: () => Promise.resolve(),
    onPlaying: () => {},
    onLateReward: (cb) => void lateCbs.push(cb),
  };
  const errors: unknown[] = [];
  const flow = createAdFlow({
    ads,
    isMuted: () => false,
    life: { setPaused: () => {} },
    input: { setBlocked: () => {} },
    loop: { pause: () => {}, resume: () => {} },
    isHidden: () => false,
    setMuted: () => {},
    resumeAudio: () => {},
    saveBeforeAd: () => {},
    reserve: (p) => rewards.reserveAd(p),
    grant: (p) => rewards.grantAd(p),
    refund: (p) => rewards.refundAd(p),
    onError: (e) => errors.push(e),
  });
  const told: [RewardPlacement, LateKind][] = [];
  flow.onLateReward((p, k) => told.push([p, k]));
  const events: GameEvent[] = [];
  store.onEvents((evs) => events.push(...evs));
  let nextId = 1;
  return {
    store,
    rewards,
    flow,
    wall,
    told,
    errors,
    events,
    /** 動画を要求して、開始の時間切れ（failed）にする。遅れて見終えたときに使う id を返す */
    timeout: async (p: RewardPlacement): Promise<number> => {
      const pr = flow.requestReward(p);
      await Promise.resolve();
      resolve?.('failed');
      await expect(pr).resolves.toBe('failed');
      return nextId++;
    },
    /** 動画を要求して、ふつうに最後まで見る（rewarded） */
    watch: async (p: RewardPlacement): Promise<void> => {
      const pr = flow.requestReward(p);
      await Promise.resolve();
      resolve?.('rewarded');
      await expect(pr).resolves.toBe('rewarded');
    },
    late: (id: number, placement: RewardPlacement) => lateCbs.forEach((cb) => cb({ id, placement })),
    refunds: () => events.filter((e) => e.type === 'TicketGained' && e.source === 'adRefund'),
  };
}

const coinsOf = (store: GameStore) => ({ coins: store.state.run.coins.toString(), total: store.state.stats.totalCoins.toString() });

describe('R2: 時間切れ → チケットでブースト → 遅れて見終えた広告（決定 0010 の 11）', () => {
  it('① ふつうの返却: 払った 1 枚が戻り（差し引き 0）、ブーストは 1 回のまま（効果・休みは変わらない）。トーストの種類は refund', async () => {
    const r = rig(2);
    const id = await r.timeout('R2');
    r.rewards.useBoostTicket();
    expect(r.store.state.meta.tickets).toBe(1);
    const boost = { ...r.store.state.run.boost };
    const coins = coinsOf(r.store);
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(r.store.state.run.boost).toEqual(boost); // ブーストを二重に掛けない・休みも延ばさない
    expect(coinsOf(r.store)).toEqual(coins);
    expect(r.told).toEqual([['R2', 'refund']]);
    expect(r.refunds()).toEqual([{ type: 'TicketGained', source: 'adRefund', n: 1, overflow: 0, coins: '0' }]);
  });

  it('② 9 枚のときの返却で 10 枚になる', async () => {
    const r = rig(MAX);
    const id = await r.timeout('R2');
    r.rewards.useBoostTicket();
    expect(r.store.state.meta.tickets).toBe(MAX - 1);
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(MAX);
    expect(r.told).toEqual([['R2', 'refund']]);
  });

  it('③ 上限（10 枚）のときは 0 枚で、コイン（stats.totalCoins も）は変わらない。トーストの種類は full。印は外れる（後で返さない）', async () => {
    const r = rig(MAX);
    const id = await r.timeout('R2');
    r.rewards.useBoostTicket();
    r.store.state.meta.tickets = MAX; // 払った後に別の道（鉱脈など）で上限に戻った
    const coins = coinsOf(r.store);
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(MAX);
    expect(coinsOf(r.store)).toEqual(coins);
    expect(r.told).toEqual([['R2', 'full']]);
    expect(r.refunds()).toEqual([{ type: 'TicketGained', source: 'adRefund', n: 0, overflow: 1, coins: '0' }]);
    r.store.state.meta.tickets = MAX - 1;
    const id2 = await r.timeout('R2');
    r.late(id2, 'R2');
    expect(r.store.state.meta.tickets).toBe(MAX - 1); // 1 回の R2 につき返却は 0 か 1
  });

  it('④ 広告で始めた回では返さない（要求 1 が時間切れ → 要求 2 を最後まで見て広告でブースト → 要求 1 の遅れた広告）。知らせもしない', async () => {
    const r = rig(2);
    const id = await r.timeout('R2');
    await r.watch('R2');
    expect(r.store.state.meta.tickets).toBe(2);
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(2); // 払っていないのに +1 にしない（広告がチケットの蛇口にならない）
    expect(r.told).toEqual([]);
    expect(r.refunds()).toEqual([]);
  });

  it('④ 休みだけの回（ブーストを使っていない・前の回の効果が終わった休み中）でも返さない', async () => {
    const r = rig(2);
    r.store.state.run.boost.readyAtWallMs = NOW + CD; // 休み中（どの回で始めたかは分からない＝印がない）
    const id = await r.timeout('R2');
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(r.told).toEqual([]);
  });

  it('⑤ 時間切れの後にもう一度要求して、遅れた広告が 2 本来ても、返すのは 1 枚', async () => {
    const r = rig(2);
    const a = await r.timeout('R2');
    const b = await r.timeout('R2');
    r.rewards.useBoostTicket();
    r.late(a, 'R2');
    r.late(b, 'R2');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(r.told).toEqual([['R2', 'refund']]);
    expect(r.refunds()).toHaveLength(1);
  });

  it('⑥ 休みが明けた後に来たら、返却ではなく Q-45 のふつうの報酬（広告でブースト）。チケットは減ったまま、その後の遅れた広告でも返さない', async () => {
    const r = rig(2);
    const a = await r.timeout('R2');
    const b = await r.timeout('R2');
    r.rewards.useBoostTicket();
    r.wall.t = NOW + CD;
    r.late(a, 'R2');
    expect(r.told).toEqual([['R2', 'reward']]);
    expect(r.store.state.meta.tickets).toBe(1);
    expect(r.store.state.run.boost.readyAtWallMs).toBe(NOW + 2 * CD);
    r.late(b, 'R2'); // 今の回は広告で始めた回
    expect(r.store.state.meta.tickets).toBe(1);
    expect(r.refunds()).toEqual([]);
  });

  it('⑥ 境目（TS-059-27）: 休みが明ける 1ms 前は返却、ちょうどからはふつうのブースト。両方は付かない', async () => {
    const before = rig(2);
    const a = await before.timeout('R2');
    before.rewards.useBoostTicket();
    before.wall.t = NOW + CD - 1;
    before.late(a, 'R2');
    expect(before.told).toEqual([['R2', 'refund']]);
    expect(before.store.state.meta.tickets).toBe(2);
    expect(before.events.filter((e) => e.type === 'BoostStarted')).toHaveLength(1);
    const at = rig(2);
    const b = await at.timeout('R2');
    at.rewards.useBoostTicket();
    at.wall.t = NOW + CD;
    at.late(b, 'R2');
    expect(at.told).toEqual([['R2', 'reward']]);
    expect(at.store.state.meta.tickets).toBe(1);
    expect(at.refunds()).toEqual([]);
    expect(at.events.filter((e) => e.type === 'BoostStarted').map((e) => (e.type === 'BoostStarted' ? e.source : null))).toEqual(['ticket', 'ad']);
  });

  it('⑦ 最後まで見なかった（アダプタが onLateReward を出さない）ときは何も変わらない', async () => {
    const r = rig(2);
    await r.timeout('R2');
    r.rewards.useBoostTicket();
    expect(r.store.state.meta.tickets).toBe(1);
    expect(r.told).toEqual([]);
    expect(r.store.state.run.ticketPaid).toEqual({ R2: true }); // 印は残るが、返すのは遅れた報酬の道だけ
  });

  it('悪用の確かめ: 「時間切れ → チケットでブースト → 遅れた広告」を何度繰り返しても、チケットは増えない（差し引き 0）', async () => {
    const r = rig(3);
    for (let i = 0; i < 6; i++) {
      const a = await r.timeout('R2');
      const b = await r.timeout('R2'); // もう一度押して 2 本流す
      r.rewards.useBoostTicket();
      r.late(a, 'R2');
      r.late(b, 'R2');
      expect(r.store.state.meta.tickets).toBe(3);
      r.wall.t += CD;
    }
    expect(r.refunds()).toHaveLength(6);
    const ticketBoosts = r.events.filter((e) => e.type === 'BoostStarted' && e.source === 'ticket').length;
    expect(r.refunds().length).toBeLessThanOrEqual(ticketBoosts);
  });
});

describe('R1: 時間切れ → チケットで ×2 → 遅れて見終えた広告（決定 0010 の 11。条件は R2 と同じ）', () => {
  const pending = (r: ReturnType<typeof rig>) => {
    r.store.state.run.pendingOffline = { coins: num(1000), ms: 10 * 60_000 }; // BL-030 の代わりに直接置く
  };

  it('① チケットで ×2 を受け取った復帰なら 1 枚返す（コインは ×2 のまま。もう 1 回 ×2 にはしない）', async () => {
    const r = rig(2);
    pending(r);
    const id = await r.timeout('R1');
    r.rewards.claimOffline('double');
    expect(r.store.state.meta.tickets).toBe(1);
    const coins = coinsOf(r.store);
    r.late(id, 'R1');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(coinsOf(r.store)).toEqual(coins);
    expect(r.told).toEqual([['R1', 'refund']]);
  });

  it('×1 で受け取った・広告の ×2 で受け取った復帰では返さない（1-5 の参考: ×1 で閉じた後の遅れた広告は何も付かない＝S4 の既知の問題）', async () => {
    const r = rig(2);
    pending(r);
    const id = await r.timeout('R1');
    r.rewards.claimOffline('normal');
    r.late(id, 'R1');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(r.told).toEqual([]);
    pending(r);
    const id2 = await r.timeout('R1');
    await r.watch('R1');
    r.late(id2, 'R1');
    expect(r.store.state.meta.tickets).toBe(2);
    expect(r.told).toEqual([]);
  });

  it('⑤ 2 本来ても 1 枚。③ 上限なら 0 枚でコインにしない', async () => {
    const r = rig(MAX);
    pending(r);
    const a = await r.timeout('R1');
    const b = await r.timeout('R1');
    r.rewards.claimOffline('double');
    r.store.state.meta.tickets = MAX;
    const coins = coinsOf(r.store);
    r.late(a, 'R1');
    r.late(b, 'R1');
    expect(r.store.state.meta.tickets).toBe(MAX);
    expect(coinsOf(r.store)).toEqual(coins);
    expect(r.told).toEqual([['R1', 'full']]);
  });

  it('R1 と R2 の印は別（R2 の遅れた広告で R1 の分を返さない）', async () => {
    const r = rig(2);
    pending(r);
    const id = await r.timeout('R2');
    r.rewards.claimOffline('double');
    r.store.state.run.boost.readyAtWallMs = NOW + CD; // R2 は休み中（grant が断られる）
    r.late(id, 'R2');
    expect(r.store.state.meta.tickets).toBe(1);
    expect(r.told).toEqual([]);
  });
});
