// BL-072: CrazyGames アダプタ（src/platform/crazygames.ts）の L2 の契約テスト。SDK は e2e/mocks/crazygames.ts のモック。
// 期待の正本はシナリオ BL-057_crazygames-adapter.md（TS-057-xx。実装先 BL-072 の分）と QA テスト戦略 §4-1・§4-2。
// S1 の tests/integration/platform.test.ts（crazygames 7 件）はそのまま残し、ここではシナリオの ID ごとに確かめる。
//
// まだ本体にない振る舞い（BL-057 の PR〔レビューの S-2・Q-35 (d)・移行〕と S3 の設定の画面）は it.todo で ID と理由を残す。
// BL-057 がマージされたら、実行・修復エンジニアが todo を本物のテストにする（BL-072 の PR の説明に一覧）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGrant, createInitialState } from '../../src/core/index.ts';
import { detectLang } from '../../src/i18n/index.ts';
import { loadSettings, saveSettings, SETTINGS_KEY, DEFAULT_SETTINGS } from '../../src/app/settings.ts';
import { createCrazyGamesPlatform } from '../../src/platform/crazygames.ts';
import type { Platform, RewardResult } from '../../src/platform/types.ts';
import { SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
import { createCrazyMock, type CgAdBehavior, type CrazyMock, type CrazyMockConfig } from '../../e2e/mocks/crazygames.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started(config: Partial<CrazyMockConfig> = {}, adsEnabled = true): Promise<{ sdk: CrazyMock; p: Platform }> {
  const sdk = createCrazyMock(config);
  const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled });
  await p.init();
  return { sdk, p };
}

/** Platform のすべての操作を 1 回ずつ行う（SDK を呼ぶかどうかを見るため） */
async function exerciseAll(p: Platform): Promise<void> {
  p.loadingStart();
  p.loadingStop();
  p.gameplayStart();
  p.gameplayStop();
  p.happyTime();
  await p.ads.showRewarded('R2');
  await p.ads.breakOpportunity('M2');
  p.storage.set('onsen-driller:save:a', 'x');
  p.storage.get('onsen-driller:save:a');
  p.storage.remove('onsen-driller:save:a');
  p.locale();
  p.isMuted();
}

/** localStorage の偽物（書かれたキーを見るため） */
function fakeLocalStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe('TS-057-01 起動（local・crazygames。init が成功）', () => {
  it.each(['local', 'crazygames'] as const)('%s: init を待ってから SDK を使い、保存は data モジュール、動画は VITE_CG_ADS と広告ブロッカーで決まる', async (env) => {
    const { sdk, p } = await started({ environment: env });
    expect(sdk.log[0]).toBe('init');
    expect(p.storage.kind).toBe('sdk');
    p.loadingStart();
    p.loadingStop();
    expect(sdk.log).toEqual(['init', 'loadingStart', 'loadingStop']);
    expect(p.ads.rewardedAvailable()).toBe(true);
    expect((await started({ environment: env }, false)).p.ads.rewardedAvailable(), 'VITE_CG_ADS=false').toBe(false);
    expect((await started({ environment: env, hasAdblock: true })).p.ads.rewardedAvailable(), '広告ブロッカーあり').toBe(false);
  });

  // PR #16 のレビュー S-2（BL-057）: main.ts は init の前に loadingStart を呼ぶので、今は SDK に loadingStart が届かない
  it.todo('TS-057-01 init の前に呼ばれた loadingStart も、init の成功の後に SDK へ loadingStart → loadingStop の順に 1 回ずつ届く（BL-057 の S-2）');
});

describe('TS-057-02 init の失敗・タイムアウト（5 秒）', () => {
  it.each([
    ['reject', { initBehavior: 'reject' }],
    ['返らない', { initBehavior: 'hang' }],
    ['6 秒の遅延', { initDelayMs: 6_000 }],
  ] as [string, Partial<CrazyMockConfig>][])('%s: 5 秒以内に起動が続き、以後 SDK を呼ばない。保存は localStorage（ここではメモリ）、動画は出ない', async (_name, cfg) => {
    vi.useFakeTimers();
    const sdk = createCrazyMock(cfg);
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    let done = false;
    const init = p.init().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(5_000);
    await init;
    expect(done, '5 秒で起動が続く').toBe(true);
    await vi.advanceTimersByTimeAsync(2_000); // 6 秒の遅延の init が後から成功しても使わない
    const before = [...sdk.calls];
    await exerciseAll(p);
    expect(before).toEqual(['init']);
    expect(sdk.calls, 'init の後に SDK を一度も呼ばない').toEqual(['init']);
    expect(p.storage.kind).not.toBe('sdk');
    expect(p.ads.rewardedAvailable()).toBe(false);
  });
});

describe('TS-057-03 environment が disabled（CrazyGames 以外のドメイン）', () => {
  it('init と environment を読む以外に SDK のメソッドを一度も呼ばず、web と同じ動作（localStorage・動画なし）', async () => {
    const { sdk, p } = await started({ environment: 'disabled' });
    await exerciseAll(p);
    expect(sdk.calls).toEqual(['init']);
    expect(p.storage.kind).not.toBe('sdk');
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R1')).toBe('unavailable');
  });
});

describe('TS-057-04 ライフサイクルの呼び出し（冪等）', () => {
  it('SDK の loadingStart/Stop・gameplayStart/Stop が Platform の呼び出しと同じ順・同じ回数（二重に呼ばない）', async () => {
    const { sdk, p } = await started();
    p.loadingStart();
    p.loadingStop();
    p.gameplayStart();
    p.gameplayStart(); // 二重
    p.gameplayStop();
    p.gameplayStop(); // 二重
    p.gameplayStart();
    const expected = ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart'];
    expect(sdk.log.slice(1)).toEqual(expected);
    const platformCalls = p.calls().map((c) => c.name).filter((n) => expected.includes(n));
    expect(platformCalls).toEqual(expected);
  });
});

describe('TS-057-06 音（muteAudio）', () => {
  it('起動時に SDK が消音なら isMuted() が true。途中の変更で onMutedChange が呼ばれ、isMuted() が従う', async () => {
    const sdk = createCrazyMock({ muteAudio: true });
    const p = createCrazyGamesPlatform({ getSdk: () => sdk, adsEnabled: true });
    const seen: boolean[] = [];
    p.onMutedChange((m) => seen.push(m));
    await p.init();
    expect(p.isMuted()).toBe(true);
    sdk.setMute(false);
    expect(p.isMuted()).toBe(false);
    sdk.setMute(true);
    expect(p.isMuted()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  // 設定の sfx（src/app/settings.ts）はまだどこにも結線されていない（設定の画面は S3 の BL-045、効果音は S4 の BL-065）
  it.todo('TS-057-06 SDK の消音はゲームの音の設定より優先し、SDK が消音でなくてもゲームの設定がオフなら鳴らない（BL-045・BL-065 の結線の後）');
});

describe('TS-057-07 言語（user.systemInfo.locale）', () => {
  it.each([
    ['ja-JP', 'ja'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
  ] as const)('%s → %s（ブラウザは en-US）', async (loc, lang) => {
    const { p } = await started({ locale: loc });
    expect(p.locale()).toBe(loc);
    expect(detectLang(p.locale(), 'en-US')).toBe(lang);
  });

  it('SDK に locale がないときは navigator.language（ja-JP のブラウザなら日本語、en-US なら英語）', async () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    const a = (await started({ locale: null })).p;
    expect(a.locale()).toBe('ja-JP');
    expect(detectLang(a.locale(), 'ja-JP')).toBe('ja');
    vi.stubGlobal('navigator', { language: 'en-US' });
    const b = (await started({ locale: null })).p;
    expect(detectLang(b.locale(), 'en-US')).toBe('en');
  });
});

describe('TS-057-08 保存は data モジュール（localStorage に書かない）', () => {
  it('15 秒ごとの保存 3 回と設定の保存が data.setItem に入り、キーはすべて onsen-driller: で始まり、a・b が交互・seq が続く', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls);
    const { sdk, p } = await started();
    expect(p.storage.kind).toBe('sdk');
    const slots = new SaveSlots(p.storage, { appVersion: '0.0.1', now: () => 1_000 });
    slots.load();
    const s = createInitialState(3);
    for (let i = 0; i < 3; i++) {
      applyGrant(s, { coins: String(i + 1) });
      expect(slots.save(s)).toBe(true);
    }
    expect(saveSettings(p.storage, { ...DEFAULT_SETTINGS, lang: 'ja' })).toBe(true);
    const written = sdk.calls.filter((c) => c.startsWith('data.setItem:')).map((c) => c.slice('data.setItem:'.length));
    expect(written).toEqual([SAVE_KEYS.a, SAVE_KEYS.b, SAVE_KEYS.a, SETTINGS_KEY]);
    expect(written.every((k) => k.startsWith('onsen-driller:'))).toBe(true);
    const seqs = [SAVE_KEYS.a, SAVE_KEYS.b].map((k) => (JSON.parse(sdk.store.get(k) ?? '{}') as { seq?: number }).seq);
    expect(seqs).toEqual([3, 2]);
    expect(loadSettings(p.storage).lang).toBe('ja');
    // localStorage には何も残らない（起動時の試し書きのキーも消えている）
    expect([...ls.map.keys()]).toEqual([]);
  });
});

describe('TS-057-10 data モジュールの上限（dataLimitExcedeed）', () => {
  it.each(['throw', 'drop'] as const)('上限を超えると保存は失敗（failing）で、ゲームの状態は失わず、書けるようになれば ok に戻る（%s）', async (behavior) => {
    const { sdk, p } = await started({ dataLimitBehavior: behavior });
    const slots = new SaveSlots(p.storage, { appVersion: '0.0.1', now: () => 1_000 });
    slots.load();
    const s = createInitialState(5);
    applyGrant(s, { coins: '100' });
    expect(slots.save(s)).toBe(true);
    const first = sdk.store.get(SAVE_KEYS.a);
    sdk.configure({ dataLimitBytes: 10 }); // もう入らない
    applyGrant(s, { coins: '1' });
    expect(slots.save(s)).toBe(false);
    expect(slots.status).toBe('failing');
    expect(sdk.store.get(SAVE_KEYS.a), '前の枠は残る').toBe(first);
    expect(sdk.store.has(SAVE_KEYS.b)).toBe(false);
    expect(s.run.coins.toNumber(), 'メモリの進行はそのまま').toBe(101);
    sdk.configure({ dataLimitBytes: 1_000_000 }); // 再試行で書ける
    expect(slots.save(s)).toBe(true);
    expect(slots.status).toBe('ok');
  });
});

describe('TS-057-12 VITE_CG_ADS=false（Basic Launch）', () => {
  it('動画・ミッドゲームを求めても requestAd を一度も呼ばず、動画のボタンは出ない', async () => {
    const { sdk, p } = await started({}, false);
    expect(p.ads.rewardedAvailable()).toBe(false);
    for (const r of ['R1', 'R2', 'R3'] as const) expect(await p.ads.showRewarded(r)).toBe('unavailable');
    await p.ads.breakOpportunity('M1');
    await p.ads.breakOpportunity('M2');
    expect(sdk.calls.some((c) => c.startsWith('requestAd'))).toBe(false);
    expect(p.calls().some((c) => c.name === 'requestAd')).toBe(false);
  });
});

describe('TS-057-13 リワードを最後まで再生', () => {
  it("requestAd('rewarded') が 1 回、adStarted で onPlaying(true)、adFinished で onPlaying(false) と 'rewarded'（結果はちょうど 1 回）", async () => {
    vi.useFakeTimers();
    const { sdk, p } = await started({ adDurationMs: 30_000 });
    const playing: boolean[] = [];
    p.ads.onPlaying((x) => playing.push(x));
    const results: RewardResult[] = [];
    const r = p.ads.showRewarded('R2').then((x) => results.push(x));
    await vi.advanceTimersByTimeAsync(0);
    expect(playing, '再生中').toEqual([true]);
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_000);
    await r;
    expect(playing).toEqual([true, false]);
    expect(results).toEqual(['rewarded']);
    expect(sdk.log.filter((c) => c === 'requestAd:rewarded')).toHaveLength(1);
  });
});

describe('TS-057-14 失敗 4 種（報酬なし）と広告ブロッカー', () => {
  const codes = ['unfilled', 'adblock', 'adCooldown', 'adsDisabledBasicLaunch'] as const;
  it.each(codes)('%s: 報酬なし（failed か unavailable。対応は Q-35 (c)）、始まった後の失敗なら onPlaying(false) で戻る', async (code) => {
    for (const afterStart of [false, true]) {
      const { p } = await started({ adBehavior: code, adErrorAfterStart: afterStart });
      const playing: boolean[] = [];
      p.ads.onPlaying((x) => playing.push(x));
      const r = await p.ads.showRewarded('R2');
      expect(['failed', 'unavailable'], `afterStart=${afterStart}`).toContain(r);
      expect(playing, `afterStart=${afterStart}`).toEqual(afterStart ? [true, false] : []);
    }
  });

  it('adblock を受けた後は rewardedAvailable() が false のまま（動画のボタンを隠す）', async () => {
    const { sdk, p } = await started({ adBehavior: 'adblock' });
    expect(p.ads.rewardedAvailable()).toBe(true);
    await p.ads.showRewarded('R3');
    expect(p.ads.rewardedAvailable()).toBe(false);
    sdk.configure({ adBehavior: 'finish' }); // その後に広告が出せる状態になっても
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R3')).toBe('unavailable');
    expect(sdk.log.filter((c) => c.startsWith('requestAd'))).toHaveLength(1);
  });

  it('init の後の hasAdblock() が true なら最初から false で、requestAd を呼ばない', async () => {
    const { sdk, p } = await started({ hasAdblock: true });
    expect(sdk.calls).toContain('ad.hasAdblock');
    expect(p.ads.rewardedAvailable()).toBe(false);
    expect(await p.ads.showRewarded('R1')).toBe('unavailable');
    expect(sdk.log.some((c) => c.startsWith('requestAd'))).toBe(false);
  });
});

describe('TS-057-15 コールバックが来ない', () => {
  // 仕様が未確定（Q-35 (d)。BL-057 の受け入れ基準に追加済み）。今は来なければ結果も onPlaying(false) も返らない
  it.todo("TS-057-15 adStarted の後に adFinished も adError も来ない／何も来ない: 決めた時間で 'failed' と onPlaying(false) を返す（BL-057 の Q-35 (d)）");
});

describe('TS-057-16 連打（再生に 1 秒）', () => {
  it('再生中にもう一度求めても requestAd は 1 回で、結果は同じ（報酬は合わせて 1 回分）', async () => {
    vi.useFakeTimers();
    const { sdk, p } = await started({ adDurationMs: 1_000 });
    const first = p.ads.showRewarded('R2');
    await vi.advanceTimersByTimeAsync(500);
    const second = p.ads.showRewarded('R2');
    expect(second, '同じ要求の結果を待つ').toBe(first);
    await vi.advanceTimersByTimeAsync(500);
    expect(await Promise.all([first, second])).toEqual(['rewarded', 'rewarded']);
    expect(sdk.log.filter((c) => c === 'requestAd:rewarded')).toHaveLength(1);
    // 終わった後の次の要求は、新しい要求になる
    const third = p.ads.showRewarded('R2');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await third).toBe('rewarded');
    expect(sdk.log.filter((c) => c === 'requestAd:rewarded')).toHaveLength(2);
  });
});

describe('TS-057-17 ミッドゲーム（breakOpportunity）', () => {
  it.each([['finish'], ['adCooldown'], ['unfilled']] as [CgAdBehavior][])("%s: requestAd('midgame') が 1 回、例外にならずに resolve する", async (b) => {
    for (const afterStart of [false, true]) {
      const { sdk, p } = await started({ adBehavior: b, adErrorAfterStart: afterStart });
      const playing: boolean[] = [];
      p.ads.onPlaying((x) => playing.push(x));
      await expect(p.ads.breakOpportunity('M2')).resolves.toBeUndefined();
      expect(sdk.log.filter((c) => c === 'requestAd:midgame')).toHaveLength(1);
      const startedAd = b === 'finish' || afterStart;
      expect(playing, `afterStart=${afterStart}`).toEqual(startedAd ? [true, false] : []);
    }
  });
});

describe('TS-057-09 localStorage → data モジュールの移行', () => {
  // BL-057 の PR（src/save/legacy.ts・Platform.legacyStorage）で入る。そのブランチの tests/integration/crazygames-save.test.ts に本体のテストがある
  it.todo('TS-057-09 最初の起動で localStorage の枠が data モジュールに移り、同じ進行で再開し、2 回目はやり直さない（BL-057・Q-35 (e) の後）');
});
