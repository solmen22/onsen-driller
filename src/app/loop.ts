// 固定ステップのループ（arch §7。BL-010。Q-12）
// - requestAnimationFrame で経過時間（単調時計）をため、100ms ごとに store.step を呼ぶ
// - 1 フレームで追いつくのは最大 1 秒分（10 ステップ）。超えた分は捨て、droppedMs に累計する
// - タイムスタンプが前より小さい・NaN・同じ値のフレームではステップしない（戻ったら基準を合わせ直す）
// - UI への通知は store.tick（200ms ごと）
// - フレームの間隔は 1000/60ms のような割り切れない値なので、足し合わせた誤差（1e-13 程度）で
//   「100ms にわずかに届かない」ことがないよう、TIME_EPS_MS の許容を入れて比べる
import { PARAMS } from '../content/params.ts';
import type { Clock } from './clock.ts';
import type { GameStore } from './store.ts';

/** 時刻の比較の許容（ms）。浮動小数の足し算の誤差だけを吸収する大きさ（1ns） */
export const TIME_EPS_MS = 1e-6;

export interface Loop {
  pause(): void;
  resume(): void;
  readonly running: boolean;
  /** 追いつきの上限を超えて捨てた時間の累計（ms） */
  readonly droppedMs: number;
}

export interface LoopOptions {
  stepMs?: number;
  maxCatchUpMs?: number;
  /** 早送り（録画モードは ×4。S4） */
  speed?: number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
  /** 作った直後に動かし始めるか（既定 true） */
  autoStart?: boolean;
}

export function startLoop(store: GameStore, clock: Clock, opts: LoopOptions = {}): Loop {
  const stepMs = opts.stepMs ?? PARAMS.stepMs;
  const maxCatchUpMs = opts.maxCatchUpMs ?? 1000;
  const speed = opts.speed ?? 1;
  const raf = opts.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));
  // 図鑑の初来訪の時刻に使う壁時計（BL-017。main.ts はストアを作った直後にループを始めるので、ここでつなぐ）
  store.useWallClock(() => clock.wallNow());
  let last = clock.monoNow();
  let acc = 0;
  let handle = 0;
  let running = false;
  let droppedMs = 0;

  const frame = (): void => {
    if (!running) return;
    const now = clock.monoNow();
    if (Number.isFinite(now)) {
      if (!Number.isFinite(last) || now < last) {
        last = now; // 時計が戻った・基準が壊れている: 合わせ直して、このフレームは進めない
      } else if (now > last) {
        let elapsed = now - last;
        last = now;
        if (elapsed > maxCatchUpMs) {
          droppedMs += elapsed - maxCatchUpMs;
          elapsed = maxCatchUpMs;
        }
        acc += elapsed * speed;
        while (acc + TIME_EPS_MS >= stepMs) {
          store.step(stepMs, now);
          acc = Math.max(0, acc - stepMs);
        }
      }
      store.tick(now);
    }
    handle = raf(frame);
  };

  const loop: Loop = {
    pause() {
      if (!running) return;
      running = false;
      caf(handle);
    },
    resume() {
      if (running) return;
      running = true;
      last = clock.monoNow(); // 止めていた間の時間は早送りしない（S3 の BL-030 で「60 秒以内は早送り」を入れる）
      handle = raf(frame);
    },
    get running() {
      return running;
    },
    get droppedMs() {
      return droppedMs;
    },
  };
  if (opts.autoStart !== false) loop.resume();
  return loop;
}
