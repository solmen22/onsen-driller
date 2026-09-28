// テスト用フック window.__game（arch §8-4・traceability §5-2 の Q-16。BL-071）。VITE_TEST_HOOKS=true のビルド（e2e・e2e-crazygames）にだけ入る。
// main.ts が import.meta.env.VITE_TEST_HOOKS のときだけ動的に import するので、本番の 4 ビルドには入らない（check:size が文字列で検査する）。
// - core・save の側の関数は core-api.md §5 のもの（toSaveGame・stateHash・parseGameForHook・createInitialState・applyGrant・advance の carry）
// - advance・seed・setState・grant の後は store が UI へ通知する（HUD・購入ボタンがすぐ新しい値になる）
// ブラウザがなくても確かめられるように、フックの本体（createHooks）は依存を引数で受け取る（tests/integration/test-hooks.test.ts）
import {
  applyGrant,
  createAdvanceCarry,
  createInitialState,
  stateHash,
  toSaveGame,
  type ActionResult,
  type AdvanceCarry,
  type AdvanceInput,
  type GameEvent,
  type GrantInput,
  type SaveGame,
} from '../core/index.ts';
import type { Platform, PlatformCall, RewardPlacement, BreakPlacement, RewardResult, Target } from '../platform/types.ts';
import { parseGameForHook } from '../save/codec.ts';
import type { SaveSlots } from '../save/slots.ts';
import type { RenderStats, View } from '../view/game.ts';
import type { Autosave } from './autosave.ts';
import type { AppClock } from './clock.ts';
import type { ErrorLog } from './errors.ts';
import type { Loop } from './loop.ts';
import type { PerfMonitor } from './perf.ts';
import type { GameStore } from './store.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** arch §8-4 の API（Q-16 の振る舞い） */
export interface TestHooks {
  /** package.json の version（ビルド時の定数） */
  readonly version: string;
  readonly target: Target;
  /** 保存する封筒の game と同じ形（JSON。Decimal は文字列、input は含まない） */
  getState(): SaveGame;
  /** getState() の正規化 JSON の FNV-1a（保存の checksum と同じ） */
  stateHash(): string;
  /** セーブの読み込みと同じ検証。拒否（オブジェクトでない・run/meta がない）は例外で、今の状態は変えない */
  setState(s: unknown): void;
  /** createInitialState(n) の新しいゲームにする。ストレージには書かない */
  seed(n: number): void;
  /** 実時間のループを止める／動かす（自動保存のタイマーは止めない） */
  pause(): void;
  resume(): void;
  /** ロジックだけを 100ms の固定ステップで進め、その間のイベントを返す。100ms 未満とタップの端数は次の呼び出しへ持ち越す */
  advance(ms: number, input?: AdvanceInput): GameEvent[];
  /** アプリの壁時計を wallMs にする（以後は単調時計の経過ぶん進む）。null で元に戻す */
  setClock(wallMs: number | null): void;
  dispatch(a: unknown): ActionResult;
  /** coins・tickets は足す、depth は置き換え（core-api.md §5）。形の正しくない値は例外 */
  grant(p: GrantInput): void;
  /** キャンバス内の要素の画面上の矩形（ビューポートの CSS ピクセル）。S1 は 'drill' だけ、ほかは null */
  rect(id: string): Rect | null;
  renderStats(): RenderStats;
  /** 直近のイベント（古い順。既定 100 件・保持 500 件） */
  events(limit?: number): GameEvent[];
  platform: {
    /** アダプタへの呼び出し（呼び出し順、直近 100 件） */
    calls(): PlatformCall[];
    /** dev アダプタ（e2e の web）の偽の広告の結果。ほかのアダプタでは何もしない */
    setAdResult(r: RewardResult): void;
  };
  /** 捕まえたエラー（直近 20 件） */
  errors(): string[];
  /** 今すぐ保存する（arch §8-4 の一覧の外の補助。core-api.md §5 の「保存を今すぐ」）。保存しなかったら false */
  saveNow(): boolean;
}

/** フックが使う描画の API（view/game.ts の View の一部） */
export type HookView = Pick<View, 'rectOf' | 'renderStats'>;

export interface HookDeps {
  store: GameStore;
  loop: Pick<Loop, 'pause' | 'resume'>;
  platform: Platform;
  view: HookView;
  /** 壁時計の差し替え（createAppClock） */
  clock: Pick<AppClock, 'setWall'>;
  /** 捕まえたエラー（app/errors.ts） */
  errors: Pick<ErrorLog, 'list'>;
  /** 保存の契機（BL-027）。saveNow に使う */
  autosave?: Pick<Autosave, 'saveNow'>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** フックの本体（arch §8-4 の API だけ。PoC の計測用の補助は install で足す） */
export function createHooks(d: HookDeps): TestHooks {
  // advance の端数（100ms 未満とタップ）。seed・setState で作り直す
  let carry: AdvanceCarry = createAdvanceCarry();
  const platform = d.platform as Platform & { setAdResult?: (r: RewardResult) => void };
  return {
    version: __APP_VERSION__,
    target: d.platform.target,
    getState: () => toSaveGame(d.store.state),
    stateHash: () => stateHash(d.store.state),
    setState(s) {
      const next = parseGameForHook(s); // 拒否は例外（状態は変えない）
      carry = createAdvanceCarry();
      d.store.replaceState(next);
    },
    seed(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`seed: finite number required: ${String(n)}`);
      carry = createAdvanceCarry();
      d.store.replaceState(createInitialState(n));
    },
    pause: () => d.loop.pause(),
    resume: () => d.loop.resume(),
    advance(ms, input) {
      const inp: AdvanceInput | undefined = isObject(input) ? input : undefined;
      return d.store.advance(ms, inp ? { input: inp, carry } : { carry });
    },
    setClock(wallMs) {
      if (wallMs !== null && typeof wallMs !== 'number') throw new TypeError(`setClock: number or null required: ${String(wallMs)}`);
      d.clock.setWall(wallMs);
    },
    dispatch: (a) => d.store.dispatch(a),
    grant(p) {
      const evs = applyGrant(d.store.state, p); // 形の正しくない値は例外（状態は変えない）
      d.store.pushEvents(evs);
      d.store.notify();
    },
    rect: (id) => (typeof id === 'string' ? d.view.rectOf(id) : null),
    renderStats: () => d.view.renderStats(),
    events: (limit) => d.store.events(limit),
    platform: {
      calls: () => d.platform.calls(),
      setAdResult: (r) => platform.setAdResult?.(r),
    },
    errors: () => d.errors.list(),
    saveNow: () => d.autosave?.saveNow('manual') ?? false,
  };
}

export interface InstallDeps extends HookDeps {
  view: View;
  perf: PerfMonitor | null;
  contextEvents: string[];
  slots?: SaveSlots;
}

/** window.__game を置く。PoC の計測用の補助（perf・view・広告の直接の呼び出し）も残す（e2e/perf.spec.ts・screens.spec.ts・smoke.spec.ts） */
export function install(d: InstallDeps, win: object = window): TestHooks {
  const hooks = createHooks(d);
  const full = {
    ...hooks,
    platform: {
      ...hooks.platform,
      showRewarded: (p: RewardPlacement) => d.platform.ads.showRewarded(p),
      breakOpportunity: (p: BreakPlacement) => d.platform.ads.breakOpportunity(p),
      rewardedAvailable: () => d.platform.ads.rewardedAvailable(),
    },
    perf: { reset: () => d.perf?.reset(), stats: () => d.perf?.stats() ?? null },
    view: {
      renderer: () => d.view.rendererName(),
      particles: () => d.view.aliveParticles(),
      loseContext: () => d.view.loseContext(),
      restoreContext: () => d.view.restoreContext(),
      contextEvents: () => [...d.contextEvents],
      frame: () => d.view.game.loop.frame,
      /** 描画結果の色の種類の数（真っ黒・真っ白なら 1〜2）。コンテキスト喪失からの復帰の確認用 */
      snapshotColors: () =>
        new Promise<number>((resolve) => {
          d.view.game.renderer.snapshot((img) => {
            if (!(img instanceof HTMLImageElement)) return resolve(-1);
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            if (!ctx) return resolve(-1);
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            const set = new Set<number>();
            for (let i = 0; i < data.length; i += 4 * 97) set.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
            resolve(set.size);
          });
        }),
    },
  };
  (win as Record<string, unknown>)['__game'] = full;
  return full;
}
