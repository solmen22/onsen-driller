// 固定ステップのループ（arch §7）: rAF で経過時間をため、100ms ごとに step。1 フレームで追いつくのは最大 1 秒分。UI は 5Hz
import { step, type GameEvent } from '../core/index.ts';
import { PARAMS } from '../content/params.ts';
import type { Clock } from './clock.ts';
import type { GameStore } from './store.ts';

export interface Loop {
  pause(): void;
  resume(): void;
  readonly running: boolean;
}

export function startLoop(store: GameStore, clock: Clock, opts: { uiIntervalMs?: number; speed?: number } = {}): Loop {
  const stepMs = PARAMS.stepMs;
  const uiIntervalMs = opts.uiIntervalMs ?? 200;
  const buf: GameEvent[] = [];
  let last = clock.monoNow();
  let lastUi = last;
  let acc = 0;
  let raf = 0;
  let running = false;

  const frame = (): void => {
    const now = clock.monoNow();
    acc += Math.min(now - last, 1000) * (opts.speed ?? 1);
    last = now;
    while (acc >= stepMs) {
      const s = store.state;
      const hitsBefore = s.stats.hits;
      step(s, stepMs, buf);
      const hits = s.stats.hits - hitsBefore;
      if (hits > 0) store.pushEvents([{ type: 'Hits', n: hits, fromTap: false }]);
      if (buf.length) store.pushEvents(buf);
      buf.length = 0;
      acc -= stepMs;
    }
    if (now - lastUi >= uiIntervalMs) {
      lastUi = now;
      store.notify();
    }
    raf = requestAnimationFrame(frame);
  };

  const loop: Loop = {
    pause() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    },
    resume() {
      if (running) return;
      running = true;
      last = clock.monoNow();
      raf = requestAnimationFrame(frame);
    },
    get running() {
      return running;
    },
  };
  loop.resume();
  return loop;
}
