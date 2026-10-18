// BL-072 TS-072-01・02: CrazyGames SDK v3 のモック（e2e/mocks/crazygames.ts）そのものの自己テスト。
// 設定が効いていないモックでは、契約テスト（tests/integration/crazygames-contract.test.ts）が偽の緑になるため、
// QA §4-2 の表の振る舞いを 1 つずつ、アダプタを通さずに SDK として呼んで確かめる。
// あわせて、L3 で使う script（crazyMockScript。関数の文字列から作る）が、ページと同じく外の値なしで動くことを確かめる。
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CgAdCallbacks, CrazySdk } from '../../src/platform/crazygames.ts';
import { CG_MOCK_GLOBAL, createCrazyMock, crazyMock, crazyMockScript, type CgAdBehavior, type CrazyMock } from '../../e2e/mocks/crazygames.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** requestAd を 1 回呼び、届いたコールバックを順に記録する（time ms 進める） */
async function adEvents(m: CrazyMock, type: 'rewarded' | 'midgame', advanceMs = 0): Promise<string[]> {
  const got: string[] = [];
  const cb: CgAdCallbacks = {
    adStarted: () => got.push('adStarted'),
    adFinished: () => got.push('adFinished'),
    adError: (e) => got.push(`adError:${e.code}`),
  };
  m.ad.requestAd(type, cb);
  await Promise.resolve();
  await Promise.resolve();
  if (advanceMs > 0) await vi.advanceTimersByTimeAsync(advanceMs);
  await Promise.resolve();
  return got;
}

describe('TS-072-02 モックはアダプタが使う SDK の型（arch §12-3）を満たす', () => {
  it('CrazySdk として渡せる（型の検査は typecheck。ここでは主な API があることを見る）', () => {
    const sdk: CrazySdk = createCrazyMock();
    expect(typeof sdk.init).toBe('function');
    for (const k of ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'happytime', 'addSettingsChangeListener'] as const)
      expect(typeof sdk.game[k], k).toBe('function');
    expect(typeof sdk.ad.requestAd).toBe('function');
    expect(typeof sdk.ad.hasAdblock).toBe('function');
    for (const k of ['getItem', 'setItem', 'removeItem'] as const) expect(typeof sdk.data?.[k], k).toBe('function');
    expect(sdk.user?.systemInfo?.locale).toBe('ja-JP');
  });
});

describe('TS-072-01 モックの振る舞い（QA §4-2 の表）', () => {
  it('init: 成功・失敗・返らない・遅延（5 秒を超える）', async () => {
    await expect(createCrazyMock().init()).resolves.toBeUndefined();
    await expect(createCrazyMock({ initBehavior: 'reject' }).init()).rejects.toThrow('init failed');
    vi.useFakeTimers();
    let hangDone = false;
    void createCrazyMock({ initBehavior: 'hang' })
      .init()
      .then(() => (hangDone = true));
    let slowDone = false;
    void createCrazyMock({ initDelayMs: 6_000 })
      .init()
      .then(() => (slowDone = true));
    await vi.advanceTimersByTimeAsync(5_999);
    expect([hangDone, slowDone]).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(slowDone).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hangDone, 'hang は返らない').toBe(false);
  });

  it('environment の 3 種（configure で変えられる）', () => {
    const m = createCrazyMock();
    expect(m.environment).toBe('local');
    for (const env of ['crazygames', 'disabled', 'local'] as const) {
      m.configure({ environment: env });
      expect(m.environment).toBe(env);
    }
    expect(crazyMock('disabled').environment).toBe('disabled');
  });

  it('game の呼び出しの順番と回数を記録する（log は S1 の形、calls はすべて）', () => {
    const m = createCrazyMock();
    m.game.loadingStart();
    m.game.loadingStop();
    m.game.gameplayStart();
    m.game.gameplayStart();
    m.game.gameplayStop();
    m.game.happytime();
    const expected = ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStart', 'gameplayStop', 'happytime'];
    expect(m.log).toEqual(expected);
    expect(m.calls).toEqual(expected);
  });

  it('muteAudio: 初期値、setMute・configure でリスナーが呼ばれ settings も変わる', () => {
    const m = createCrazyMock({ muteAudio: true });
    expect(m.game.settings?.muteAudio).toBe(true);
    const seen: (boolean | undefined)[] = [];
    m.game.addSettingsChangeListener?.((s) => seen.push(s.muteAudio));
    m.setMute(false);
    m.configure({ muteAudio: true });
    expect(seen).toEqual([false, true]);
    expect(m.game.settings?.muteAudio).toBe(true);
    expect(m.calls).toContain('game.addSettingsChangeListener');
    expect(m.log, 'log（S1 の形）には購読の登録を入れない').toEqual([]);
  });

  it('requestAd: 最後まで再生（adStarted → adDurationMs の後に adFinished）', async () => {
    vi.useFakeTimers();
    const m = createCrazyMock({ adDurationMs: 1_000 });
    const got: string[] = [];
    m.ad.requestAd('rewarded', { adStarted: () => got.push('s'), adFinished: () => got.push('f'), adError: () => got.push('e') });
    expect(got, '同期では何も来ない').toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(got).toEqual(['s']);
    await vi.advanceTimersByTimeAsync(999);
    expect(got).toEqual(['s']);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual(['s', 'f']);
    expect(m.log).toEqual(['requestAd:rewarded']);
    // 0 秒は次のマイクロタスクで両方
    expect(await adEvents(createCrazyMock(), 'midgame')).toEqual(['adStarted', 'adFinished']);
  });

  it('requestAd: adStartDelayMs の後に始まる（アダプタの開始の時間切れの後に遅れて始まる広告。Q-45）', async () => {
    vi.useFakeTimers();
    const m = createCrazyMock({ adStartDelayMs: 31_000, adDurationMs: 1_000 });
    const got: string[] = [];
    m.ad.requestAd('rewarded', { adStarted: () => got.push('s'), adFinished: () => got.push('f'), adError: () => got.push('e') });
    await vi.advanceTimersByTimeAsync(30_999);
    expect(got).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual(['s']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(got).toEqual(['s', 'f']);
    const e = createCrazyMock({ adStartDelayMs: 5_000, adBehavior: 'unfilled' });
    const ge: string[] = [];
    e.ad.requestAd('rewarded', { adError: (x) => ge.push(x.code) });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(ge, '始まる前の失敗も遅れて来る').toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ge).toEqual(['unfilled']);
  });

  it.each(['unfilled', 'adblock', 'adsDisabledBasicLaunch', 'adCooldown', 'other'] as const)('requestAd: adError %s（始まる前／始まった後）', async (code) => {
    expect(await adEvents(createCrazyMock({ adBehavior: code }), 'rewarded')).toEqual([`adError:${code}`]);
    expect(await adEvents(createCrazyMock({ adBehavior: code, adErrorAfterStart: true }), 'rewarded')).toEqual(['adStarted', `adError:${code}`]);
  });

  it.each([
    ['silent', []],
    ['startedOnly', ['adStarted']],
  ] as [CgAdBehavior, string[]][])('requestAd: %s はその後コールバックが来ない', async (b, expected) => {
    vi.useFakeTimers();
    expect(await adEvents(createCrazyMock({ adBehavior: b }), 'rewarded', 120_000)).toEqual(expected);
  });

  it('hasAdblock: 設定どおり（Promise<boolean>）', async () => {
    await expect(createCrazyMock().ad.hasAdblock?.()).resolves.toBe(false);
    await expect(createCrazyMock({ hasAdblock: true }).ad.hasAdblock?.()).resolves.toBe(true);
  });

  it('data: 読み書き・消去、キーのないときの null／undefined、例外、data モジュールなし', () => {
    const m = createCrazyMock();
    expect(m.data?.getItem('k')).toBeNull();
    m.data?.setItem('k', 'v');
    expect(m.data?.getItem('k')).toBe('v');
    expect(m.store.get('k')).toBe('v');
    m.data?.removeItem('k');
    expect(m.store.has('k')).toBe(false);
    expect(m.calls).toEqual(['data.getItem:k', 'data.setItem:k', 'data.getItem:k', 'data.removeItem:k']);
    expect(m.log, 'log（S1 の形）には data を入れない').toEqual([]);
    expect(createCrazyMock({ dataMissing: 'undefined' }).data?.getItem('x')).toBeUndefined();
    expect(() => createCrazyMock({ dataGetThrows: true }).data?.getItem('x')).toThrow();
    expect(createCrazyMock({ dataModule: false }).data).toBeUndefined();
  });

  it('data: キーと値の合計が上限（既定 1MB）を超える書き込みは dataLimitExcedeed（throw）か黙って書かない（drop）', () => {
    const m = createCrazyMock();
    expect(m.config.dataLimitBytes).toBe(1_000_000);
    m.data?.setItem('a', 'x'.repeat(600_000));
    // 1 件だけなら通るが、合計が上限を超えると失敗し、前の値は残る
    expect(() => m.data?.setItem('b', 'y'.repeat(500_000))).toThrow('dataLimitExcedeed');
    expect(m.store.has('b')).toBe(false);
    // 同じキーの上書きは、古い値を数えない
    m.data?.setItem('a', 'z'.repeat(900_000));
    expect(m.store.get('a')?.length).toBe(900_000);
    // UTF-8 のバイト数で数える（「あ」は 3 バイト。文字数の 4 では上限 9 に収まるが、バイト数の 10 では超える）
    const u = createCrazyMock({ dataLimitBytes: 9 });
    expect(() => u.data?.setItem('k', 'あああ')).toThrow('dataLimitExcedeed'); // 1＋9＝10 バイト
    expect(u.store.has('k')).toBe(false);
    u.data?.setItem('k', 'ああa'); // 1＋7＝8 バイト
    expect(u.store.get('k')).toBe('ああa');
    const d = createCrazyMock({ dataLimitBytes: 5, dataLimitBehavior: 'drop' });
    expect(() => d.data?.setItem('key', 'value')).not.toThrow();
    expect(d.store.has('key')).toBe(false);
  });

  it('user.systemInfo.locale: ja-JP・en-US・fr-FR・なし', () => {
    for (const loc of ['ja-JP', 'en-US', 'fr-FR'] as const) expect(createCrazyMock({ locale: loc }).user?.systemInfo?.locale).toBe(loc);
    expect(createCrazyMock({ locale: null }).user?.systemInfo?.locale).toBeUndefined();
  });

  it('S1 の形（adBehavior・initBehavior の書き換え）も効く', async () => {
    const m = crazyMock();
    m.adBehavior = 'adCooldown';
    m.initBehavior = 'reject';
    expect(m.config.adBehavior).toBe('adCooldown');
    await expect(m.init()).rejects.toThrow();
    expect(await adEvents(m, 'rewarded')).toEqual(['adError:adCooldown']);
  });
});

describe('TS-072-03 の土台: L3 の script（crazyMockScript）が外の値なしで動く', () => {
  it('別の実行環境（vm）で script を動かすと window.CrazyGames.SDK と記録の窓口ができ、設定が効く', async () => {
    const win: Record<string, unknown> = {};
    const sandbox = { window: win, TextEncoder, queueMicrotask, setTimeout, Promise, Map, Error, Object, JSON, String };
    runInNewContext(crazyMockScript({ environment: 'crazygames', locale: 'en-US', adBehavior: 'adCooldown' }), sandbox);
    const sdk = (win['CrazyGames'] as { SDK: CrazyMock }).SDK;
    expect(win[CG_MOCK_GLOBAL]).toBe(sdk);
    expect(sdk.environment).toBe('crazygames');
    expect(sdk.user?.systemInfo?.locale).toBe('en-US');
    await sdk.init();
    sdk.game.loadingStop();
    expect(sdk.log).toEqual(['init', 'loadingStop']);
    const got: string[] = [];
    sdk.ad.requestAd('rewarded', { adError: (e) => got.push(e.code) });
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual(['adCooldown']);
    sdk.data?.setItem('onsen-driller:save:a', 'x');
    expect(sdk.store.get('onsen-driller:save:a')).toBe('x');
  });
});
