// 起動と組み立て（arch §3-1）
import { render } from 'preact';
import { h } from 'preact';
import { createInitialState, type GameState } from '../core/index.ts';
import { loadPlatform } from '../platform/index.ts';
import { STORAGE_PREFIX } from '../platform/types.ts';
import { decodeSave, encodeSave } from '../save/codec.ts';
import { detectLang, setLang } from '../i18n/index.ts';
import { App } from '../ui/App.tsx';
import { Ctx } from '../ui/hooks/useGame.ts';
import { playBreak, playHit, setMuted, unlockAudio } from '../audio/sfx.ts';
import { systemClock } from './clock.ts';
import { setupInput } from './input.ts';
import { startLoop } from './loop.ts';
import { PerfMonitor } from './perf.ts';
import { readPocParams } from './pocParams.ts';
import { GameStore } from './store.ts';
import '../styles/global.css';

const APP_VERSION = '0.0.1-poc';
const SAVE_KEY = `${STORAGE_PREFIX}save:a`;

function layout(root: HTMLElement): void {
  const apply = (): void => {
    const w = root.clientWidth;
    const hgt = root.clientHeight;
    root.dataset.layout = hgt > 0 && w / hgt >= 1.1 ? 'landscape' : 'portrait';
  };
  new ResizeObserver(apply).observe(root);
  apply();
}

async function boot(): Promise<void> {
  const params = readPocParams(location.search);
  const root = document.getElementById('app');
  const stage = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!root || !stage || !uiRoot) throw new Error('missing root elements');
  layout(root);

  const platform = await loadPlatform();
  platform.loadingStart();
  await platform.init();
  setLang(detectLang(platform.locale()));
  setMuted(platform.isMuted());
  platform.onMutedChange(setMuted);

  // 読み込み（PoC: 1 枠だけ。2 枠保存・移行は E5）
  let state: GameState = createInitialState(params.seed);
  const raw = platform.storage.get(SAVE_KEY);
  if (raw && !params.demo) {
    const r = decodeSave(raw);
    if (r.ok) state = r.state;
  }
  if (params.demo) {
    state.run.coins = state.run.coins.add(5e6);
    state.run.drill.level = 40;
    state.run.drill.tool = 1;
  }
  if (params.auto) {
    state.run.autoDig.on = true;
    state.run.hold = true;
  }
  const store = new GameStore(state);
  const perf = new PerfMonitor();
  perf.start();
  const loop = startLoop(store, systemClock);

  render(h(Ctx.Provider, { value: { store, platform, version: APP_VERSION } }, h(App, {})), uiRoot);

  const contextEvents: string[] = [];
  const { createView } = await import('../view/game.ts');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = await createView(stage, {
    state: () => store.state,
    drain: () => store.drainView(),
    onInputRendered: (now) => perf.markRendered(now),
    hasPendingInput: () => perf.hasPendingInput(),
    stressParticles: params.particles,
    reduceMotion,
    onContext: (ev) => contextEvents.push(ev),
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

  const input = setupInput(stage, store, perf, () => {
    unlockAudio();
    platform.gameplayStart(); // Poki の要件: 最初の入力で gameplayStart
  });

  // 広告の再生中はループ・入力・音を止める
  platform.ads.onPlaying((playing) => {
    input.setEnabled(!playing);
    setMuted(playing || platform.isMuted());
    if (playing) loop.pause();
    else loop.resume();
  });

  // 保存（PoC: 15 秒ごとと非表示のとき）
  let seq = 0;
  const save = (): void => {
    platform.storage.set(SAVE_KEY, encodeSave(store.state, ++seq, systemClock.wallNow(), APP_VERSION));
  };
  setInterval(save, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      save();
      platform.gameplayStop();
      loop.pause();
    } else {
      loop.resume();
    }
  });
  window.addEventListener('pagehide', save);

  platform.loadingStop();
  root.dataset.ready = 'true';

  if (params.fps) {
    perf.mountOverlay(
      () =>
        `${view.rendererName().slice(0, 40)}\ndpr ${devicePixelRatio} ${innerWidth}x${innerHeight} ${root.dataset.layout}\nparticles ${view.aliveParticles()} depth ${store.state.run.depth}m`,
    );
  }
  if (import.meta.env.VITE_TEST_HOOKS === 'true') {
    const m = await import('./testHooks.ts');
    m.install({ store, loop, perf, platform, view, contextEvents });
  }
}

void boot();
