// 時計の注入（arch §8-2。BL-009）。core は時刻を読まない。app が時刻を読み、必要なアクションに引数で渡す
export interface Clock {
  /** 壁時計（UTC の ms） */
  wallNow(): number;
  /** 単調時計（ms。減らない） */
  monoNow(): number;
}

export const systemClock: Clock = {
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
};

/** app が使う時計: 普段は base（本番は systemClock）。テスト用フックの setClock で壁時計だけを差し替えられる */
export interface AppClock extends Clock {
  /** 壁時計を wallMs に差し替える（以後は単調時計の経過ぶん進む）。null で元に戻す */
  setWall(wallMs: number | null): void;
}

export function createAppClock(base: Clock = systemClock): AppClock {
  let wallAt: number | null = null;
  let monoAt = 0;
  return {
    wallNow: () => (wallAt === null ? base.wallNow() : wallAt + (base.monoNow() - monoAt)),
    monoNow: () => base.monoNow(),
    setWall(w) {
      if (w === null) wallAt = null;
      else if (Number.isFinite(w)) {
        wallAt = w;
        monoAt = base.monoNow();
      }
    },
  };
}

/** テスト・テスト用フックの偽の時計。advance で両方を進め、setWall で壁時計だけを差し替える */
export interface FakeClock extends Clock {
  advance(ms: number): void;
  setWall(wallMs: number): void;
}

export function createFakeClock(wallMs = 0, monoMs = 0): FakeClock {
  let wall = wallMs;
  let mono = monoMs;
  return {
    wallNow: () => wall,
    monoNow: () => mono,
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) return;
      wall += ms;
      mono += ms;
    },
    setWall(w) {
      if (Number.isFinite(w)) wall = w;
    },
  };
}
