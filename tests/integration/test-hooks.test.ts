// BL-071: テスト用フック window.__game（arch §8-4・Q-16）を、本物の store・core・save とつないで Node で確かめる。
// ブラウザでの確認（TS-071-01・03〜09・13・14・22）は E2E（BL-073）で行う。ここはフックの振る舞いの規則を速く確かめる。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppClock, createFakeClock } from '../../src/app/clock.ts';
import { createErrorLog } from '../../src/app/errors.ts';
import { GameStore } from '../../src/app/store.ts';
import { createHooks, install, type HookDeps, type TestHooks } from '../../src/app/test-hooks.ts';
import {
  advance,
  canonicalJson,
  createAdvanceCarry,
  createInitialState,
  fnv1a,
  stateHash,
} from '../../src/core/index.ts';
import { CallLog } from '../../src/platform/base.ts';
import type { Platform, RewardResult } from '../../src/platform/types.ts';
import type { RenderStats } from '../../src/view/game.ts';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/** 記録だけをする偽のアダプタ（setAdResult あり＝dev アダプタの代わり） */
function fakePlatform(target: Platform['target'] = 'web', withAdResult = true): Platform & { adResult: RewardResult | null } {
  const log = new CallLog();
  const p = {
    target,
    adResult: null as RewardResult | null,
    init: () => Promise.resolve(),
    loadingStart: () => log.push('loadingStart'),
    loadingStop: () => log.push('loadingStop'),
    gameplayStart: () => log.push('gameplayStart'),
    gameplayStop: () => log.push('gameplayStop'),
    happyTime: () => log.push('happyTime'),
    ads: {
      rewardedAvailable: () => false,
      showRewarded: () => Promise.resolve('unavailable' as const),
      breakOpportunity: () => Promise.resolve(),
      onPlaying: () => {},
    },
    storage: { get: () => null, set: () => false, remove: () => {}, kind: 'memory' as const },
    locale: () => null,
    isMuted: () => false,
    onMutedChange: () => {},
    openExternalLink: (url: string) => log.push('openExternalLink', url),
    calls: () => log.list(),
  };
  if (withAdResult)
    Object.assign(p, {
      setAdResult: (r: RewardResult) => {
        p.adResult = r;
      },
    });
  return p;
}

const STATS: RenderStats = { zoom: 3, tileSprites: 180, particles: 0, popups: 0, layout: 'landscape' };

interface Rig {
  g: TestHooks;
  store: GameStore;
  platform: ReturnType<typeof fakePlatform>;
  loopCalls: string[];
  notified: () => number;
  wall: ReturnType<typeof createAppClock>;
  saves: string[];
  errors: ReturnType<typeof createErrorLog>;
}

function rig(opts: { seed?: number; platform?: ReturnType<typeof fakePlatform> } = {}): Rig {
  const store = new GameStore(createInitialState(opts.seed ?? 1));
  let n = 0;
  store.subscribe(() => n++);
  const loopCalls: string[] = [];
  const platform = opts.platform ?? fakePlatform();
  const wall = createAppClock(createFakeClock(1_000, 50));
  const saves: string[] = [];
  const errors = createErrorLog();
  const deps: HookDeps = {
    store,
    loop: { pause: () => loopCalls.push('pause'), resume: () => loopCalls.push('resume') },
    platform,
    view: { rectOf: (id) => (id === 'drill' ? { x: 10, y: 20, w: 72, h: 72 } : null), renderStats: () => ({ ...STATS }) },
    clock: wall,
    errors,
    autosave: {
      saveNow: (r) => {
        saves.push(r);
        return true;
      },
    },
  };
  return { g: createHooks(deps), store, platform, loopCalls, notified: () => n, wall, saves, errors };
}

/** arch §8-4 の一覧（TS-071-01。platform は 2 つに分けて数える） */
const MEMBERS = [
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
  'renderStats',
  'events',
  'platform.calls',
  'platform.setAdResult',
  'errors',
];

function member(g: object, path: string): unknown {
  let v: unknown = g;
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

describe('BL-071 フックの一覧（TS-071-01 の Node 版）', () => {
  it('arch §8-4 のメンバーがすべてあり、version は package.json、target はアダプタの target', () => {
    const { g } = rig({ platform: fakePlatform('crazygames') });
    for (const m of MEMBERS) expect(member(g, m), m).toBeDefined();
    expect(g.version).toBe(pkg.version);
    expect(g.target).toBe('crazygames');
  });
});

describe('getState・stateHash（Q-10・Q-16。TS-071-04・05）', () => {
  it('getState は保存する game と同じ形: JSON にでき、input を含まず、Decimal は文字列、stats.hits がある', () => {
    const { g } = rig();
    g.dispatch({ type: 'tap' });
    const s = g.getState();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect('input' in s).toBe(false);
    expect(typeof s.run.coins).toBe('string');
    expect(s.stats.hits).toBe(1);
    expect(s.meta.tickets).toBe(2);
  });
  it('stateHash は getState の正規化 JSON の FNV-1a と同じで、何度呼んでも・setState(getState()) の後も変わらない', () => {
    const { g } = rig();
    g.advance(3_000, { tapsPerSec: 2 });
    const h1 = g.stateHash();
    expect(h1).toBe(fnv1a(canonicalJson(g.getState())));
    expect(g.stateHash()).toBe(h1);
    g.setState(g.getState());
    expect(g.stateHash()).toBe(h1);
  });
  it('getState は複製を返す（戻り値を書き換えても状態は変わらない）', () => {
    const { g, store } = rig();
    const s = g.getState();
    s.run.depth = 99;
    expect(store.state.run.depth).toBe(0);
  });
});

describe('seed（Q-16。TS-071-06）', () => {
  it('同じシードは同じ状態、違うシードは違う状態。入力の状態と advance の端数を初期化し、UI へ通知する', () => {
    const { g, store, notified } = rig();
    g.seed(42);
    const h42 = g.stateHash();
    g.dispatch({ type: 'hold', on: true });
    g.advance(50); // 端数 50ms を持ち越し中
    const n0 = notified();
    g.seed(42);
    expect(g.stateHash()).toBe(h42);
    expect(store.state.input.hold).toBe(false);
    expect(notified()).toBeGreaterThan(n0);
    // 端数が捨てられている: 99ms では 1 ステップも進まない
    g.advance(99);
    expect(store.state.clock.playedMs).toBe(0);
    g.seed(43);
    expect(g.stateHash()).not.toBe(h42);
    expect(g.stateHash()).toBe(stateHash(createInitialState(43)));
  });
  it('数でないシードは例外（状態は変えない）', () => {
    const { g } = rig();
    const h = g.stateHash();
    expect(() => g.seed(Number.NaN)).toThrow(TypeError);
    expect(() => g.seed('1' as unknown as number)).toThrow(TypeError);
    expect(g.stateHash()).toBe(h);
  });
});

describe('advance（Q-16。TS-071-07・09・10）', () => {
  it('100ms 未満の端数を持ち越す: advance(99) は空で進まず、続く advance(1) で 1 ステップ', () => {
    const { g, store } = rig();
    expect(g.advance(99)).toEqual([]);
    expect(store.state.clock.playedMs).toBe(0);
    g.advance(1);
    expect(store.state.clock.playedMs).toBe(100);
    g.advance(100);
    expect(store.state.clock.playedMs).toBe(200);
  });
  it('0 以下・NaN・Infinity は何もせず空の配列（例外なし）', () => {
    const { g } = rig();
    const h = g.stateHash();
    for (const ms of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(g.advance(ms)).toEqual([]);
    expect(g.stateHash()).toBe(h);
  });
  it('tapsPerSec: 自動掘りなしで 1 秒・毎秒 2 打なら打撃が 2 増える（e2e の foundation の突き合わせと同じ）', () => {
    const { g } = rig({ seed: 2 });
    const h0 = g.getState().stats.hits;
    g.advance(1_000, { tapsPerSec: 2 });
    expect(g.getState().stats.hits - h0).toBe(2);
  });
  it('タップの端数も持ち越す: 250ms を 4 回（毎秒 2 打）で 2 打', () => {
    const { g } = rig();
    for (let i = 0; i < 4; i++) g.advance(250, { tapsPerSec: 2 });
    expect(g.getState().stats.hits).toBe(2);
  });
  it('hold: その間だけ長押しにして、終わったら元に戻す', () => {
    const { g, store } = rig();
    g.advance(2_000, { hold: true });
    expect(store.state.input.hold).toBe(false);
    expect(g.getState().stats.hits).toBeGreaterThan(0);
  });
  it('同じシードと入力なら、core の advance（端数の持ち越しつき）と同じ状態になる（TS-071-07 の Node 版）', () => {
    const { g } = rig();
    g.seed(42);
    g.advance(60_000, { tapsPerSec: 2 });
    const ref = createInitialState(42);
    advance(ref, 60_000, { input: { tapsPerSec: 2 }, carry: createAdvanceCarry() });
    expect(g.stateHash()).toBe(stateHash(ref));
  });
  it('深さ 29m から長押しで進めると、戻り値に BlockBroken と StratumEntered（帯 2）が起きた順に入る（TS-071-09 の Node 版）', () => {
    const { g, store } = rig();
    g.grant({ depth: 29 });
    const evs = g.advance(35_000, { hold: true });
    const types = evs.map((e) => e.type);
    expect(types).toContain('BlockBroken');
    expect(evs).toContainEqual({ type: 'StratumEntered', band: 1 });
    expect(types.indexOf('BlockBroken')).toBeLessThan(types.indexOf('StratumEntered'));
    // store の events() にも同じものが残る
    expect(store.events(evs.length)).toEqual(evs);
  });
  it('advance の後に UI へ通知する（TS-E1-08 の前提: HUD・購入ボタンがすぐ新しい値になる）', () => {
    const { g, notified } = rig();
    const n0 = notified();
    g.advance(100);
    expect(notified()).toBeGreaterThan(n0);
  });
  it('入力がオブジェクトでなければ入力なしとして進める', () => {
    const { g, store } = rig();
    g.advance(500, 'x' as unknown as { tapsPerSec: number });
    expect(store.state.clock.playedMs).toBe(500);
    expect(g.getState().stats.hits).toBe(0);
  });
});

describe('setState（Q-10・Q-16。TS-071-20）', () => {
  it('セーブの読み込みと同じ検証で補正して入れ、通知する。入力の状態と端数は初期化', () => {
    const { g, store, notified } = rig();
    g.dispatch({ type: 'hold', on: true });
    g.advance(50);
    const s = g.getState();
    s.run.coins = '1e6';
    s.meta.tickets = 99; // 補正: 10 に収める
    const n0 = notified();
    g.setState(s);
    expect(store.state.run.coins.eq(1e6)).toBe(true);
    expect(store.state.meta.tickets).toBe(10);
    expect(store.state.input.hold).toBe(false);
    expect(notified()).toBeGreaterThan(n0);
    g.advance(99);
    expect(store.state.clock.playedMs).toBe(0);
  });
  it('拒否（オブジェクトでない・run や meta がない）は例外で、今の状態は変えない', () => {
    const { g } = rig();
    g.advance(1_000, { tapsPerSec: 2 });
    const h = g.stateHash();
    for (const bad of [null, 42, 'x', [], { run: { coins: 'abc' } }, { meta: {} }]) expect(() => g.setState(bad), JSON.stringify(bad)).toThrow();
    expect(g.stateHash()).toBe(h);
  });
  it('__proto__ などの危険なキーは捨てる', () => {
    const { g, store } = rig();
    const s = JSON.parse(JSON.stringify(g.getState()).replace('"run":{', '"run":{"__proto__":{"polluted":1},')) as unknown;
    g.setState(s);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.hasOwn(store.state.run, '__proto__')).toBe(false);
  });
});

describe('grant（Q-16。TS-071-13）', () => {
  it('coins・tickets は足し（10 で止める）、depth は置き換え。飛ばした帯・源泉のイベントは出さず、通知する', () => {
    const { g, store, notified } = rig();
    const n0 = notified();
    g.grant({ coins: '1e6' });
    g.grant({ coins: '1e6' });
    g.grant({ tickets: 3 });
    g.grant({ tickets: 30 });
    g.grant({ depth: 29 });
    const s = g.getState();
    expect(Number(s.run.coins)).toBe(2e6);
    expect(s.meta.tickets).toBe(10);
    expect([s.run.depth, s.run.maxDepth]).toEqual([29, 29]);
    expect(notified()).toBeGreaterThan(n0);
    expect(store.events().some((e) => e.type === 'StratumEntered' || e.type === 'SpringFound')).toBe(false);
  });
  it('形の正しくない値は例外で、状態は変えない', () => {
    const { g } = rig();
    const h = g.stateHash();
    expect(() => g.grant({ coins: 'abc' })).toThrow(TypeError);
    expect(() => g.grant({ tickets: -1 })).toThrow(TypeError);
    expect(() => g.grant({ depth: 1.5 })).toThrow(TypeError);
    expect(() => g.grant(null as unknown as { coins: string })).toThrow(TypeError);
    expect(g.stateHash()).toBe(h);
  });
});

describe('dispatch・events・pause／resume', () => {
  it('dispatch は core と同じ結果（コイン不足の buy は ok:false・reason・events 空）で、状態は変えない（TS-071-12 の Node 版）', () => {
    const { g } = rig();
    const h = g.stateHash();
    expect(g.dispatch({ type: 'buy', item: 'drill', qty: 1 })).toEqual({ ok: false, reason: 'insufficient', events: [] });
    expect(g.stateHash()).toBe(h);
    expect(g.dispatch({ type: 'nope' })).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('events は古い順（最後が最新）、events(3) は直近の 3 件、既定は 100 件（TS-071-16 の Node 版）', () => {
    const { g } = rig();
    g.grant({ coins: '1e9' });
    for (let i = 0; i < 5; i++) g.dispatch({ type: 'buy', item: 'drill', qty: 1 });
    const all = g.events();
    expect(all.map((e) => e.type)).toEqual(Array(5).fill('Purchased'));
    expect(g.events(3)).toEqual(all.slice(-3));
    g.grant({ coins: '1e300' });
    for (let i = 0; i < 150; i++) g.dispatch({ type: 'buy', item: 'autoDigger', qty: 1 });
    expect(g.events()).toHaveLength(100);
    expect(g.events(1000)).toHaveLength(155);
  });
  it('pause・resume はループだけを止める・動かす', () => {
    const { g, loopCalls } = rig();
    g.pause();
    g.resume();
    expect(loopCalls).toEqual(['pause', 'resume']);
  });
});

describe('setClock・rect・renderStats・platform・errors・saveNow', () => {
  it('setClock は壁時計を差し替え、null で元に戻す。数・null 以外は例外（TS-071-11 の前提）', () => {
    const { g, wall } = rig();
    expect(wall.wallNow()).toBe(1_000);
    g.setClock(5_000_000);
    expect(wall.wallNow()).toBe(5_000_000);
    g.setClock(null);
    expect(wall.wallNow()).toBe(1_000);
    expect(() => g.setClock('1' as unknown as number)).toThrow(TypeError);
  });
  it("rect は描画の rectOf を返す（'drill' は矩形、知らない ID・S1 で未対応の ID・文字列でない ID は null。TS-071-14 の Node 版）", () => {
    const { g } = rig();
    expect(g.rect('drill')).toEqual({ x: 10, y: 20, w: 72, h: 72 });
    for (const id of ['foo', 'vein', 'slot:0', 'guest:tanuki']) expect(g.rect(id)).toBeNull();
    expect(g.rect(1 as unknown as string)).toBeNull();
  });
  it('renderStats は描画の値をそのまま返す（TS-071-22 の Node 版）', () => {
    const { g } = rig();
    expect(g.renderStats()).toEqual(STATS);
  });
  it('platform.calls はアダプタの記録（呼び出し順）、setAdResult は dev アダプタに渡し、ほかのアダプタでは何もしない', () => {
    const r = rig();
    r.platform.loadingStart();
    r.platform.loadingStop();
    expect(r.g.platform.calls()).toEqual([{ name: 'loadingStart' }, { name: 'loadingStop' }]);
    r.g.platform.setAdResult('failed');
    expect(r.platform.adResult).toBe('failed');
    const other = rig({ platform: fakePlatform('crazygames', false) });
    expect(() => other.g.platform.setAdResult('failed')).not.toThrow();
  });
  it('errors は記録の複製（直近 20 件）', () => {
    const { g, errors } = rig();
    errors.push(new Error('x1'));
    const list = g.errors();
    expect(list).toEqual(['Error: x1']);
    list.push('y');
    expect(g.errors()).toEqual(['Error: x1']);
  });
  it('saveNow は保存の契機（manual）を呼ぶ', () => {
    const { g, saves } = rig();
    expect(g.saveNow()).toBe(true);
    expect(saves).toEqual(['manual']);
  });
});

describe('install（window.__game を置く）', () => {
  it('渡したオブジェクトに __game を置き、PoC の計測用の補助（view.renderer など）も残す', () => {
    const r = rig();
    const target: Record<string, unknown> = {};
    const fakeView = {
      rectOf: () => null,
      renderStats: () => STATS,
      rendererName: () => 'Canvas',
      aliveParticles: () => 7,
      loseContext: () => false,
      restoreContext: () => false,
      game: { loop: { frame: 3 } },
    } as unknown as Parameters<typeof install>[0]['view'];
    const hooks = install(
      {
        store: r.store,
        loop: { pause: () => {}, resume: () => {} },
        platform: r.platform,
        view: fakeView,
        clock: r.wall,
        errors: r.errors,
        perf: null,
        contextEvents: ['lost'],
      },
      target,
    );
    expect(target['__game']).toBe(hooks);
    for (const m of MEMBERS) expect(member(hooks, m), m).toBeDefined();
    const g = target['__game'] as { view: { renderer(): string; particles(): number; contextEvents(): string[]; frame(): number }; perf: { stats(): unknown } };
    expect(g.view.renderer()).toBe('Canvas');
    expect(g.view.particles()).toBe(7);
    expect(g.view.contextEvents()).toEqual(['lost']);
    expect(g.view.frame()).toBe(3);
    expect(g.perf.stats()).toBeNull();
  });
});

describe('本番のビルドに入らないこと（TS-071-03 の静的な裏付け。本判定は check:size）', () => {
  it('main.ts は VITE_TEST_HOOKS のときだけ test-hooks.ts を動的に import し、__game の文字列は test-hooks.ts にだけある', () => {
    const main = readFileSync(new URL('../../src/app/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/if \(import\.meta\.env\.VITE_TEST_HOOKS === 'true'\) \{\s*const m = await import\('\.\/test-hooks\.ts'\);/);
    expect(main).not.toMatch(/from '\.\/test-hooks\.ts'/);
    expect(main.includes('__game')).toBe(false);
    const errors = readFileSync(new URL('../../src/app/errors.ts', import.meta.url), 'utf8');
    expect(errors.includes('__game')).toBe(false);
  });
});
