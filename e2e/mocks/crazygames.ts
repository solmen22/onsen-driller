// CrazyGames HTML5 SDK v3 のモック（BL-072。QA テスト戦略 §4-2 の表・arch §12-3 の API 一覧と同期させる）。
//
// 1 つの関数（createCrazyMock）を 2 か所で使う:
//   - L2（Vitest）: 関数として呼び、アダプタの getSdk に渡す（tests/integration/crazygames-contract.test.ts）
//   - L3（Playwright）: crazyMockScript() が関数の文字列（toString）から script を作り、e2e-crazygames のビルドの
//     https://sdk.crazygames.com/crazygames-sdk-v3.js を page.route でその script に差し替える（e2e/support/crazygames.ts）
// そのため createCrazyMock の中身は**外の変数・import した値を使わない**（型だけは使ってよい。変換で消える）。
//
// 置き場所は e2e/mocks/（arch §4・QA §4-2。確認事項 Q-28 の BL-072 での決定）。tests/mocks/sdk.ts は S1 からの名前で残した再 export。
// **SDK の仕様（arch §12-3）が変わったら、アダプタ（src/platform/crazygames.ts）とこのモックを同じ PR で直す**（readme.md）。
import type { CgAdCallbacks, CgAdType, CrazySdk } from '../../src/platform/crazygames.ts';

/** requestAd の振る舞い（QA §4-2: 最後まで再生／adError 4 種〔＋未知のコード〕／コールバックが来ない） */
export type CgAdBehavior =
  | 'finish'
  | 'unfilled'
  | 'adblock'
  | 'adsDisabledBasicLaunch'
  | 'adCooldown'
  | 'other'
  /** 何のコールバックも来ない */
  | 'silent'
  /** adStarted の後に adFinished も adError も来ない（arch の確認事項 Q-35 (d)） */
  | 'startedOnly';

/** SDK.init() の振る舞い（成功／失敗／返らない。遅延は initDelayMs） */
export type CgInitBehavior = 'ok' | 'reject' | 'hang';

export interface CrazyMockConfig {
  /** SDK.environment（'disabled' は CrazyGames 以外のドメイン） */
  environment: 'local' | 'crazygames' | 'disabled';
  initBehavior: CgInitBehavior;
  /** initBehavior が ok のときに resolve するまでの時間（5 秒を超える遅延の試験。0 はすぐ） */
  initDelayMs: number;
  adBehavior: CgAdBehavior;
  /** adStarted から adFinished（や adErrorAfterStart の adError）までの時間。0 は次のマイクロタスク */
  adDurationMs: number;
  /**
   * requestAd から最初のコールバック（adStarted か、始まる前の adError）までの時間。0 は次のマイクロタスク。
   * アダプタの開始の時間切れ（AD_START_TIMEOUT_MS、30 秒）より長くすると「遅れて始まる広告」を作れる（Q-45 の遅れた報酬）
   */
  adStartDelayMs: number;
  /** adError の前に adStarted を出す（再生が始まってから失敗する型） */
  adErrorAfterStart: boolean;
  /** SDK.ad.hasAdblock() の結果 */
  hasAdblock: boolean;
  /** SDK.game.settings.muteAudio の初期値 */
  muteAudio: boolean;
  /** SDK.user.systemInfo.locale（null は値なし） */
  locale: string | null;
  /** SDK.data（data モジュール）があるか */
  dataModule: boolean;
  /** data モジュールの上限（キーと値の UTF-8 のバイト数の合計。arch §12-3 の 1MB） */
  dataLimitBytes: number;
  /** 上限を超える書き込み: throw＝例外（Error の message が dataLimitExcedeed）、drop＝黙って書かない（本物の形は未確認なので両方を用意） */
  dataLimitBehavior: 'throw' | 'drop';
  /** data.getItem がキーのないときに返す値（S1 再レビュー A-N1。undefined を返す実装を模す） */
  dataMissing: 'null' | 'undefined';
  /** data.getItem が例外を投げる（読めない保存先） */
  dataGetThrows: boolean;
}

export interface CrazyMock extends CrazySdk {
  /** 今の設定（configure で変える） */
  readonly config: CrazyMockConfig;
  /**
   * S1 からの記録（init・game の 5 つ・`requestAd:<type>` を呼ばれた順に）。data・hasAdblock・購読の登録は入らない
   * （S1 の契約テストと BL-057 のブランチがこの形で比べている）
   */
  readonly log: string[];
  /** SDK のすべての呼び出し（log の中身に加え `data.getItem:<キー>`・`data.setItem:<キー>`・`data.removeItem:<キー>`・`ad.hasAdblock`・`game.addSettingsChangeListener`） */
  readonly calls: string[];
  /** data モジュールの中身 */
  readonly store: Map<string, string>;
  /** config.adBehavior と同じ（S1 の形） */
  adBehavior: CgAdBehavior;
  /** config.initBehavior と同じ（S1 の形） */
  initBehavior: CgInitBehavior;
  /** CrazyGames の画面で消音を切り替えたときと同じ（settings.muteAudio を変えてリスナーを呼ぶ） */
  setMute(m: boolean): void;
  /** 設定を変える（muteAudio を含むときは setMute と同じくリスナーも呼ぶ） */
  configure(c: Partial<CrazyMockConfig>): void;
}

/** CrazyGames SDK v3 のモックを作る。**中で外の値を使わない**（crazyMockScript が文字列にしてページで動かすため） */
export function createCrazyMock(initial: Partial<CrazyMockConfig> = {}): CrazyMock {
  const config: CrazyMockConfig = {
    environment: 'local',
    initBehavior: 'ok',
    initDelayMs: 0,
    adBehavior: 'finish',
    adDurationMs: 0,
    adStartDelayMs: 0,
    adErrorAfterStart: false,
    hasAdblock: false,
    muteAudio: false,
    locale: 'ja-JP',
    dataModule: true,
    dataLimitBytes: 1_000_000,
    dataLimitBehavior: 'throw',
    dataMissing: 'null',
    dataGetThrows: false,
    ...initial,
  };
  const log: string[] = [];
  const calls: string[] = [];
  const store = new Map<string, string>();
  const listeners: ((s: { muteAudio?: boolean }) => void)[] = [];
  const settings = { muteAudio: config.muteAudio };
  const note = (name: string, inLog: boolean): void => {
    calls.push(name);
    if (inLog) log.push(name);
  };
  const bytes = (s: string): number => new TextEncoder().encode(s).length;
  const after = (ms: number, fn: () => void): void => {
    if (ms > 0) setTimeout(fn, ms);
    else queueMicrotask(fn);
  };
  const setMute = (m: boolean): void => {
    config.muteAudio = m;
    settings.muteAudio = m;
    for (const fn of listeners) fn({ muteAudio: m });
  };
  const data = {
    getItem(k: string): string | null {
      note(`data.getItem:${k}`, false);
      if (config.dataGetThrows) throw new Error('data module unavailable (mock)');
      const v = store.get(k);
      if (v !== undefined) return v;
      return config.dataMissing === 'undefined' ? (undefined as unknown as null) : null;
    },
    setItem(k: string, v: string): void {
      note(`data.setItem:${k}`, false);
      const value = String(v);
      let total = bytes(k) + bytes(value);
      for (const [key, val] of store) if (key !== k) total += bytes(key) + bytes(val);
      if (total > config.dataLimitBytes) {
        if (config.dataLimitBehavior === 'throw') throw new Error('dataLimitExcedeed');
        return;
      }
      store.set(k, value);
    },
    removeItem(k: string): void {
      note(`data.removeItem:${k}`, false);
      store.delete(k);
    },
  };
  const mock: CrazyMock = {
    config,
    log,
    calls,
    store,
    get adBehavior() {
      return config.adBehavior;
    },
    set adBehavior(b: CgAdBehavior) {
      config.adBehavior = b;
    },
    get initBehavior() {
      return config.initBehavior;
    },
    set initBehavior(b: CgInitBehavior) {
      config.initBehavior = b;
    },
    get environment() {
      return config.environment;
    },
    init() {
      note('init', true);
      if (config.initBehavior === 'reject') return Promise.reject(new Error('init failed (mock)'));
      if (config.initBehavior === 'hang') return new Promise<void>(() => {});
      if (config.initDelayMs > 0) return new Promise<void>((resolve) => setTimeout(resolve, config.initDelayMs));
      return Promise.resolve();
    },
    game: {
      loadingStart: () => note('loadingStart', true),
      loadingStop: () => note('loadingStop', true),
      gameplayStart: () => note('gameplayStart', true),
      gameplayStop: () => note('gameplayStop', true),
      happytime: () => note('happytime', true),
      settings,
      addSettingsChangeListener: (fn: (s: { muteAudio?: boolean }) => void) => {
        note('game.addSettingsChangeListener', false);
        listeners.push(fn);
      },
    },
    ad: {
      requestAd: (type: CgAdType, cb: CgAdCallbacks) => {
        note(`requestAd:${type}`, true);
        const b = config.adBehavior;
        const ms = config.adDurationMs;
        const afterStart = config.adErrorAfterStart;
        after(config.adStartDelayMs, () => {
          if (b === 'silent') return;
          if (b === 'startedOnly') {
            cb.adStarted?.();
            return;
          }
          if (b === 'finish') {
            cb.adStarted?.();
            after(ms, () => cb.adFinished?.());
            return;
          }
          if (afterStart) {
            cb.adStarted?.();
            after(ms, () => cb.adError?.({ code: b, message: `${b} (mock)` }));
            return;
          }
          cb.adError?.({ code: b, message: `${b} (mock)` });
        });
      },
      hasAdblock: () => {
        note('ad.hasAdblock', false);
        return Promise.resolve(config.hasAdblock);
      },
    },
    get data() {
      return config.dataModule ? data : undefined;
    },
    get user() {
      return { systemInfo: config.locale === null ? {} : { locale: config.locale } };
    },
    setMute,
    configure(c: Partial<CrazyMockConfig>) {
      const { muteAudio, ...rest } = c;
      Object.assign(config, rest);
      if (muteAudio !== undefined) setMute(muteAudio);
    },
  };
  return mock;
}

/** S1 からの呼び方（tests/mocks/sdk.ts の crazyMock。BL-057 のブランチも使う）: environment だけを決めて作る */
export const crazyMock = (env: CrazyMockConfig['environment'] = 'local'): CrazyMock => createCrazyMock({ environment: env });

/** ページの中で見るモック（L3。e2e/support/crazygames.ts が読む） */
export const CG_MOCK_GLOBAL = '__cgMock';

/**
 * L3 用: SDK の script の代わりに返す JavaScript。createCrazyMock を文字列にしてページで作り、
 * window.CrazyGames.SDK と window.__cgMock（テストが記録を読み・設定を変える）に置く
 */
export function crazyMockScript(config: Partial<CrazyMockConfig> = {}): string {
  return [
    '(() => {',
    `  const createCrazyMock = ${createCrazyMock.toString()};`,
    `  const mock = createCrazyMock(${JSON.stringify(config)});`,
    '  window.CrazyGames = { SDK: mock };',
    `  window[${JSON.stringify(CG_MOCK_GLOBAL)}] = mock;`,
    '})();',
  ].join('\n');
}
