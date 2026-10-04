// 効果音（ZzFX）。AudioContext はモジュールの読み込み時に作られるので、最初の入力で読み込んで resume する（iOS 対策）
// 音が使えないときは音を諦めてゲームを続ける（BL-102）。失敗の扱いは 2 つに分ける:
// - 接頭辞なしの AudioContext がない環境（Web Audio のない Windows の Playwright の WebKit、webkitAudioContext だけの古い Safari）:
//   環境の制約なので、ZzFX を読み込みに行かず（チャンクの通信もしない）、黙って音なしで続ける（errors() にも console にも残さない）
// - それ以外の失敗（ZzFX のチャンクが届かない、AudioContext のコンストラクタが投げる、resume の予期しない失敗など）:
//   不具合の手がかりなので onFailure に渡す（main.ts が errors() に残す。描画のチャンクの失敗と同じ方針。console には出さない）
// 止まった音（BL-104）: AudioContext が running のときだけ鳴らす（止まっている間に作った音は、再開の瞬間に一度に鳴るので作らない）。
// 一度 running になった後に止まったら（iOS のバックグラウンドからの復帰・電話の後・広告の後など）、次の入力のハンドラの中で
// resumeAudio() を同期に呼んで戻す（iOS は入力の中でないと resume できない）
type Zzfx = typeof import('zzfx');

let mod: Zzfx | null = null;
let loading: Promise<void> | null = null;
let muted = false;
let lastHitAt = 0;
/** 失敗の受け取り先（unlockAudio の最初の呼び出しで決まる） */
let report: ((e: unknown) => void) | undefined;
/** resume の失敗は、入力のたびに起きうるので最初の 1 回だけ記録する（errors() を埋めない） */
let resumeFailureReported = false;

const fail = (e: unknown): void => {
  try {
    report?.(e);
  } catch {
    // 記録に失敗しても音なしで続ける（拒否を外に出さない）
  }
};

const context = (): AudioContext | null => mod?.ZZFX.audioContext ?? null;

/** resume の失敗: 閉じた文脈は戻せないので音を諦める。それ以外（許されない・一時的な失敗）は ZzFX を残し、次の入力で再び試す */
function onResumeFailure(e: unknown): void {
  if (context()?.state === 'closed') mod = null;
  if (resumeFailureReported) return;
  resumeFailureReported = true;
  fail(e);
}

/**
 * ZzFX 1.3.2 が使える環境か。ZzFX は読み込み時に接頭辞なしの `new AudioContext` を作り、鳴らすときに StereoPannerNode を使うので、
 * webkitAudioContext だけの環境（Safari 14.0 以前）も「ない」とみなす（別名を付けても StereoPannerNode がなく、鳴らすときに投げる）
 */
const hasAudioContext = (): boolean => typeof AudioContext === 'function';

/**
 * 最初の入力で呼ぶ。何度呼んでも読み込みは 1 回だけ（失敗しても再試行しない。onFailure は最初の呼び出しのものを使う）。
 * - 返す Promise は拒否しない。ただし resume() が終わらない環境（自動再生が許されない文脈など）では解決もしないので、
 *   await しない（main.ts は void で捨てる）
 * - 読み込みに失敗したら音を諦める（以後の playHit・playBreak は何もしない）
 * - resume に失敗したら、閉じた文脈なら音を諦め、それ以外は ZzFX を残す（running になるまで鳴らさず、次の入力の
 *   resumeAudio で再び試す。BL-104 で「resume の拒否で ZzFX を捨てる」条件〔BL-102〕を見直した）
 * @param onFailure AudioContext がない環境以外の失敗の受け取り先（errors() への記録）。投げても音なしで続ける
 */
export function unlockAudio(onFailure?: (e: unknown) => void): Promise<void> {
  if (loading) return loading;
  report = onFailure;
  if (!hasAudioContext()) {
    loading = Promise.resolve(); // 環境の制約: 黙って音なしで続ける
    return loading;
  }
  loading = import('zzfx')
    .then(
      (m) => {
        mod = m;
        return m.ZZFX.audioContext.resume().catch(onResumeFailure);
      },
      fail, // 読み込みの失敗（mod は null のまま）
    )
    .catch(onResumeFailure); // resume() が同期に投げた場合
  return loading;
}

/**
 * 止まった音を戻す（BL-104）。ユーザーの入力のハンドラの中で**同期に**呼ぶ（iOS は入力の中でないと resume できない）。
 * main.ts が window の pointerdown・pointerup・touchend・keydown（キャプチャ）で呼ぶ。広告の終わり（BL-059）でも呼ぶ。
 * 読み込む前・running の間・閉じた文脈では何もしない（running の間は入力ごとに resume を呼ばない）。拒否は外に出さない
 */
export function resumeAudio(): void {
  const c = context();
  if (!c || c.state === 'running' || c.state === 'closed') return;
  try {
    void c.resume().catch(onResumeFailure);
  } catch (e) {
    onResumeFailure(e);
  }
}

/** 鳴らせるか（読み込み済み・消音でない・AudioContext が running） */
const audible = (): boolean => !muted && context()?.state === 'running';

export const setMuted = (m: boolean): void => {
  muted = m;
};

/** 打撃（1 秒に最大 12 回まで。音程を少し揺らす） */
export function playHit(now: number, pitch = 1): void {
  if (!mod || !audible() || now - lastHitAt < 80) return;
  lastHitAt = now;
  mod.zzfx(0.4, 0.05, 180 * pitch + ((now * 7) % 40), 0, 0.01, 0.05, 4, 1.5, -5, 0, 0, 0, 0, 1.2);
}

export function playBreak(): void {
  if (!mod || !audible()) return;
  mod.zzfx(0.5, 0.05, 90, 0.01, 0.03, 0.12, 4, 2, 0, 0, 0, 0, 0, 1.5);
}
