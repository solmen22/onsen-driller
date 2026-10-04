// ライフサイクル（arch §7 の状態図。BL-056）: ポータルへの loading・gameplay の合図を 1 か所で決める
// - 読み込みの開始・終了で loadingStart・loadingStop（それぞれ 1 回だけ）
// - 最初の入力で gameplayStart（Poki の要件。読み込みの途中で押されたら loadingStop の後に送る）
// - 止まる理由（非表示・広告・幕間・転生の演出）が 1 つでもある間は gameplayStop。すべてなくなったら gameplayStart
//   （最初の入力の後だけ。理由は重なってよい: 非表示の間に広告が終わっても、見えるようになるまで再開しない）
// - アダプタの gameplayStart・gameplayStop も冪等だが、ここでも今の状態を持ち、同じ合図を二重に送らない
// - 非表示（タブの切り替え・ゲームの外への移動）を止める理由に数えるかはポータルごとに違う（signalsHidden。arch §7 の表）。
//   CrazyGames は数えない（公式の説明: "Don't call this event when the user switches focus or leaves the game area (we handle
//   this on our side)."。PR #16 のレビュー S-1。BL-057）。ループの停止・保存は main.ts が今までどおり行う
// - ポータルへの 4 つの合図（loadingStart/Stop・gameplayStart/Stop）を呼ぶのは、このファイルだけ（PR #16 のレビュー Nit 1。
//   eslint.config.js の規則で src/app・ui・view からの直接の呼び出しを止める）
// ブラウザがなくても確かめられるように、Platform の 4 つの関数だけを受け取る（tests/unit/lifecycle.test.ts）
import type { Platform, Target } from '../platform/types.ts';

/** gameplay を止める理由（prestige は S3 の転生の演出〔BL-021〕で結線する） */
export type PauseReason = 'hidden' | 'ad' | 'interlude' | 'prestige';

export type LifecyclePlatform = Pick<Platform, 'loadingStart' | 'loadingStop' | 'gameplayStart' | 'gameplayStop'>;

export interface Lifecycle {
  loadingStart(): void;
  loadingStop(): void;
  /** 最初の入力（ステージでも UI のパネルでも）。2 回目以降は何もしない */
  firstInput(): void;
  /**
   * 理由 r で止める（on=true）／その理由を外す（on=false）。同じ理由を何度送ってもよい。
   * signalHidden が false なら hidden は無視する（合図には使わない。ループの停止は呼び出し側）
   */
  setPaused(r: PauseReason, on: boolean): void;
  /** 今 gameplay 中として合図しているか */
  readonly playing: boolean;
}

export interface LifecycleOptions {
  /** 非表示（理由 hidden）を gameplayStop・gameplayStart の合図に使うか（既定 true。main.ts は signalsHidden(target) を渡す） */
  signalHidden?: boolean;
}

/**
 * そのポータルで、タブの非表示を gameplay の合図にするか（arch §7・§12-3 の表）。
 * - crazygames: しない（ポータルの側で扱う。公式 https://docs.crazygames.com/sdk/game/ ）
 * - poki: する（"gameplayStop() ... pause"。非表示ではループを止めるので「一時停止」に当たる。禁止の記述はない）
 * - web・itch・dev: SDK がない（記録だけ）。poki と同じ扱いにしておく（e2e-web の TS-E1-03・04・TS-056-11 で確かめる形）
 */
export const signalsHidden = (t: Target): boolean => t !== 'crazygames';

export function createLifecycle(p: LifecyclePlatform, opts: LifecycleOptions = {}): Lifecycle {
  const signalHidden = opts.signalHidden ?? true;
  let loadingStarted = false;
  let loaded = false;
  let started = false;
  let playing = false;
  const reasons = new Set<PauseReason>();

  const update = (): void => {
    const should = loaded && started && reasons.size === 0;
    if (should === playing) return;
    playing = should;
    if (should) p.gameplayStart();
    else p.gameplayStop();
  };

  return {
    loadingStart() {
      if (loadingStarted) return;
      loadingStarted = true;
      p.loadingStart();
    },
    loadingStop() {
      if (loaded) return;
      loaded = true;
      p.loadingStop();
      update();
    },
    firstInput() {
      if (started) return;
      started = true;
      update();
    },
    setPaused(r, on) {
      if (r === 'hidden' && !signalHidden) return; // CrazyGames: 非表示は合図にしない（上の注）
      if (on) reasons.add(r);
      else reasons.delete(r);
      update();
    },
    get playing() {
      return playing;
    },
  };
}
