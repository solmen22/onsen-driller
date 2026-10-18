// BL-058: ご褒美の core（R1〜R3・温泉チケット。TS-058-01〜21。gdd §5-9、arch §6-1〜6-3、QA §3-2(b)、traceability Q-36）
// TS-058-22・23（標準ボットの #19・#21）は BL-033 の sim
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fcRuns } from '../helpers/fc-runs.ts';
import type { EffectKind } from '../../src/content/effects.ts';
import { GUESTS } from '../../src/content/guests.ts';
import { PARAMS } from '../../src/content/params.ts';
import { SPRINGS } from '../../src/content/springs.ts';
import { TOOLS } from '../../src/content/tools.ts';
import {
  advance,
  autoDiggerHitsPerSec,
  checksumOf,
  fromSaveGameTrusted,
  boostView,
  createInitialState,
  dispatch,
  drillPower,
  gainTickets,
  incomePerSec,
  manualRate,
  normalizeBoostClock,
  num,
  offlineClaimView,
  stateHash,
  toSaveGame,
  toStr,
  TICKET_SOURCES,
  veinView,
  type GameEvent,
  type GameState,
  type SaveGame,
  type TicketSource,
} from '../../src/core/index.ts';
import { decodeSave, makeEnvelope } from '../../src/save/codec.ts';
import { parseGame } from '../../src/save/schema.ts';
import { stateWith } from '../support/states.ts';

const MIN = 60_000;
const T0 = 1_800_000_000_000; // 壁時計の起点（2027 年ごろ）

/** 収入のある状態（単純温泉 Lv1 を枠に。タヌキが来る） */
const withIncome = (seed = 1): GameState => stateWith({ seed, pumps: { simple: 5 }, bath: 0, depth: 40 });

const ofType = <K extends GameEvent['type']>(ev: readonly GameEvent[], type: K): Extract<GameEvent, { type: K }>[] =>
  ev.filter((e): e is Extract<GameEvent, { type: K }> => e.type === type);

/** 鉱脈をちょうど今のステップの終わりに出す（次のステップで出る） */
function spawnVeinNow(s: GameState): GameEvent[] {
  s.run.vein.nextAtMs = s.clock.playedMs + 100;
  return advance(s, 100);
}

/** 手動のタップを n 回（連打の上限にかからないよう 200ms ずつ空ける）。各タップの結果とイベント */
function tapSlowly(s: GameState, n: number): { ok: boolean[]; events: GameEvent[] } {
  const ok: boolean[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = dispatch(s, { type: 'tap' });
    ok.push(r.ok);
    events.push(...r.events);
    advance(s, 200, { out: events });
  }
  return { ok, events };
}

describe('温泉チケット（TS-058-01〜05）', () => {
  it('TS-058-01 上限 10。超えた分は「毎秒の収入 × 60 秒」のコイン。収入 0 なら 0', () => {
    const s = withIncome();
    s.meta.tickets = 9;
    const R = incomePerSec(s);
    expect(R.gt(0)).toBe(true);
    const c0 = s.run.coins;
    const ev: GameEvent[] = [];
    gainTickets(s, 'vein', 1, ev);
    expect(s.meta.tickets).toBe(10);
    expect(s.run.coins.eq(c0)).toBe(true);
    gainTickets(s, 'vein', 1, ev);
    expect(s.meta.tickets).toBe(10);
    expect(s.run.coins.sub(c0).toNumber()).toBeCloseTo(R.toNumber() * 60, 6);
    const c1 = s.run.coins;
    gainTickets(s, 'prestige', 2, ev);
    expect(s.run.coins.sub(c1).toNumber()).toBeCloseTo(R.toNumber() * 120, 6);
    expect(ev.map((e) => (e.type === 'TicketGained' ? [e.n, e.overflow] : null))).toEqual([
      [1, 0],
      [0, 1],
      [0, 2],
    ]);
    // 収入 0: 超えた分は 0 コイン（例外なし）
    const z = createInitialState(3);
    z.meta.tickets = 10;
    const out: GameEvent[] = [];
    expect(() => gainTickets(z, 'vein', 1, out)).not.toThrow();
    expect(z.run.coins.eq(0)).toBe(true);
    expect(out).toEqual([{ type: 'TicketGained', source: 'vein', n: 0, overflow: 1, coins: toStr(num(0)) }]);
  });

  it('TS-058-02 新しいゲームは 2 枚（イベントにしない）', () => {
    const s = createInitialState(1);
    expect(s.meta.tickets).toBe(2);
  });

  it('TS-058-03 転生で +2（上限の規則つき）。チケットは次の周回に残る', () => {
    const s = stateWith({ depth: 160 });
    s.meta.tickets = 5;
    const r = dispatch(s, { type: 'prestige' });
    expect(r.ok).toBe(true);
    expect(s.meta.tickets).toBe(7);
    expect(ofType(r.events, 'TicketGained')).toEqual([{ type: 'TicketGained', source: 'prestige', n: 2, overflow: 0, coins: toStr(num(0)) }]);
    const t = stateWith({ depth: 160 });
    t.meta.tickets = 9;
    dispatch(t, { type: 'prestige' });
    expect(t.meta.tickets).toBe(10);
  });

  it('TS-017-12（実装先 BL-058）お客さんの初来訪で 1 枚。2 回目の来訪では付かない', () => {
    const s = stateWith({ pumps: { simple: 1 } }); // 単純温泉は発見済み・枠は空き（stateWith は bath を指定したときだけ枠に詰める）
    s.run.bath.slots = [null];
    s.run.guests = [];
    s.collection.guestsSeen = {};
    s.meta.tickets = 2;
    const a = dispatch(s, { type: 'assignSlot', slot: 0, spring: 'simple' });
    expect(ofType(a.events, 'GuestArrived')).toEqual([{ type: 'GuestArrived', guest: 'tanuki', first: true }]);
    expect(ofType(a.events, 'TicketGained').map((e) => [e.source, e.n])).toEqual([['guestFirstVisit', 1]]);
    expect(s.meta.tickets).toBe(3);
    dispatch(s, { type: 'assignSlot', slot: 0, spring: null });
    const b = dispatch(s, { type: 'assignSlot', slot: 0, spring: 'simple' });
    expect(ofType(b.events, 'GuestArrived')).toEqual([{ type: 'GuestArrived', guest: 'tanuki', first: false }]);
    expect(ofType(b.events, 'TicketGained')).toEqual([]);
    expect(s.meta.tickets).toBe(3);
  });

  it('TS-058-05 チケットで鉱脈は開けない（invalid・状態不変）。チケットを使えるのは R1・R2 だけ', () => {
    const s = withIncome();
    spawnVeinNow(s);
    s.meta.tickets = 3;
    const h = stateHash(s);
    for (const a of [
      { type: 'openVein', source: 'ticket' },
      { type: 'openVein', source: 'hits' },
      { type: 'openVein' },
      { type: 'claimOffline', mode: 'normal', source: 'ticket' },
      { type: 'useBoost', source: 'hits', wallMs: T0 },
      { type: 'useBoost', source: 'ticket' },
      { type: 'useBoost', source: 'ticket', wallMs: Number.NaN },
      { type: 'useBoost', source: 'ticket', wallMs: -1 },
      { type: 'claimOffline', mode: 'double' },
      { type: 'claimOffline', mode: 'triple', source: 'ad' },
      { type: 'refundAdTicket', placement: 'R3' },
      { type: 'refundAdTicket' },
    ]) {
      expect(dispatch(s, a), JSON.stringify(a)).toEqual({ ok: false, reason: 'invalid', events: [] });
    }
    expect(stateHash(s)).toBe(h);
  });
});

/**
 * 温泉チケットを得る出来事の種類（QA の条件 3。Q-36 (a)）。src（TICKET_SOURCES・TicketSource）から import せず、ここに文字どおり書く。
 * src に 6 つ目を足すと、下のテストと型の検査が赤になる。**この一覧を変えるには QA リードの同意が要る**（BL-121。PR #34 のレビュー S-2）。
 * 5 つ目の adRefund（払ったチケットの返却）は QA リードの同意（qa-lead/2026-10-18_compensation-and-public.md §1-3 の条件 1）と決定 0010 の 11
 */
const QA_SOURCES = ['guestFirstVisit', 'achievement', 'prestige', 'vein', 'adRefund'] as const;
type QaSource = (typeof QA_SOURCES)[number];
// 型でも両方向に一致させる（src の TicketSource に足しても、ここから消しても typecheck が赤になる）
const _sourcesExact: [TicketSource, QaSource] extends [QaSource, TicketSource] ? true : never = true;
void _sourcesExact;

describe('BL-121 QA の条件 3: チケットの source は 5 つに閉じる（一覧はテストに文字どおり書く）', () => {
  it('TICKET_SOURCES は QA の 5 つと集合として一致する（順番は問わない・重複なし）', () => {
    expect(new Set(TICKET_SOURCES).size).toBe(TICKET_SOURCES.length);
    expect([...TICKET_SOURCES].sort()).toEqual([...QA_SOURCES].sort());
  });
});

describe('TS-058-04 チケットの不変条件（QA §3-2(b)。Q-36 (a) の条件 1〜4）', () => {
  const FIXED: Record<QaSource, number> = {
    guestFirstVisit: PARAMS.tickets.guestFirstVisit,
    achievement: PARAMS.tickets.achievement,
    prestige: PARAMS.tickets.prestige,
    vein: PARAMS.tickets.vein,
    adRefund: 1, // 返却は 1 回につき最大 1 枚（QA の条件 3）。上限で入らない分は overflow に数え、コインにしない（条件 4）
  };
  const items = ['drill', 'autoDigger', 'bath', 'tool', ...SPRINGS.map((sp) => `pump:${sp.id}`)];
  const opArb = fc.oneof(
    fc.record({ k: fc.constant('buy' as const), item: fc.constantFrom(...items), qty: fc.constantFrom(1, 10, 'max' as const) }),
    fc.record({ k: fc.constant('assign' as const), slot: fc.integer({ min: 0, max: 3 }), spring: fc.constantFrom(null, ...SPRINGS.map((sp) => sp.id)) }),
    fc.record({ k: fc.constant('boost' as const), source: fc.constantFrom('ad' as const, 'ticket' as const) }),
    fc.record({ k: fc.constant('vein' as const) }),
    fc.record({
      k: fc.constant('claim' as const),
      mode: fc.constantFrom('normal' as const, 'double' as const),
      source: fc.constantFrom('ad' as const, 'ticket' as const),
    }),
    fc.record({ k: fc.constant('offline' as const), ms: fc.integer({ min: 0, max: 8 * 3600_000 }), coins: fc.integer({ min: 0, max: 1e9 }) }),
    fc.record({ k: fc.constant('tap' as const), count: fc.integer({ min: 1, max: 20 }) }),
    fc.record({ k: fc.constant('step' as const), ms: fc.integer({ min: 1, max: 9 * MIN }) }),
    fc.record({ k: fc.constant('wall' as const), ms: fc.integer({ min: 0, max: 30 * MIN }) }),
    fc.record({ k: fc.constant('prestige' as const) }),
    fc.record({ k: fc.constant('refund' as const), placement: fc.constantFrom('R1' as const, 'R2' as const) }),
    fc.record({ k: fc.constant('reload' as const) }),
  );

  it('ランダムな操作列: 増加は TicketGained の合計と一致・source は 5 つ・量は固定・回数に上限・0〜10・減るのは R1/R2 の成功で 1 枚・返却は払った回数以下でコインにしない', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.array(opArb, { maxLength: 40 }), (seed, ops) => {
        const s = stateWith({ seed, coins: '1e12', depth: 120, pumps: { simple: 9, co2: 9 }, bath: 15 });
        let wall = T0;
        let guestFirst = 0;
        let veinTickets = 0;
        let veinOpened = 0;
        let prestiges = 0;
        /** チケットで払った回数と返却の回数（placement ごと。§3-2(b) ⑥・QA の条件 3） */
        const paid = { R1: 0, R2: 0 };
        const refunded = { R1: 0, R2: 0 };
        /** 返してよい回か（テストの側の手書きの模型。チケットで払ったら立て、広告・×1・返却・読み込み・転生で倒す。TS-059-30 (b)） */
        const owed = { R1: false, R2: false };
        const unseenAtStart = GUESTS.filter((g) => !Object.hasOwn(s.collection.guestsSeen, g.id)).length;
        for (const op of ops) {
          const before = s.meta.tickets;
          let events: GameEvent[] = [];
          let spent = 0;
          switch (op.k) {
            case 'buy':
              events = dispatch(s, { type: 'buy', item: op.item, qty: op.qty }).events;
              break;
            case 'assign':
              events = dispatch(s, { type: 'assignSlot', slot: op.slot, spring: op.spring }).events;
              break;
            case 'boost': {
              const r = dispatch(s, { type: 'useBoost', source: op.source, wallMs: wall });
              events = r.events;
              if (r.ok && op.source === 'ticket') spent = 1;
              if (r.ok && op.source === 'ticket') paid.R2++;
              if (r.ok) owed.R2 = op.source === 'ticket';
              break;
            }
            case 'vein':
              events = dispatch(s, { type: 'openVein', source: 'ad' }).events;
              break;
            case 'claim': {
              const a = op.mode === 'normal' ? { type: 'claimOffline', mode: 'normal' } : { type: 'claimOffline', mode: 'double', source: op.source };
              const r = dispatch(s, a);
              events = r.events;
              if (r.ok && op.mode === 'double' && op.source === 'ticket') spent = 1;
              if (r.ok && op.mode === 'double' && op.source === 'ticket') paid.R1++;
              if (r.ok) owed.R1 = op.mode === 'double' && op.source === 'ticket';
              break;
            }
            case 'refund': {
              const coins = s.run.coins.toString();
              const total = s.stats.totalCoins.toString();
              const r = dispatch(s, { type: 'refundAdTicket', placement: op.placement });
              events = r.events;
              if (r.ok) refunded[op.placement]++;
              expect(r.ok, '返すのはチケットで払って、まだ返していない回だけ（条件 2・3）').toBe(owed[op.placement]);
              owed[op.placement] = false;
              expect(s.run.coins.toString(), '返却はコインを変えない（条件 4）').toBe(coins);
              expect(s.stats.totalCoins.toString()).toBe(total);
              break;
            }
            case 'offline':
              s.run.pendingOffline = { coins: num(op.coins), ms: op.ms }; // BL-030 の代わりに直接置く
              break;
            case 'tap':
              events = dispatch(s, { type: 'tap', count: op.count }).events;
              break;
            case 'step':
              events = advance(s, op.ms, { stepMs: 1000 });
              break;
            case 'wall':
              wall += op.ms;
              break;
            case 'prestige':
              events = dispatch(s, { type: 'prestige' }).events;
              if (ofType(events, 'PrestigeDone').length > 0) owed.R1 = owed.R2 = false; // 印は新しい周回で消える（条件 5）
              break;
            case 'reload':
              Object.assign(s, fromSaveGameTrusted(toSaveGame(s))); // 保存して読み込む（印は保存しない。条件 5）
              owed.R1 = owed.R2 = false;
              break;
          }
          const gained = ofType(events, 'TicketGained');
          for (const e of gained) {
            expect(QA_SOURCES).toContain(e.source); // ① source は QA の 4 つに閉じる（src の一覧ではなく、テストの一覧と比べる。BL-121）
            expect(e.n + e.overflow).toBe(FIXED[e.source]); // ③ 量は固定（購入の個数・コインの額で変わらない）
            if (e.source === 'guestFirstVisit') guestFirst++;
            if (e.source === 'vein') veinTickets++;
          }
          veinOpened += ofType(events, 'VeinOpened').length;
          prestiges += ofType(events, 'PrestigeDone').length;
          // ① 増加は TicketGained の合計 ⑥ 減るのは R1・R2 の成功だけで 1 枚
          expect(s.meta.tickets - before).toBe(gained.reduce((a, e) => a + e.n, 0) - spent);
          // ⑤ 0〜10・コインは負にならない
          expect(s.meta.tickets >= 0 && s.meta.tickets <= PARAMS.tickets.max && Number.isInteger(s.meta.tickets)).toBe(true);
          expect(s.run.coins.lt(0)).toBe(false);
        }
        // ② 回数の上限
        expect(guestFirst).toBeLessThanOrEqual(unseenAtStart);
        expect(veinTickets).toBeLessThanOrEqual(veinOpened);
        expect(prestiges).toBeLessThanOrEqual(ops.filter((o) => o.k === 'prestige').length);
        // ⑥ 返却の回数 ≤ チケットで払った回数（1 回の R1・R2 につき返却は 0 か 1。純増にならない）
        expect(refunded.R1).toBeLessThanOrEqual(paid.R1);
        expect(refunded.R2).toBeLessThanOrEqual(paid.R2);
      }),
      fcRuns(150),
    );
  });

  it('④ 購入だけの操作列で増えるチケットは「まだ来ていないお客さんの種類の数」以下（条件 2）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.constantFrom(0, 5, 15, 35),
        fc.array(fc.record({ item: fc.constantFrom(...items), qty: fc.constantFrom(1, 10, 'max' as const) }), { maxLength: 60 }),
        (seed, bath, buys) => {
          const s = stateWith({ seed, coins: '1e300', depth: 450, pumps: { simple: 1, co2: 1, salt: 1, sulfur: 1, iron: 1 }, bath });
          const unseen = GUESTS.filter((g) => !Object.hasOwn(s.collection.guestsSeen, g.id)).length;
          let up = 0;
          for (const b of buys) up += ofType(dispatch(s, { type: 'buy', item: b.item, qty: b.qty }).events, 'TicketGained').reduce((a, e) => a + e.n + e.overflow, 0);
          expect(up).toBeLessThanOrEqual(unseen);
        },
      ),
      fcRuns(200),
    );
  });

  it('⑦ コインで買えるもの・源泉・お客さんの効果に、チケット・鉱脈に関わる種類がない（条件 4。種類を足すには QA リードの同意）', () => {
    // EffectKind に種類を足すと、この表が型エラーになる（足すときに条件 4 を見直す）
    const KINDS: Record<EffectKind, true> = {
      incomeAll: true,
      springIncome: true,
      drillPower: true,
      autoDig: true,
      oreValue: true,
      hardness: true,
      digCoins: true,
      offlineEff: true,
    };
    const used = new Set<string>([...SPRINGS.map((sp) => sp.effect.kind), ...GUESTS.map((g) => g.effect.kind)]);
    for (const k of used) expect(Object.keys(KINDS)).toContain(k);
    for (const k of Object.keys(KINDS)) expect(k).not.toMatch(/ticket|vein|reward/i);
    // 道具は倍率（mult）だけ
    for (const t of TOOLS) expect(Object.keys(t).filter((k) => /ticket|vein/i.test(k))).toEqual([]);
  });
});

describe('R2 掘削ブースト（TS-058-06〜12）', () => {
  const boosted = (): GameState => {
    const s = stateWith({ seed: 2, depth: 10, drill: 10, tool: 1, digger: 10, autoOn: true });
    s.meta.tickets = 1;
    return s;
  };

  it('TS-058-06 チケットで使う: チケット 0・5 分・ドリル威力と自動掘削機の打数 ×2。自動掘りの基本・手動の上限は変わらない', () => {
    const s = boosted();
    const p0 = drillPower(s);
    const a0 = autoDiggerHitsPerSec(s);
    const m0 = manualRate(s);
    const r = dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 });
    expect(r).toEqual({
      ok: true,
      events: [{ type: 'BoostStarted', source: 'ticket', remainingMs: 300_000, readyAtWallMs: T0 + 15 * MIN }],
    });
    expect(s.meta.tickets).toBe(0);
    expect(drillPower(s).div(p0).toNumber()).toBeCloseTo(2, 9);
    expect(autoDiggerHitsPerSec(s) / a0).toBeCloseTo(2, 9);
    expect(manualRate(s)).toBe(m0);
    expect(PARAMS.input.manualMaxPerSec).toBe(8);
  });

  it('TS-058-07 299,900ms ではまだ有効、300,000ms で終わる（BoostEnded）。刻み幅（0.1 秒・1 秒）によらない', () => {
    for (const stepMs of [100, 1000]) {
      const s = boosted();
      dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 });
      const ev = advance(s, 299_900, { stepMs });
      expect(ofType(ev, 'BoostEnded'), `step ${stepMs}`).toEqual([]);
      expect(s.run.boost.remainingMs).toBe(100);
      const ev2 = advance(s, 100, { stepMs });
      expect(ofType(ev2, 'BoostEnded')).toHaveLength(1);
      expect(s.run.boost.remainingMs).toBe(0);
      expect(drillPower(s).eq(drillPower(boosted()))).toBe(true);
    }
    // 効果の打撃は刻み幅によらない（効果の終わりでステップを分けるので、×2 の打撃が終わりを越えて入らない）。
    // 自動掘りの基本の端数・移動窓があるので、0.1 秒刻みと 1 秒刻みの打数の差は 1% 以内で見る（arch §8-3・レビュー S-9 と同じ）
    const a = boosted();
    const b = boosted();
    for (const x of [a, b]) dispatch(x, { type: 'useBoost', source: 'ad', wallMs: T0 });
    advance(a, 300_500, { stepMs: 100 });
    advance(b, 300_500, { stepMs: 1000 });
    expect(a.run.boost).toEqual(b.run.boost);
    expect(Math.abs(a.stats.hits - b.stats.hits) / a.stats.hits).toBeLessThanOrEqual(0.01);
    // 1 秒刻みで、効果の終わりが 1 秒の途中（残り 500ms）にあっても、自動掘削機の打数は「×2 で 500ms・×1 で 500ms」になる
    const c = boosted();
    c.run.autoDig.on = false;
    dispatch(c, { type: 'useBoost', source: 'ad', wallMs: T0 });
    advance(c, 299_500, { stepMs: 1000 });
    const h0 = c.stats.hits;
    advance(c, 1000, { stepMs: 1000 });
    expect(autoDiggerHitsPerSec(boosted())).toBe(2); // 自動掘削機 Lv10 は 2 打/秒、ブースト中は 4 打/秒
    // 分けなければ 4 打（＋端数）。分けると 4×0.5 ＋ 2×0.5 ＝ 3 打（端数で 2〜3）
    expect(c.stats.hits - h0).toBeGreaterThanOrEqual(2);
    expect(c.stats.hits - h0).toBeLessThanOrEqual(3);
  });

  it('TS-058-08 効果の残りはオンライン中（ロジックの時間）だけ減る。壁時計だけ進めても減らない', () => {
    const s = boosted();
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 });
    advance(s, 2 * MIN);
    expect(s.run.boost.remainingMs).toBe(3 * MIN);
    expect(boostView(s, T0 + 12 * MIN).remainingMs).toBe(3 * MIN);
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + 12 * MIN })).toEqual({ ok: false, reason: 'active', events: [] });
    advance(s, MIN);
    expect(s.run.boost.remainingMs).toBe(2 * MIN);
  });

  it('TS-058-09 休みは使った時刻から 15 分（壁時計）。14:59.999 は cooldown、15:00 で使える。広告でもチケットでも同じ', () => {
    for (const source of ['ad', 'ticket'] as const) {
      const s = boosted();
      s.meta.tickets = 2;
      dispatch(s, { type: 'useBoost', source, wallMs: T0 });
      advance(s, 5 * MIN);
      expect(s.run.boost.remainingMs).toBe(0);
      const h = stateHash(s);
      expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + 15 * MIN - 1 })).toEqual({ ok: false, reason: 'cooldown', events: [] });
      expect(stateHash(s)).toBe(h);
      expect(boostView(s, T0 + 15 * MIN - 1)).toMatchObject({ canUse: false, reason: 'cooldown', cooldownLeftMs: 1 });
      expect(boostView(s, T0 + 15 * MIN)).toMatchObject({ canUse: true, reason: null, cooldownLeftMs: 0 });
      expect(dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 + 15 * MIN }).ok).toBe(true);
    }
  });

  it('TS-058-10 休みはオフライン中も進む: ロジックを進めずに壁時計を 16 分進めると使える（効果は重ねず 5 分に戻す）', () => {
    const s = boosted();
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 });
    const r = dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + 16 * MIN });
    expect(r.ok).toBe(true);
    expect(s.run.boost).toEqual({ remainingMs: 5 * MIN, readyAtWallMs: T0 + 31 * MIN });
  });

  it('TS-058-11 チケット 0 枚で useBoost(ticket) は insufficient（状態不変・負にならない）', () => {
    const s = boosted();
    s.meta.tickets = 0;
    const h = stateHash(s);
    expect(dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 })).toEqual({ ok: false, reason: 'insufficient', events: [] });
    expect(stateHash(s)).toBe(h);
    expect(boostView(s, T0)).toMatchObject({ canUse: true, canUseTicket: false });
  });

  it('TS-058-12 使用中は active、休み中は cooldown。広告の成功の後の useBoost(ad) が 2 回届いても効果は 1 回', () => {
    const s = boosted();
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 }).ok).toBe(true);
    const h = stateHash(s);
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + 1 })).toEqual({ ok: false, reason: 'active', events: [] });
    expect(dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 + 1 })).toEqual({ ok: false, reason: 'active', events: [] });
    expect(stateHash(s)).toBe(h);
    expect(s.meta.tickets).toBe(1);
    advance(s, 5 * MIN);
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + 6 * MIN })).toEqual({ ok: false, reason: 'cooldown', events: [] });
  });

  it('転生をまたいでも効果の残りと休みは続く（転生で休みを消せない）', () => {
    const s = stateWith({ depth: 160 });
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 });
    advance(s, MIN);
    dispatch(s, { type: 'prestige' });
    expect(s.run.boost).toEqual({ remainingMs: 4 * MIN, readyAtWallMs: T0 + 15 * MIN });
  });
});

describe('BL-120 休みの残りは 15 分を超えない（normalizeBoostClock。PR #34 のレビュー S-1）', () => {
  const CD = PARAMS.boost.cooldownMs; // 15 分
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  /** 時計が進んだ端末（T0）で R2 を使った状態 */
  const usedAt = (wallMs: number): GameState => {
    const s = stateWith({ depth: 10 });
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs }).ok).toBe(true);
    return s;
  };

  it('前提: 休みの長さは PARAMS の 15 分', () => {
    expect(CD).toBe(15 * MIN);
  });

  for (const [name, back] of [
    ['1 時間', HOUR],
    ['1 日', DAY],
  ] as const)
    it(`時計が ${name}戻ると、休みの残りは 15 分に切り詰める（その 15 分後に使える）`, () => {
      const s = usedAt(T0);
      const now = T0 - back;
      expect(s.run.boost.readyAtWallMs - now).toBe(CD + back); // 保存の値は、正規化の前は上限なし（表示は BL-124 で 15 分に抑える）
      expect(normalizeBoostClock(s, now)).toBe(true);
      expect(s.run.boost).toEqual({ remainingMs: PARAMS.boost.durationMs, readyAtWallMs: now + CD }); // 効果の残りは変えない
      expect(boostView(s, now).cooldownLeftMs).toBe(CD);
      expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: now + CD - 1 }).ok).toBe(false);
      advance(s, PARAMS.boost.durationMs); // 効果を終わらせる（休みは壁時計なので、ロジックの時間では進まない）
      expect(boostView(s, now + CD - 1)).toMatchObject({ reason: 'cooldown', cooldownLeftMs: 1 });
      expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: now + CD }).ok).toBe(true);
    });

  it('境界: 残りがちょうど 15 分なら変えない、15 分 + 1ms なら 15 分に戻す', () => {
    const exact = usedAt(T0);
    const h = stateHash(exact);
    expect(normalizeBoostClock(exact, T0)).toBe(false);
    expect(stateHash(exact)).toBe(h);
    expect(exact.run.boost.readyAtWallMs).toBe(T0 + CD);

    const over = usedAt(T0);
    expect(normalizeBoostClock(over, T0 - 1)).toBe(true);
    expect(over.run.boost.readyAtWallMs).toBe(T0 - 1 + CD);
    expect(boostView(over, T0 - 1).cooldownLeftMs).toBe(CD);
  });

  it('休みでない状態（残り 0・休みが終わった後・使ったことがない）と、15 分以内の休みは変えない', () => {
    const cases: [string, GameState, number][] = [
      ['残り 0（ちょうど休みが終わる時刻）', usedAt(T0), T0 + CD],
      ['休みが終わった後', usedAt(T0), T0 + CD + DAY],
      ['休みの途中（残り 1ms）', usedAt(T0), T0 + CD - 1],
      ['使ったことがない（readyAtWallMs = 0）', stateWith({ depth: 10 }), T0],
    ];
    for (const [name, s, now] of cases) {
      const before = { ...s.run.boost };
      const h = stateHash(s);
      expect(normalizeBoostClock(s, now), name).toBe(false);
      expect(s.run.boost, name).toEqual(before);
      expect(stateHash(s), name).toBe(h);
    }
  });

  it('何度呼んでも同じ（2 回目は変えない）', () => {
    const s = usedAt(T0);
    expect(normalizeBoostClock(s, T0 - DAY)).toBe(true);
    const h = stateHash(s);
    expect(normalizeBoostClock(s, T0 - DAY)).toBe(false);
    expect(stateHash(s)).toBe(h);
  });
});

describe('BL-124 休みの上限を core の判定と表示でも守る（解除の時刻は min(readyAtWallMs, wallMs + 15 分)。PR #41 のレビュー S-1）', () => {
  const CD = PARAMS.boost.cooldownMs; // 15 分
  const SEC = 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const usedAt = (wallMs: number): GameState => {
    const s = stateWith({ depth: 10 });
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs }).ok).toBe(true);
    advance(s, PARAMS.boost.durationMs); // 効果を終わらせる（休みだけが残る。理由は cooldown）
    return s;
  };

  it('正規化を呼ばなくても、時計が 1 時間・1 日戻った直後の表示は 15 分、判定は cooldown（状態は変えない）', () => {
    for (const back of [HOUR, DAY]) {
      const s = usedAt(T0);
      const now = T0 - back;
      const h = stateHash(s);
      expect(boostView(s, now)).toMatchObject({ canUse: false, reason: 'cooldown', cooldownLeftMs: CD });
      expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: now })).toEqual({ ok: false, reason: 'cooldown', events: [] });
      expect(stateHash(s)).toBe(h);
    }
  });

  it('境界: 残りがちょうど 15 分・15 分 + 1ms のどちらも表示は 15 分。時計が進んだ場合はふだんどおり', () => {
    const s = usedAt(T0);
    expect(boostView(s, T0).cooldownLeftMs).toBe(CD); // ちょうど 15 分
    expect(boostView(s, T0 - 1).cooldownLeftMs).toBe(CD); // 15 分 + 1ms → 15 分
    expect(boostView(s, T0 + 5 * MIN).cooldownLeftMs).toBe(10 * MIN); // 時計が進む: 残り 10 分
    expect(boostView(s, T0 + CD - 1)).toMatchObject({ reason: 'cooldown', cooldownLeftMs: 1 });
    expect(boostView(s, T0 + CD)).toMatchObject({ canUse: true, reason: null, cooldownLeftMs: 0 });
    expect(boostView(s, T0 + DAY)).toMatchObject({ canUse: true, cooldownLeftMs: 0 });
  });

  it('min だけでは時計が戻った後に過ぎた時間を覚えられない: 正規化しなければ 15 分後も 15:00 のまま（だから app が毎ステップ正規化する）', () => {
    const s = usedAt(T0);
    const now = T0 - DAY;
    expect(boostView(s, now + CD)).toMatchObject({ reason: 'cooldown', cooldownLeftMs: CD });
    expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: now + CD }).ok).toBe(false);
  });

  for (const [name, back] of [
    ['1 時間', HOUR],
    ['1 日', DAY],
  ] as const)
    it(`毎ステップ正規化する（app と同じ）と、遊んでいる最中に時計が ${name}戻っても、残りは 15 分から減り、15 分後に使える`, () => {
      const s = usedAt(T0);
      let wall = T0 + 2 * MIN; // 休みの途中（残り 13 分）
      advance(s, SEC);
      normalizeBoostClock(s, wall);
      expect(boostView(s, wall).cooldownLeftMs).toBe(13 * MIN);
      wall -= back; // 自動の時刻合わせなどで戻る
      const backAt = wall;
      let last = Infinity;
      while (wall < backAt + CD) {
        advance(s, SEC);
        normalizeBoostClock(s, wall);
        const v = boostView(s, wall);
        expect(v.cooldownLeftMs).toBeLessThanOrEqual(CD);
        expect(v.cooldownLeftMs).toBeLessThan(last); // 止まらずに減る
        last = v.cooldownLeftMs;
        expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: wall }).ok).toBe(false);
        wall += SEC;
      }
      advance(s, SEC);
      normalizeBoostClock(s, wall);
      expect(boostView(s, wall)).toMatchObject({ canUse: true, cooldownLeftMs: 0 });
      expect(dispatch(s, { type: 'useBoost', source: 'ad', wallMs: wall }).ok).toBe(true);
    });
});

describe('R3 ラッキー鉱脈（TS-058-13〜18）', () => {
  const spawnTimes = (s: GameState, ms: number, stepMs: number): number[] =>
    ofType(advance(s, ms, { stepMs }), 'VeinSpawned').map((e) => e.expiresAtMs - PARAMS.vein.lifeMs);

  it('TS-058-13 出現の間隔は 5〜8 分・同じシードなら同じ時刻・刻み幅によらない・保存の後も同じ（シード 200 個）', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = createInitialState(seed);
      const b = createInitialState(seed);
      const ta = spawnTimes(a, 17 * MIN, 1000);
      const tb = spawnTimes(b, 17 * MIN, 100);
      expect(ta, `seed ${seed}`).toEqual(tb);
      expect(ta.length).toBeGreaterThanOrEqual(2);
      const gaps = [ta[0] ?? 0, ...ta.slice(1).map((t, i) => t - (ta[i] ?? 0))];
      for (const g of gaps) {
        expect(g).toBeGreaterThanOrEqual(PARAMS.vein.minIntervalMs);
        expect(g).toBeLessThan(PARAMS.vein.maxIntervalMs);
      }
      // 次の出現の時刻は状態に入り、保存・読み込みの後も同じ
      const r = parseGame(toSaveGame(a));
      expect(r.ok && r.state.run.vein.nextAtMs).toBe(a.run.vein.nextAtMs);
    }
  });

  it('TS-058-14 59,999ms ではまだある、60,000ms で消える（VeinExpired・報酬なし）。次の出現が予約される', () => {
    const s = withIncome();
    const ev = spawnVeinNow(s);
    expect(ofType(ev, 'VeinSpawned')).toHaveLength(1);
    const coins = s.run.coins;
    advance(s, 59_999, { stepMs: 1000 });
    expect(veinView(s)).toMatchObject({ active: true, expiresInMs: 1 });
    const ev2 = advance(s, 1);
    expect(ofType(ev2, 'VeinExpired')).toHaveLength(1);
    expect(veinView(s).active).toBe(false);
    expect(ofType(ev2, 'VeinOpened')).toEqual([]);
    expect(s.run.vein.nextAtMs).toBeGreaterThan(s.clock.playedMs);
    expect(s.run.coins.gte(coins)).toBe(true); // 入湯料だけ（鉱脈の報酬はない）
  });

  it('TS-058-15 タップ 14 回では開かない、15 回目で開く。報酬は毎秒の収入 × 90 秒（チケットは周回の擬似乱数）', () => {
    const s = withIncome();
    spawnVeinNow(s);
    const first = tapSlowly(s, 14);
    expect(ofType(first.events, 'VeinOpened')).toEqual([]);
    expect(veinView(s).hitsLeft).toBe(1);
    const R = incomePerSec(s);
    const c0 = s.run.coins;
    const r = dispatch(s, { type: 'tap' });
    const opened = ofType(r.events, 'VeinOpened');
    expect(opened).toHaveLength(1);
    expect(opened[0]?.source).toBe('hits');
    expect(num(opened[0]?.coins).toNumber()).toBeCloseTo(R.toNumber() * 90, 6);
    expect(s.run.coins.sub(c0).toNumber()).toBeGreaterThanOrEqual(R.toNumber() * 90 - 1e-6);
    expect(ofType(r.events, 'TicketGained').length).toBe(opened[0]?.ticket ? 1 : 0);
    expect(veinView(s).active).toBe(false);
  });

  it('TS-058-16 自動掘り・自動掘削機・長押しでは開かない。上限を超えたタップと幕間中のタップは数えない。tap{count} は 1 打ずつ', () => {
    const s = stateWith({ seed: 5, depth: 10, drill: 3, tool: 1, digger: 30, autoOn: true, pumps: { simple: 1 }, bath: 0 });
    spawnVeinNow(s);
    const ev = advance(s, 55_000, { input: { hold: true } });
    expect(ofType(ev, 'VeinOpened')).toEqual([]);
    expect(s.run.vein.active?.hits).toBe(0);
    // 連打の上限: 1 秒に 8 打まで。tap{count: 20} は 8 打だけ数え、続くタップは rateLimited で数えない
    const t = withIncome(6);
    spawnVeinNow(t);
    advance(t, 1000);
    expect(dispatch(t, { type: 'tap', count: 20 }).ok).toBe(true);
    expect(t.run.vein.active?.hits).toBe(8);
    expect(dispatch(t, { type: 'tap' })).toEqual({ ok: false, reason: 'rateLimited', events: [] });
    expect(t.run.vein.active?.hits).toBe(8);
    // 幕間中のタップは数えない
    t.run.interludeMs = 1000;
    expect(dispatch(t, { type: 'tap' }).reason).toBe('interlude');
    expect(t.run.vein.active?.hits).toBe(8);
  });

  it('TS-058-17 openVein(ad) はすぐ開き報酬 1 回。2 回目・出ていない・消えた後は notFound', () => {
    const s = withIncome();
    expect(dispatch(s, { type: 'openVein', source: 'ad' })).toEqual({ ok: false, reason: 'notFound', events: [] });
    spawnVeinNow(s);
    const r = dispatch(s, { type: 'openVein', source: 'ad' });
    expect(r.ok).toBe(true);
    expect(ofType(r.events, 'VeinOpened').map((e) => e.source)).toEqual(['ad']);
    const h = stateHash(s);
    expect(dispatch(s, { type: 'openVein', source: 'ad' })).toEqual({ ok: false, reason: 'notFound', events: [] });
    expect(stateHash(s)).toBe(h);
    spawnVeinNow(s);
    advance(s, MIN);
    expect(dispatch(s, { type: 'openVein', source: 'ad' }).reason).toBe('notFound');
  });

  it('S-5（PR #55 のレビュー。BL-059）: 動画の要求の時点で予約した鉱脈は、要求の間に消えても openVein(ad) で 1 回だけ報酬。予約がなければ消えた後は notFound（TS-058-17 のまま）', () => {
    const s = withIncome();
    expect(dispatch(s, { type: 'reserveVein' })).toEqual({ ok: false, reason: 'notFound', events: [] }); // 出ていなければ予約できない
    spawnVeinNow(s);
    const h = stateHash(s);
    expect(dispatch(s, { type: 'reserveVein' })).toEqual({ ok: true, events: [] });
    expect(stateHash(s)).toBe(h); // 予約は保存しない（保存の形・stateHash は変わらない）
    expect(toSaveGame(s).run.vein).not.toHaveProperty('reserved');
    advance(s, MIN); // 要求の間に消える
    expect(veinView(s).active).toBe(false);
    const R = incomePerSec(s);
    const r = dispatch(s, { type: 'openVein', source: 'ad' });
    expect(r.ok).toBe(true);
    const opened = ofType(r.events, 'VeinOpened');
    expect(opened.map((e) => e.source)).toEqual(['ad']);
    expect(num(opened[0]?.coins).toNumber()).toBeCloseTo(R.toNumber() * PARAMS.vein.incomeSec, 6);
    expect(dispatch(s, { type: 'openVein', source: 'ad' }).reason).toBe('notFound'); // 2 回目はない
  });

  it('S-5: 予約した鉱脈をタップで開いたら予約は外れる（消えた後の広告で二重にしない）。新しい鉱脈が出ていればそれを開き、予約は外れる。読み込みで消える', () => {
    const s = withIncome();
    spawnVeinNow(s);
    dispatch(s, { type: 'reserveVein' });
    advance(s, 1000);
    const hits = tapSlowly(s, PARAMS.vein.hits);
    expect(ofType(hits.events, 'VeinOpened').map((e) => e.source)).toEqual(['hits']);
    expect(s.run.vein.reserved).toBeUndefined();
    expect(dispatch(s, { type: 'openVein', source: 'ad' }).reason).toBe('notFound');
    // 予約した鉱脈が消えた後に次の鉱脈が出た: 広告は出ている鉱脈を開き（1 回）、消えた予約も外れる
    spawnVeinNow(s);
    dispatch(s, { type: 'reserveVein' });
    advance(s, MIN);
    spawnVeinNow(s);
    expect(dispatch(s, { type: 'openVein', source: 'ad' }).ok).toBe(true);
    expect(veinView(s).active).toBe(false);
    expect(s.run.vein.reserved).toBeUndefined();
    expect(dispatch(s, { type: 'openVein', source: 'ad' }).reason).toBe('notFound');
    // 保存しないので、読み込みで予約は消える
    const p = withIncome(3);
    spawnVeinNow(p);
    dispatch(p, { type: 'reserveVein' });
    advance(p, MIN);
    expect(p.run.vein.reserved?.gone).toBe(true);
    const back = parseGame(toSaveGame(p));
    expect(back.ok && back.state.run.vein.reserved).toBeUndefined(); // 読み込みでも消える（要求も消えているため）
  });

  it('TS-058-18 温泉チケットが付く割合は 25% 前後（シード 1,000 個で 20〜30%）。同じシードなら同じ結果', () => {
    const roll = (seed: number): boolean => {
      const s = createInitialState(seed);
      spawnVeinNow(s);
      const r = dispatch(s, { type: 'openVein', source: 'ad' });
      return ofType(r.events, 'VeinOpened')[0]?.ticket === true;
    };
    let hit = 0;
    for (let seed = 1; seed <= 1000; seed++) if (roll(seed)) hit++;
    expect(hit / 1000).toBeGreaterThanOrEqual(0.2);
    expect(hit / 1000).toBeLessThanOrEqual(0.3);
    for (const seed of [1, 7, 99]) expect(roll(seed)).toBe(roll(seed));
  });
});

describe('R1 おかえり ×2（TS-058-19・20）', () => {
  const pending = (ms: number, tickets = 1): GameState => {
    const s = createInitialState(4);
    s.meta.tickets = tickets;
    s.run.pendingOffline = { coins: num(1000), ms };
    return s;
  };

  it('TS-058-19 normal は X、double は 2X。どちらか 1 回だけ。2 回目は notFound。チケットはちょうど 1 枚。normal は常に使える。保存の後も残る', () => {
    const n = pending(3_600_000, 0);
    expect(offlineClaimView(n)).toMatchObject({ canDouble: true, canDoubleTicket: false });
    expect(dispatch(n, { type: 'claimOffline', mode: 'normal' })).toEqual({
      ok: true,
      events: [{ type: 'OfflineClaimed', mode: 'normal', coins: toStr(num(1000)) }],
    });
    expect(n.run.coins.toNumber()).toBe(1000);
    expect(n.run.pendingOffline).toBeNull();
    expect(dispatch(n, { type: 'claimOffline', mode: 'normal' })).toEqual({ ok: false, reason: 'notFound', events: [] });

    const ad = pending(3_600_000);
    expect(dispatch(ad, { type: 'claimOffline', mode: 'double', source: 'ad' }).ok).toBe(true);
    expect(ad.run.coins.toNumber()).toBe(2000);
    expect(ad.meta.tickets).toBe(1);
    expect(dispatch(ad, { type: 'claimOffline', mode: 'double', source: 'ad' }).reason).toBe('notFound');

    const tk = pending(3_600_000);
    expect(dispatch(tk, { type: 'claimOffline', mode: 'double', source: 'ticket' }).ok).toBe(true);
    expect(tk.run.coins.toNumber()).toBe(2000);
    expect(tk.meta.tickets).toBe(0);

    const none = pending(3_600_000, 0);
    const h = stateHash(none);
    expect(dispatch(none, { type: 'claimOffline', mode: 'double', source: 'ticket' })).toEqual({ ok: false, reason: 'insufficient', events: [] });
    expect(stateHash(none)).toBe(h);

    // 保存・読み込みの後も残る（おかえりを閉じても失わない）
    const r = parseGame(toSaveGame(pending(3_600_000)));
    expect(r.ok && r.state.run.pendingOffline).toEqual({ coins: num(1000), ms: 3_600_000 });
  });

  it('TS-058-20 経過時間 59,999ms では ×2 なし（locked・状態不変）、60,000ms からあり', () => {
    const a = pending(59_999);
    expect(offlineClaimView(a)).toMatchObject({ canDouble: false, canDoubleTicket: false });
    const h = stateHash(a);
    expect(dispatch(a, { type: 'claimOffline', mode: 'double', source: 'ticket' })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(dispatch(a, { type: 'claimOffline', mode: 'double', source: 'ad' })).toEqual({ ok: false, reason: 'locked', events: [] });
    expect(stateHash(a)).toBe(h);
    expect(dispatch(a, { type: 'claimOffline', mode: 'normal' }).ok).toBe(true);
    const b = pending(60_000);
    expect(offlineClaimView(b)).toMatchObject({ canDouble: true, canDoubleTicket: true });
    expect(dispatch(b, { type: 'claimOffline', mode: 'double', source: 'ticket' }).ok).toBe(true);
  });

  it('転生で未受け取りのオフライン収入は捨てる（コインは転生でなくなる）', () => {
    const s = stateWith({ depth: 160 });
    s.run.pendingOffline = { coins: num(5), ms: MIN };
    dispatch(s, { type: 'prestige' });
    expect(s.run.pendingOffline).toBeNull();
  });
});

describe('TS-058-21 保存・読み込みの往復（ブースト・休み・鉱脈・チケット）', () => {
  it('すべて同じ値で戻り、続けて進めても同じ結果', () => {
    const s = withIncome(8);
    s.meta.tickets = 5;
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 });
    advance(s, 3 * MIN);
    spawnVeinNow(s);
    tapSlowly(s, 7);
    expect(s.run.vein.active?.hits).toBe(7);
    const r = parseGame(toSaveGame(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.state;
    expect(r.corrected).toEqual([]);
    expect(t.run.boost).toEqual(s.run.boost);
    expect(t.run.vein).toEqual(s.run.vein);
    expect(t.meta.tickets).toBe(5);
    expect(stateHash(t)).toBe(stateHash(s));
    for (const x of [s, t]) {
      advance(x, 30_000);
      tapSlowly(x, 8);
    }
    expect(stateHash(t)).toBe(stateHash(s));
    expect(s.run.vein.active).toBeNull(); // あと 8 回で開いた
  });

  it('pendingOffline を持たない v1 のデータ（BL-058 より前の保存）も読める: 既定値 null で、ほかの値はそのまま（v1 は未公開のため移行なし。CEO 決定 2026-10-04）', () => {
    const s = withIncome(9);
    s.meta.tickets = 4;
    advance(s, 2 * MIN, { input: { hold: true } });
    const old = toSaveGame(s) as unknown as { run: Record<string, unknown> };
    delete old.run.pendingOffline;
    expect(Object.hasOwn(old.run, 'pendingOffline')).toBe(false);
    // 封筒（checksum つき）ごと、古い形の文字列から読む
    const raw = JSON.stringify(makeEnvelope(fromSaveGameTrusted(old as unknown as SaveGame), 1, T0, 'test'));
    const legacy = JSON.parse(raw) as { game: { run: Record<string, unknown> }; checksum: string };
    delete legacy.game.run.pendingOffline;
    legacy.checksum = checksumOf(legacy.game);
    const d = decodeSave(JSON.stringify(legacy));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.state.run.pendingOffline).toBeNull();
    expect(d.state.meta.tickets).toBe(4);
    expect(d.state.run.depth).toBe(s.run.depth);
    expect(d.state.run.coins.eq(s.run.coins)).toBe(true);
    expect(d.corrected).toEqual(['run.pendingOffline']); // 足りない欄を既定値で埋めたことだけが記録される
    expect(stateHash(d.state)).toBe(stateHash(s));
  });

  it('セーブの pendingOffline の補正: 欠けている・オブジェクトでない → null、ms の負・読めない値 → 0、coins の不正 → 0', () => {
    const g = toSaveGame(createInitialState(1)) as unknown as { run: Record<string, unknown> };
    const parse = (v: unknown, del = false): unknown => {
      const run = { ...g.run, pendingOffline: v };
      if (del) delete (run as Record<string, unknown>).pendingOffline;
      const r = parseGame({ ...g, run });
      return r.ok ? r.state.run.pendingOffline : 'rejected';
    };
    expect(parse(undefined, true)).toBeNull();
    expect(parse('x')).toBeNull();
    expect(parse([1, 2])).toBeNull();
    expect(parse({ coins: 'abc', ms: -5 })).toEqual({ coins: num(0), ms: 0 });
    expect(parse({ coins: '1.5e3', ms: 61_000 })).toEqual({ coins: num(1500), ms: 61_000 });
  });
});

describe('払ったチケットの返却（refundAdTicket。決定 0010 の 11・QA の条件 1〜6）', () => {
  const offline = (s: GameState): void => {
    s.run.pendingOffline = { coins: num(1000), ms: 10 * MIN };
  };

  it('チケットで始めた R2 の回だけ 1 枚返し（adRefund）、2 回目は notFound。広告で始めた回・何もしていない回は notFound', () => {
    const s = withIncome();
    s.meta.tickets = 2;
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' })).toEqual({ ok: false, reason: 'notFound', events: [] });
    dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 });
    expect(s.meta.tickets).toBe(1);
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' })).toEqual({
      ok: true,
      events: [{ type: 'TicketGained', source: 'adRefund', n: 1, overflow: 0, coins: '0' }],
    });
    expect(s.meta.tickets).toBe(2);
    expect(s.run.ticketPaid).toBeUndefined();
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + PARAMS.boost.cooldownMs });
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
  });

  it('チケットで始めた回の後に広告で次の回を始めたら、前の回の印は外れる（条件 2）', () => {
    const s = withIncome();
    s.meta.tickets = 2;
    dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 });
    dispatch(s, { type: 'useBoost', source: 'ad', wallMs: T0 + PARAMS.boost.cooldownMs });
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
    expect(s.meta.tickets).toBe(1);
  });

  it('上限（10 枚）なら 0 枚で、コインにしない（n 0・overflow 1・coins 0。収入があっても）。印は外れる', () => {
    const s = withIncome();
    s.meta.tickets = PARAMS.tickets.max;
    dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 });
    s.meta.tickets = PARAMS.tickets.max;
    expect(incomePerSec(s).gt(0)).toBe(true);
    const coins = s.run.coins.toString();
    const total = s.stats.totalCoins.toString();
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).events).toEqual([
      { type: 'TicketGained', source: 'adRefund', n: 0, overflow: 1, coins: '0' },
    ]);
    expect(s.meta.tickets).toBe(PARAMS.tickets.max);
    expect(s.run.coins.toString()).toBe(coins);
    expect(s.stats.totalCoins.toString()).toBe(total);
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
  });

  it('R1: チケットで ×2 を受け取った復帰だけ返す。×1・広告の ×2 では返さない。R1 と R2 の印は別', () => {
    const s = withIncome();
    s.meta.tickets = 2;
    offline(s);
    dispatch(s, { type: 'claimOffline', mode: 'double', source: 'ticket' });
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R1' }).ok).toBe(true);
    expect(s.meta.tickets).toBe(2);
    offline(s);
    dispatch(s, { type: 'claimOffline', mode: 'double', source: 'ticket' });
    offline(s);
    dispatch(s, { type: 'claimOffline', mode: 'normal' }); // 次の復帰を ×1 で受け取った（前の復帰の分は返さない）
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R1' }).ok).toBe(false);
    offline(s);
    dispatch(s, { type: 'claimOffline', mode: 'double', source: 'ad' });
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R1' }).ok).toBe(false);
  });

  it('印は保存しない（条件 5）: 保存して読み込むと消え、返さない側に倒れる。転生でも消える', () => {
    const s = stateWith({ seed: 3, coins: '1e30', depth: 450, pumps: { simple: 9, co2: 9 }, bath: 15 });
    s.meta.tickets = 2;
    dispatch(s, { type: 'useBoost', source: 'ticket', wallMs: T0 });
    offline(s);
    dispatch(s, { type: 'claimOffline', mode: 'double', source: 'ticket' });
    expect(s.run.ticketPaid).toEqual({ R1: true, R2: true });
    expect(JSON.stringify(toSaveGame(s))).not.toContain('ticketPaid');
    const loaded = fromSaveGameTrusted(toSaveGame(s));
    expect(loaded.run.ticketPaid).toBeUndefined();
    expect(dispatch(loaded, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
    expect(dispatch(loaded, { type: 'refundAdTicket', placement: 'R1' }).ok).toBe(false);
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
    expect(s.run.ticketPaid).toBeUndefined();
    expect(dispatch(s, { type: 'refundAdTicket', placement: 'R2' }).ok).toBe(false);
  });
});
