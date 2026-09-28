// 時計の注入（arch §8-2）。core は時刻を読まない
export interface Clock {
  /** 壁時計（UTC の ms） */
  wallNow(): number;
  /** 単調時計（ms） */
  monoNow(): number;
}

export const systemClock: Clock = {
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
};
