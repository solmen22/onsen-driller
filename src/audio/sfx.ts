// 効果音（ZzFX）。AudioContext はモジュールの読み込み時に作られるので、最初の入力で読み込んで resume する（iOS 対策）
type Zzfx = typeof import('zzfx');

let mod: Zzfx | null = null;
let loading: Promise<void> | null = null;
let muted = false;
let lastHitAt = 0;

export function unlockAudio(): void {
  loading ??= import('zzfx').then((m) => {
    mod = m;
    void m.ZZFX.audioContext.resume();
  });
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
