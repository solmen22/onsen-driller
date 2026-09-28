// 起動と組み立て（arch §3-1）
import { render } from 'preact';
import { h } from 'preact';
import { createInitialState, type GameState } from '../core/index.ts';
import { loadPlatform } from '../platform/index.ts';
import { SaveSlots } from '../save/slots.ts';
import { detectLang, setLang, type Lang } from '../i18n/index.ts';
import { App } from '../ui/App.tsx';
import { applyLayout, layoutOf } from '../ui/layout.ts';
import { Ctx } from '../ui/hooks/use-game.ts';
import { playBreak, playHit, setMuted, unlockAudio } from '../audio/sfx.ts';
import { startAutosave } from './autosave.ts';
import { createAppClock } from './clock.ts';
import type { DevParams } from './dev-params.ts';
import { captureErrors, createErrorLog } from './errors.ts';
import { setupInput } from './input.ts';
import { startLoop } from './loop.ts';
import type { PerfMonitor } from './perf.ts';
import { loadSettings, saveSettings } from './settings.ts';
import { GameStore } from './store.ts';
import '../styles/global.css';

const APP_VERSION = __APP_VERSION__;
/** dev（開発サーバー）と e2e 系のビルドだけ true。本番の 4 ビルドでは定数の置き換えで false になり、下の分岐ごと落ちる */
const DEV_BUILD = import.meta.env.DEV || import.meta.env.VITE_TEST_HOOKS === 'true';

/** 縦・横の判定（ui/layout.ts の layoutOf。横 ÷ 縦 ≥ 1.1 で横）。回転・大きさの変更で切り替える */
function layout(root: HTMLElement): void {
  const apply = (): void => {
    applyLayout(root, layoutOf(root.clientWidth, root.clientHeight));
  };
  new ResizeObserver(apply).observe(root);
  apply();
}

/** 直近のエラー 20 件（テスト用フックの errors()・S3 の「エラー情報をコピー」）。起動の途中の例外も拾うよう最初に付ける */
const errorLog = createErrorLog();
captureErrors(window, errorLog);

/** app の時計（テスト用フックの setClock で壁時計を差し替えられる） */
const clock = createAppClock();

/** 最初の起動のシード（Q-16）: 壁時計と単調時計から作る */
const clockSeed = (): number => (clock.wallNow() ^ Math.floor(clock.monoNow() * 1000)) >>> 0;

async function boot(): Promise<void> {
  const params: DevParams = DEV_BUILD
    ? (await import('./dev-params.ts')).readDevParams(location.search)
    : { fps: false, particles: 0, auto: false, demo: false, seed: null };
  const perf: PerfMonitor | null = DEV_BUILD ? new (await import('./perf.ts')).PerfMonitor() : null;
  const root = document.getElementById('app');
  const stage = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!root || !stage || !uiRoot) throw new Error('missing root elements');
  layout(root);

  const platform = await loadPlatform();
  platform.loadingStart();
  await platform.init();
  const storage = platform.storage;
  // 設定（別のキー。壊れていたら初期値）と言語（設定 → platform.locale → navigator.language → 英語。arch §13）
  const settings = loadSettings(storage);
  setLang(settings.lang === 'auto' ? detectLang(platform.locale()) : settings.lang);
  setMuted(platform.isMuted());
  platform.onMutedChange(setMuted);

  // 読み込み（2 枠。arch §11・Q-11）。起動時からメモリだけなら unavailable（save-warning を起動直後に出す）
  const slots = new SaveSlots(storage, { appVersion: APP_VERSION, now: () => clock.wallNow(), unavailable: storage.kind === 'memory' });
  const loaded = params.demo ? null : slots.load();
  const state: GameState = loaded?.state ?? createInitialState(params.seed ?? clockSeed());
  if (params.demo) {
    state.run.coins = state.run.coins.add(5e6);
    state.run.drill.level = 40;
    state.run.drill.tool = 1;
  }
  if (params.auto) {
    state.run.autoDig.on = true;
    state.input.hold = true;
  }
  const store = new GameStore(state);
  store.setSaveStatus(slots.status);
  perf?.start();
  const loop = startLoop(store, clock);

  const onLangChange = (l: Lang): void => {
    settings.lang = l;
    saveSettings(storage, settings);
  };
  render(h(Ctx.Provider, { value: { store, platform, version: APP_VERSION, onLangChange } }, h(App, {})), uiRoot);

  const contextEvents: string[] = [];
  const { createView } = await import('../view/game.ts');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = await createView(stage, {
    state: () => store.state,
    drain: () => store.drainView(),
    onInputRendered: (now) => perf?.markRendered(now),
    hasPendingInput: () => perf?.hasPendingInput() ?? false,
    stressParticles: params.particles,
    reduceMotion,
    onContext: (ev) => contextEvents.push(ev),
    layout: () => root.dataset.layout,
  });

  // 音: 描画とは別に、打撃とブロックの破壊で鳴らす（イベント列は描画が消費するので、ストアの購読で数を見る）
  let lastHits = store.state.stats.hits;
  let lastBlocks = store.state.stats.blocks;
  store.subscribe(() => {
    const s = store.state.stats;
    if (s.hits > lastHits) playHit(performance.now());
    if (s.blocks > lastBlocks) playBreak();
    lastHits = s.hits;
    lastBlocks = s.blocks;
  });

  const input = setupInput({ stage, win: window, doc: document }, store, {
    onFirstInput: () => {
      unlockAudio();
      platform.gameplayStart(); // Poki の要件: 最初の入力で gameplayStart
    },
    onPress: (ts) => perf?.markInput(ts),
  });

  // 広告の再生中はループ・入力・音を止める
  platform.ads.onPlaying((playing) => {
    input.setEnabled(!playing);
    setMuted(playing || platform.isMuted());
    if (playing) loop.pause();
    else loop.resume();
  });

  // 保存の契機（15 秒ごと・hidden・pagehide。録画モード・読み取り専用・デモでは保存しない）
  const autosave = startAutosave({
    slots,
    getState: () => store.state,
    win: window,
    doc: document,
    isSuppressed: () => settings.recordingMode || slots.readOnly || params.demo,
    onStatus: (st) => store.setSaveStatus(st),
  });
  // タブを隠したらループを止める（保存は autosave が先に行う。戻ったときの早送りは S3 の BL-030）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      platform.gameplayStop();
      loop.pause();
    } else {
      loop.resume();
    }
  });

  platform.loadingStop();
  root.dataset.ready = 'true';

  if (DEV_BUILD && perf && params.fps) {
    perf.mountOverlay(
      () =>
        `${view.rendererName().slice(0, 40)}\ndpr ${devicePixelRatio} ${innerWidth}x${innerHeight} ${root.dataset.layout}\nparticles ${view.aliveParticles()} depth ${store.state.run.depth}m`,
    );
  }
  if (import.meta.env.VITE_TEST_HOOKS === 'true') {
    const m = await import('./test-hooks.ts');
    m.install({ store, loop, perf, platform, view, contextEvents, clock, autosave, slots, errors: errorLog });
  }
}

void boot();
