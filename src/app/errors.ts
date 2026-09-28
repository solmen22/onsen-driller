// 直近のエラーの記録（arch §4。20 件）。テスト用フックの errors() と、S3 の「エラー情報をコピー」（gdd §11-2 の T5）が使う
// - window の error（捕まえなかった例外）と unhandledrejection（処理しなかった Promise の失敗）を記録する
// - 本番のビルドにも入る（サーバーがないので、不具合の報告に貼ってもらう文字列の元になる）
// ブラウザがなくても確かめられるように、イベントを受ける EventTarget を引数で受け取る（tests/unit/errors.test.ts）

/** 残す件数（古いものから捨てる） */
export const ERRORS_KEEP = 20;
/** 1 件の文字数の上限（長いスタックや巨大なオブジェクトで記録が膨らまないように） */
export const ERROR_TEXT_MAX = 500;

export interface ErrorLog {
  /** 1 件を記録する（どんな値でも例外を投げない） */
  push(e: unknown): void;
  /** 直近の記録（古い順。最後が最新。複製を返す） */
  list(): string[];
}

/** エラーの値を 1 行の文字列にする（Error は「名前: メッセージ」、ほかは String()） */
export function describeError(e: unknown): string {
  let s: string;
  try {
    if (e instanceof Error) s = `${e.name}: ${e.message}`;
    else if (typeof e === 'string') s = e;
    else s = String(e);
  } catch {
    s = '(unprintable error)';
  }
  return s.length > ERROR_TEXT_MAX ? `${s.slice(0, ERROR_TEXT_MAX - 1)}…` : s;
}

export function createErrorLog(keep: number = ERRORS_KEEP): ErrorLog {
  const max = Number.isSafeInteger(keep) && keep > 0 ? keep : ERRORS_KEEP;
  const items: string[] = [];
  return {
    push(e) {
      items.push(describeError(e));
      if (items.length > max) items.splice(0, items.length - max);
    },
    list: () => [...items],
  };
}

interface ErrorEventLike {
  error?: unknown;
  message?: unknown;
}
interface RejectionEventLike {
  reason?: unknown;
}

/** window の error・unhandledrejection を log に記録する。戻り値で購読をやめる */
export function captureErrors(win: EventTarget, log: ErrorLog): () => void {
  const onError = (ev: Event): void => {
    const e = ev as unknown as ErrorEventLike;
    log.push(e.error !== undefined && e.error !== null ? e.error : e.message);
  };
  const onRejection = (ev: Event): void => {
    log.push((ev as unknown as RejectionEventLike).reason);
  };
  win.addEventListener('error', onError);
  win.addEventListener('unhandledrejection', onRejection);
  return () => {
    win.removeEventListener('error', onError);
    win.removeEventListener('unhandledrejection', onRejection);
  };
}
