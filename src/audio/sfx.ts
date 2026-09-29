// 効果音（ZzFX）。AudioContext はモジュールの読み込み時に作られるので、最初の入力で読み込んで resume する（iOS 対策）
// AudioContext がない・作れない環境（Windows の Playwright の WebKit など）では import('zzfx') が拒否され、
// resume() が拒否されることもある。そのときは音を諦めてゲームを続ける（BL-102）。
// 音が出ないのは環境の制約で、ゲームの不具合ではないので errors()（app/errors.ts）にも console にも残さない
type Zzfx = typeof import('zzfx');

let mod: Zzfx | null = null;
let loading: Promise<void> | null = null;
let muted = false;
let lastHitAt = 0;

/** 音を諦める（以後の playHit・playBreak は何もしない） */
const giveUp = (): void => {
  mod = null;
};

/**
 * 最初の入力で呼ぶ。何度呼んでも読み込みは 1 回だけ（失敗しても再試行しない）。
 * 返す Promise は拒否しない（読み込み・resume の失敗は音なしで続ける）
 */
export function unlockAudio(): Promise<void> {
  loading ??= import('zzfx')
    .then((m) => {
      mod = m;
      return m.ZZFX.audioContext.resume();
    })
    .catch(giveUp);
  return loading;
}

export const setMuted = (m: boolean): void => {
  muted = m;
};

/** 打撃（1 秒に最大 12 回まで。音程を少し揺らす） */
export function playHit(now: number, pitch = 1): void {
  if (!mod || muted || now - lastHitAt < 80) return;
  lastHitAt = now;
  mod.zzfx(0.4, 0.05, 180 * pitch + ((now * 7) % 40), 0, 0.01, 0.05, 4, 1.5, -5, 0, 0, 0, 0, 1.2);
}

export function playBreak(): void {
  if (!mod || muted) return;
  mod.zzfx(0.5, 0.05, 90, 0.01, 0.03, 0.12, 4, 2, 0, 0, 0, 0, 0, 1.5);
}
