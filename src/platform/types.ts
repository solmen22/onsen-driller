// Platform インターフェース（arch §12-1）。ゲームはこれだけを見る
export type Target = 'web' | 'itch' | 'crazygames' | 'poki' | 'dev';
export type RewardResult = 'rewarded' | 'failed' | 'unavailable';
export type RewardPlacement = 'R1' | 'R2' | 'R3';
export type BreakPlacement = 'M1' | 'M2';

export interface KeyValueStore {
  /**
   * 値を読む。キーがなければ null。**読めない（ストレージの例外）ときは例外を投げる**（「ない」と区別する。
   * 読めない枠を空とみなして新しいゲームで上書きしないため。レビュー S-1・Q-23）
   */
  get(k: string): string | null;
  /** 書く。失敗（容量不足など）は例外にせず false */
  set(k: string, v: string): boolean;
  /** 消す。失敗は無視する */
  remove(k: string): void;
  /** 保存先の種類（memory なら起動時から保存できない＝unavailable。sdk は CrazyGames の data モジュール〔S2〕） */
  readonly kind?: 'local' | 'memory' | 'sdk';
  /**
   * 起動時の試し書きの結果（local だけ）。failed は「読めるが書けない」（容量いっぱい・書き込みを黙って捨てる）で、
   * 既存のセーブは読み、保存の状態は起動時から failing（15 秒ごとに再試行。レビュー S-2・Q-21・Q-25）
   */
  readonly writeProbe?: 'ok' | 'failed';
}

export interface PlatformCall {
  name: string;
  arg?: string;
}

export interface Platform {
  readonly target: Target;
  /** 失敗・5 秒のタイムアウトでも resolve する（広告なしで続行） */
  init(): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  /** 冪等（今の状態を覚え、二重に呼ばない） */
  gameplayStart(): void;
  gameplayStop(): void;
  happyTime(): void;
  ads: {
    rewardedAvailable(): boolean;
    showRewarded(p: RewardPlacement): Promise<RewardResult>;
    /** 区切りの機会を渡すだけ。流すかどうかは SDK が決める（広告のタイマーは持たない） */
    breakOpportunity(p: BreakPlacement): Promise<void>;
    /** 広告の再生中は false → true の順で呼ぶ（音・入力・ループの停止に使う） */
    onPlaying(cb: (playing: boolean) => void): void;
  };
  storage: KeyValueStore;
  /**
   * 以前の保存先（今の storage に移す前のもの）。CrazyGames で data モジュールを使うときの localStorage だけ（arch §11 の
   * 「CrazyGames の移行」。SDK が読めなかった起動では localStorage に保存しているので、最初に SDK が使えた起動で移す。BL-057）
   */
  readonly legacyStorage?: KeyValueStore;
  locale(): string | null;
  isMuted(): boolean;
  onMutedChange(cb: (m: boolean) => void): void;
  openExternalLink(url: string): void;
  /** テスト・デバッグ用: 直近 100 件の呼び出し */
  calls(): PlatformCall[];
}

export const STORAGE_PREFIX = 'onsen-driller:';
export const INIT_TIMEOUT_MS = 5_000;
