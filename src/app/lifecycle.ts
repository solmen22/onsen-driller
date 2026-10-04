// ライフサイクル（arch §7 の状態図。BL-056）: ポータルへの loading・gameplay の合図を 1 か所で決める
// - 読み込みの開始・終了で loadingStart・loadingStop（それぞれ 1 回だけ）
// - 最初の入力で gameplayStart（Poki の要件。読み込みの途中で押されたら loadingStop の後に送る）
// - 止まる理由（非表示・広告・幕間・転生の演出）が 1 つでもある間は gameplayStop。すべてなくなったら gameplayStart
//   （最初の入力の後だけ。理由は重なってよい: 非表示の間に広告が終わっても、見えるようになるまで再開しない）
// - アダプタの gameplayStart・gameplayStop も冪等だが、ここでも今の状態を持ち、同じ合図を二重に送らない
// ブラウザがなくても確かめられるように、Platform の 4 つの関数だけを受け取る（tests/unit/lifecycle.test.ts）
import type { Platform } from '../platform/types.ts';

/** gameplay を止める理由（prestige は S3 の転生の演出〔BL-021〕で結線する） */
export type PauseReason = 'hidden' | 'ad' | 'interlude' | 'prestige';

export type LifecyclePlatform = Pick<Platform, 'loadingStart' | 'loadingStop' | 'gameplayStart' | 'gameplayStop'>;

export interface Lifecycle {
  loadingStart(): void;
  loadingStop(): void;
  /** 最初の入力（ステージでも UI のパネルでも）。2 回目以降は何もしない */
  firstInput(): void;
  /** 理由 r で止める（on=true）／その理由を外す（on=false）。同じ理由を何度送ってもよい */
  setPaused(r: PauseReason, on: boolean): void;
  /** 今 gameplay 中として合図しているか */
  readonly playing: boolean;
}

export function createLifecycle(p: LifecyclePlatform): Lifecycle {
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
      if (on) reasons.add(r);
      else reasons.delete(r);
      update();
    },
    get playing() {
      return playing;
    },
  };
}
