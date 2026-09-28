// Platform インターフェース（arch §12-1）。ゲームはこれだけを見る
export type Target = 'web' | 'itch' | 'crazygames' | 'poki' | 'dev';
export type RewardResult = 'rewarded' | 'failed' | 'unavailable';
export type RewardPlacement = 'R1' | 'R2' | 'R3';
export type BreakPlacement = 'M1' | 'M2';

export interface KeyValueStore {
  get(k: string): string | null;
  set(k: string, v: string): boolean;
  remove(k: string): void;
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
  locale(): string | null;
  isMuted(): boolean;
  onMutedChange(cb: (m: boolean) => void): void;
  openExternalLink(url: string): void;
  /** テスト・デバッグ用: 直近 100 件の呼び出し */
  calls(): PlatformCall[];
}

export const STORAGE_PREFIX = 'onsen-driller:';
export const INIT_TIMEOUT_MS = 5_000;
