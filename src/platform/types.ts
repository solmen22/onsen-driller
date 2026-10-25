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

/** 遅れて見終わった広告の報酬（Q-45）。id は要求ごとに違う（同じ id は 2 回目から無視する） */
export interface LateReward {
  id: number;
  placement: RewardPlacement;
}

export interface PlatformCall {
  name: string;
  arg?: string;
}

export interface Platform {
  readonly target: Target;
  /** 失敗・5 秒のタイムアウトでも resolve する（広告なしで続行） */
  init(): Promise<void>;
  /**
   * loading・gameplay の 4 つの合図を呼ぶのは `app/lifecycle.ts` だけ（BL-056。PR #16 のレビュー Nit 1）。UI・広告の流れなどから
   * 直接呼ぶと、ライフサイクルの状態（止まる理由の集合）とずれる（例: 隠れている間に gameplayStart が出る）。
   * eslint.config.js の規則で src/app・ui・view からの直接の呼び出しを止めている。
   * init の前に呼ばれた loadingStart・loadingStop は、アダプタが覚えて init の成功の直後に送る（CrazyGames。レビュー S-2）
   */
  loadingStart(): void;
  loadingStop(): void;
  /** 冪等（今の状態を覚え、二重に呼ばない）。呼ぶのは app/lifecycle.ts だけ（上の注） */
  gameplayStart(): void;
  gameplayStop(): void;
  happyTime(): void;
  ads: {
    rewardedAvailable(): boolean;
    showRewarded(p: RewardPlacement): Promise<RewardResult>;
    /** 区切りの機会を渡すだけ。流すかどうかは SDK が決める（広告のタイマーは持たない）。SDK が答えなくても必ず終わる（下の時間） */
    breakOpportunity(p: BreakPlacement): Promise<void>;
    /**
     * 広告の再生の開始で true、終わりで false（音・入力・ループの停止に使う）。true の後は必ず false が来る:
     * SDK から終了も失敗も来なければ、AD_END_TIMEOUT_MS でアダプタが false を出す（Q-35 (d)）
     */
    onPlaying(cb: (playing: boolean) => void): void;
    /**
     * 開始の時間切れ（AD_START_TIMEOUT_MS）で showRewarded が failed を返した後に、**遅れて始まり最後まで見られた**リワード広告の
     * 報酬を知らせる（Q-45。決定 0010 の 5: 見終えたのに何ももらえない体験を避ける）。1 つの要求につき最大 1 回。
     * ミッドゲーム・開始の前の失敗・始まった後の失敗・再生の時間切れ（AD_END_TIMEOUT_MS）では呼ばない。
     * 時間切れのない場合（web・itch・dev）は呼ばない。Poki は rewardedBreak の開始（onStart）の時間切れで同じ形にする（BL-060）
     */
    onLateReward(cb: (r: LateReward) => void): void;
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
/**
 * 広告の要求から開始（CrazyGames の adStarted）まで待つ上限（Q-35 (d)。arch §12-3）。過ぎたら結果を failed で返す
 * （ボタンのスピナー・ミッドゲームの待ちを終わらせる）。その後に遅れて始まったら、再生中はゲームを止め、終わったら戻す。
 * リワード広告が最後まで見られたら、報酬は onLateReward で 1 回だけ知らせる（Q-45。ミッドゲームは報酬なし）
 */
export const AD_START_TIMEOUT_MS = 30_000;
/**
 * 広告の開始から終わり（adFinished・adError）まで待つ上限（Q-35 (d)）。過ぎたら failed で返し、onPlaying(false) を出して
 * gameplay・消音・入力・ループを戻す（SDK が終わりを知らせないと、ゲームが止まったまま・消音のままになるため）。
 * 動画広告の長さ（多くは 15〜30 秒、長くても 1〜2 分【推定】）より十分長くする。Poki の runBreak（BL-060）も同じ考え方
 */
export const AD_END_TIMEOUT_MS = 180_000;
