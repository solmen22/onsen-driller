// 効果音（ZzFX）。AudioContext はモジュールの読み込み時に作られるので、最初の入力で読み込んで resume する（iOS 対策）
// 音が使えないときは音を諦めてゲームを続ける（BL-102）。失敗の扱いは 2 つに分ける:
// - 接頭辞なしの AudioContext がない環境（Web Audio のない Windows の Playwright の WebKit、webkitAudioContext だけの古い Safari）:
//   環境の制約なので、ZzFX を読み込みに行かず（チャンクの通信もしない）、黙って音なしで続ける（errors() にも console にも残さない）
// - それ以外の失敗（ZzFX のチャンクが届かない、AudioContext のコンストラクタが投げる、resume の予期しない失敗など）:
//   不具合の手がかりなので onFailure に渡す（main.ts が errors() に残す。描画のチャンクの失敗と同じ方針。console には出さない）
type Zzfx = typeof import('zzfx');

let mod: Zzfx | null = null;
let loading: Promise<void> | null = null;
let muted = false;
let lastHitAt = 0;

/**
 * ZzFX 1.3.2 が使える環境か。ZzFX は読み込み時に接頭辞なしの `new AudioContext` を作り、鳴らすときに StereoPannerNode を使うので、
 * webkitAudioContext だけの環境（Safari 14.0 以前）も「ない」とみなす（別名を付けても StereoPannerNode がなく、鳴らすときに投げる）
 */
const hasAudioContext = (): boolean => typeof AudioContext === 'function';

/**
 * 最初の入力で呼ぶ。何度呼んでも読み込みは 1 回だけ（失敗しても再試行しない。onFailure は最初の呼び出しのものを使う）。
 * - 返す Promise は拒否しない。ただし resume() が終わらない環境（自動再生が許されない文脈など）では解決もしないので、
 *   await しない（main.ts は void で捨てる）
 * - 読み込み・resume に失敗したら音を諦める（以後の playHit・playBreak は何もしない）。resume の拒否でも ZzFX を捨てるので、
 *   止まった音を後から再開する経路を作るとき（BL-065 など）は、この条件を見直す
 * @param onFailure AudioContext がない環境以外の失敗の受け取り先（errors() への記録）。投げても音なしで続ける
 */
export function unlockAudio(onFailure?: (e: unknown) => void): Promise<void> {
  if (loading) return loading;
  if (!hasAudioContext()) {
    loading = Promise.resolve(); // 環境の制約: 黙って音なしで続ける
    return loading;
  }
  loading = import('zzfx')
    .then((m) => {
      mod = m;
      return m.ZZFX.audioContext.resume();
    })
    .catch((e: unknown) => {
      mod = null;
      try {
        onFailure?.(e);
      } catch {
        // 記録に失敗しても音なしで続ける（拒否を外に出さない）
      }
    });
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
