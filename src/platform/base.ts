// アダプタ共通の部品: 呼び出しの記録、gameplay の冪等化、onPlaying の購読、タイムアウト
import { INIT_TIMEOUT_MS, type PlatformCall } from './types.ts';

export class CallLog {
  private readonly items: PlatformCall[] = [];
  push(name: string, arg?: string): void {
    this.items.push(arg === undefined ? { name } : { name, arg });
    if (this.items.length > 100) this.items.shift();
  }
  list(): PlatformCall[] {
    return [...this.items];
  }
}

export class Listeners<T> {
  private readonly fns: ((v: T) => void)[] = [];
  add(fn: (v: T) => void): void {
    this.fns.push(fn);
  }
  emit(v: T): void {
    for (const fn of this.fns) fn(v);
  }
}

/** gameplayStart/Stop を冪等にする */
export function gameplayGate(log: CallLog, start: () => void, stop: () => void): { start: () => void; stop: () => void } {
  let playing = false;
  return {
    start: () => {
      if (playing) return;
      playing = true;
      log.push('gameplayStart');
      start();
    },
    stop: () => {
      if (!playing) return;
      playing = false;
      log.push('gameplayStop');
      stop();
    },
  };
}

/** p が ms 以内に終わらなければ 'timeout' で resolve する（reject も吸収する） */
export function withTimeout<T>(p: Promise<T>, ms: number = INIT_TIMEOUT_MS): Promise<T | 'timeout' | 'error'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve('error');
      },
    );
  });
}

export const browserLocale = (): string | null => (typeof navigator !== 'undefined' ? navigator.language : null);
