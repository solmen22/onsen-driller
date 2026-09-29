// CrazyGames HTML5 SDK v3 のアダプタ（arch §12-3）。
// 仕様: https://docs.crazygames.com/sdk/intro/ ・ /sdk/video-ads/ ・ /sdk/data/ ・ /sdk/game/ ・ /sdk/user/
import { browserLocale, CallLog, gameplayGate, Listeners, withTimeout } from './base.ts';
import { localStore } from './storage.ts';
import { AD_END_TIMEOUT_MS, AD_START_TIMEOUT_MS, type KeyValueStore, type Platform, type RewardResult } from './types.ts';

export type CgAdType = 'midgame' | 'rewarded';
/** 既知のエラーコード（docs.crazygames.com/sdk/video-ads/）。未知の値も来うるので code は string で受ける */
export type CgAdErrorCode = 'unfilled' | 'adblock' | 'adsDisabledBasicLaunch' | 'adCooldown' | 'other';
export interface CgAdError {
  code: string;
  message?: string;
}
export interface CgAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: CgAdError) => void;
}
/** アダプタが使う SDK の部分（モックはこの形を満たす） */
export interface CrazySdk {
  init(): Promise<void>;
  /** 'local'・'crazygames'・'disabled' */
  environment: string;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (s: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: CgAdType, cb: CgAdCallbacks): void;
    hasAdblock?(): Promise<boolean>;
  };
  data?: {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
  };
  user?: { systemInfo?: { locale?: string } };
}

/** init の中で広告ブロッカーの判定（SDK.ad.hasAdblock）を待つ上限。過ぎたら判定は「不明」として起動を続ける（PR #24 のレビューの連絡 1） */
export const ADBLOCK_TIMEOUT_MS = 1_000;

export interface CrazyGamesOptions {
  getSdk: () => CrazySdk | undefined;
  /** Basic Launch 中は false（VITE_CG_ADS）。広告を一度も要求しない */
  adsEnabled: boolean;
  initTimeoutMs?: number;
}

export function createCrazyGamesPlatform(opts: CrazyGamesOptions): Platform {
  const log = new CallLog();
  const playingL = new Listeners<boolean>();
  const mutedL = new Listeners<boolean>();
  let sdk: CrazySdk | null = null; // init が成功し environment が disabled でないときだけ入る
  /** 広告ブロッカー・Basic Launch の広告の無効（どちらもセッションの間は変わらない）。真なら以後は動画のボタンを出さない（Q-35 (c)） */
  let adsOff = false;
  let muted = false;
  let inFlight: Promise<RewardResult> | null = null;
  const local = localStore();
  let storage: KeyValueStore = local;
  let legacy: KeyValueStore | undefined;
  /** init が終わったか（成功・失敗・disabled を問わない）。終わる前の loading の合図は覚えておく */
  let initDone = false;
  /** init の前に来た loading の合図（起きた順）。init が成功した直後に SDK へ送る（main.ts は init の前に loadingStart を呼ぶ。レビュー S-2） */
  const early: ('loadingStart' | 'loadingStop')[] = [];
  const call = (s: CrazySdk, fn: (s: CrazySdk) => void): void => {
    try {
      fn(s);
    } catch {
      /* SDK の例外でゲームを止めない */
    }
  };
  const safe = (name: string, fn: (s: CrazySdk) => void): void => {
    log.push(name);
    if (sdk) call(sdk, fn);
  };
  const loadingSignal = (name: 'loadingStart' | 'loadingStop') => (): void => {
    if (sdk || initDone) return safe(name, (s) => s.game[name]());
    log.push(name);
    early.push(name);
  };
  const gate = gameplayGate(
    log,
    () => sdk?.game.gameplayStart(),
    () => sdk?.game.gameplayStop(),
  );

  /**
   * 広告を 1 回要求する。結果はちょうど 1 回返し、onPlaying は true の後に必ず false を出す。
   * SDK が答えないとき（Q-35 (d)）: 開始が AD_START_TIMEOUT_MS 来なければ failed を返す（遅れて始まったら、その間だけ止める）。
   * 開始の後に終了も失敗も AD_END_TIMEOUT_MS 来なければ、failed を返して onPlaying(false) でゲームを戻す（後から来た終了は無視）
   */
  function request(type: CgAdType): Promise<RewardResult> {
    return new Promise((resolve) => {
      const s = sdk;
      if (!s) return resolve('unavailable');
      let phase: 'waiting' | 'playing' | 'over' = 'waiting';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (r: RewardResult): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };
      /** 広告が終わった（終了・失敗・再生の時間切れ）。再生中ならゲームを戻す */
      const end = (r: RewardResult): void => {
        if (phase === 'over') return;
        clearTimeout(timer);
        const wasPlaying = phase === 'playing';
        phase = 'over';
        if (wasPlaying) playingL.emit(false);
        settle(r);
      };
      log.push('requestAd', type);
      timer = setTimeout(() => {
        if (phase !== 'waiting') return;
        log.push('adTimeout', 'start');
        settle('failed'); // 遅れて adStarted が来たら、その再生の間は止める（phase は waiting のまま）
      }, AD_START_TIMEOUT_MS);
      try {
        s.ad.requestAd(type, {
          adStarted: () => {
            if (phase !== 'waiting') return;
            clearTimeout(timer);
            phase = 'playing';
            playingL.emit(true);
            timer = setTimeout(() => {
              log.push('adTimeout', 'end');
              end('failed');
            }, AD_END_TIMEOUT_MS);
          },
          adFinished: () => end('rewarded'),
          adError: (e) => {
            log.push('adError', e.code);
            if (e.code === 'adblock' || e.code === 'adsDisabledBasicLaunch') adsOff = true; // unfilled・adCooldown は一時的なので出し続ける
            end(e.code === 'unfilled' || e.code === 'adblock' || e.code === 'adsDisabledBasicLaunch' ? 'unavailable' : 'failed');
          },
        });
      } catch {
        end('failed');
      }
    });
  }

  /** SDK を待って使える状態にする（init が呼ぶ。失敗・タイムアウト・disabled では何もしない＝web と同じ動作） */
  async function initSdk(): Promise<void> {
    const s = opts.getSdk();
    if (!s) return;
    const r = await withTimeout(s.init(), opts.initTimeoutMs);
    if (r === 'timeout' || r === 'error') {
      log.push('initFailed', r);
      return;
    }
    if (s.environment === 'disabled') {
      log.push('environment', 'disabled'); // CrazyGames 以外のドメイン: web と同じ動作にする
      return;
    }
    log.push('environment', s.environment);
    sdk = s;
    // init の前に来た loading の合図を、起きた順に SDK へ送る（loadingStart が SDK に届かなかった。レビュー S-2）
    for (const name of early.splice(0)) call(s, (x) => x.game[name]());
    if (s.data) {
      const d = s.data;
      storage = {
        kind: 'sdk',
        // 読めないときは例外をそのまま投げる（「ない」＝null と区別する。KeyValueStore.get の約束。レビュー S-1）。
        // 「ない」を undefined で返す実装もあるので、文字列以外は null にそろえる（S1 再レビュー A-N1）
        get: (k) => {
          const v: unknown = d.getItem(k);
          return typeof v === 'string' ? v : null;
        },
        set: (k, v) => {
          try {
            d.setItem(k, v);
            return true;
          } catch {
            return false;
          }
        },
        remove: (k) => {
          try {
            d.removeItem(k);
          } catch {
            /* 無視 */
          }
        },
      };
      // SDK が読めなかった起動で localStorage に保存した枠を、main.ts が最初に移す（メモリに落ちていたら移すものはない）
      if (local.kind === 'local') legacy = local;
    }
    muted = !!s.game.settings?.muteAudio;
    s.game.addSettingsChangeListener?.((st) => {
      muted = !!st.muteAudio;
      mutedL.emit(muted);
    });
    if (opts.adsEnabled && s.ad.hasAdblock) await checkAdblock(s.ad.hasAdblock.bind(s.ad));
  }

  /**
   * 広告ブロッカーの判定（arch §12-3。Q-35 (c)）。**起動を止めないよう ADBLOCK_TIMEOUT_MS までしか待たない**
   * （main.ts は init の後にゲームを作る。返らないとゲームが始まらなかった。PR #24 のレビューの連絡 1）。
   * 時間切れ・失敗は「不明」: 動画のボタンは出す（本当にブロックされていれば、最初の要求の adError 'adblock' で以後は隠す）。
   * 遅れて返った結果も使う（true なら以後は隠す）
   */
  async function checkAdblock(hasAdblock: () => Promise<boolean>): Promise<void> {
    let answer: Promise<boolean>;
    try {
      answer = Promise.resolve(hasAdblock());
    } catch (e) {
      answer = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    answer.then(
      (blocked) => {
        if (blocked === true) adsOff = true;
      },
      () => {
        /* 不明のまま */
      },
    );
    const r = await withTimeout(answer, ADBLOCK_TIMEOUT_MS);
    if (r === 'timeout' || r === 'error') log.push('adblockCheck', r);
  }

  return {
    target: 'crazygames',
    async init() {
      log.push('init');
      try {
        await initSdk();
      } finally {
        initDone = true; // 以後の loading の合図はその場で送る（SDK が使えなければ記録だけ）
        early.length = 0; // SDK が使えなかった起動では送らない（web と同じ）
      }
    },
    loadingStart: loadingSignal('loadingStart'),
    loadingStop: loadingSignal('loadingStop'),
    gameplayStart: gate.start,
    gameplayStop: gate.stop,
    happyTime: () => safe('happyTime', (s) => s.game.happytime()),
    ads: {
      rewardedAvailable: () => opts.adsEnabled && sdk !== null && !adsOff,
      showRewarded(p) {
        log.push('showRewarded', p);
        if (!(opts.adsEnabled && sdk !== null && !adsOff)) return Promise.resolve('unavailable');
        // 連打しても要求は 1 回
        inFlight ??= request('rewarded').finally(() => {
          inFlight = null;
        });
        return inFlight;
      },
      async breakOpportunity(p) {
        log.push('breakOpportunity', p);
        if (!opts.adsEnabled || !sdk) return;
        await request('midgame');
      },
      onPlaying: (cb) => playingL.add(cb),
    },
    get storage() {
      return storage;
    },
    get legacyStorage() {
      return legacy;
    },
    locale: () => sdk?.user?.systemInfo?.locale ?? browserLocale(),
    isMuted: () => muted,
    onMutedChange: (cb) => mutedL.add(cb),
    openExternalLink: (url) => {
      log.push('openExternalLink', url);
      window.open(url, '_blank', 'noopener');
    },
    calls: () => log.list(),
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazySdk };
  }
}
