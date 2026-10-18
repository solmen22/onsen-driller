// 起動と組み立て（arch §3-1）
import { render } from 'preact';
import { h } from 'preact';
import { createInitialState, interludeLeftMs, type GameState } from '../core/index.ts';
import { loadPlatform } from '../platform/index.ts';
import { moveLegacySlots } from '../save/legacy.ts';
import { SaveSlots } from '../save/slots.ts';
import { resolveLang, setLang, type Lang } from '../i18n/index.ts';
import { App } from '../ui/App.tsx';
import { applyLayout, layoutOf } from '../ui/layout.ts';
import { Ctx } from '../ui/hooks/use-game.ts';
import { onModalChange } from '../ui/overlay/modal-state.ts';
import { playBreak, playHit, resumeAudio, setMuted, unlockAudio } from '../audio/sfx.ts';
import { startAutosave } from './autosave.ts';
import { createAppClock } from './clock.ts';
import { createRewardHooks } from './rewards.ts';
import type { View } from '../view/game.ts';
import type { DevParams } from './dev-params.ts';
import { captureErrors, createErrorLog } from './errors.ts';
import { isHappyMoment } from './happy-time.ts';
import { setupInput } from './input.ts';
import { createLifecycle, signalsHidden } from './lifecycle.ts';
import { startLoop } from './loop.ts';
import type { PerfMonitor } from './perf.ts';
import { makePersistSettings, saveDisplay } from './save-display.ts';
import { loadSettings } from './settings.ts';
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
    : { fps: false, particles: 0, auto: false, demo: false, seed: null, debug: false };
  const perf: PerfMonitor | null = DEV_BUILD ? new (await import('./perf.ts')).PerfMonitor() : null;
  const root = document.getElementById('app');
  const stage = document.getElementById('stage');
  const uiRoot = document.getElementById('ui');
  if (!root || !stage || !uiRoot) throw new Error('missing root elements');
  layout(root);

  const platform = await loadPlatform();
  // ポータルへの loading・gameplay の合図（arch §7。BL-056）。gameplay は最初の入力の後、止まる理由がない間だけ。
  // CrazyGames ではタブの非表示を合図にしない（ポータルが扱う。BL-057・PR #16 のレビュー S-1）
  const life = createLifecycle(platform, { signalHidden: signalsHidden(platform.target) });
  life.loadingStart();
  await platform.init();
  const storage = platform.storage;
  // 設定（別のキー。壊れていたら初期値）と言語（設定 → platform.locale → navigator.language → 英語。arch §13）
  const settings = loadSettings(storage);
  setLang(resolveLang(settings.lang, platform.locale())); // 判定は resolveLang の 1 か所（PR #11 のレビュー S-1）
  setMuted(platform.isMuted());
  platform.onMutedChange(setMuted);

  // CrazyGames: SDK が読めなかった起動で localStorage に保存した枠を、data モジュールへ移す（arch §11。BL-057。移せなければ次の起動で）
  if (platform.legacyStorage) moveLegacySlots(platform.legacyStorage, storage);
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
  // 読み取り専用（新しい版のセーブ）なら起動直後から readonly（Q-26。最初の保存の前、UI の最初の描画の前）
  store.setSaveStatus(saveDisplay(slots.status, slots.readOnly));
  // 設定を書く唯一の口。読み取り専用の間は書かない（Q-26 ③）
  const persistSettings = makePersistSettings(storage, settings, () => slots.readOnly);
  // 祝いの合図（CrazyGames の happytime。最初の源泉・お客さんの初来訪・転生の完了だけ。app/happy-time.ts）
  store.onEvents((evs) => {
    for (const e of evs) if (isHappyMoment(e, store.state)) platform.happyTime();
  });
  perf?.start();
  const loop = startLoop(store, clock);

  // 入力・保存の契機は、描画の起動より前に結線する（描画のチャンクの読み込みや Phaser の起動に失敗しても、
  // 遊べて進行を保存し続ける。レビュー S-3）。hidden・pagehide では、入力（長押しの終わり）→ 保存 → ループの停止の順に動く
  // （リスナーを付けた順。長押しの終わりで端数が変わった後の状態を保存する。以前の順番と同じ）
  const input = setupInput({ stage, win: window, doc: document }, store, {
    onFirstInput: () => {
      // 拒否しない（音が使えないときは音なしで続ける。BL-102）。AudioContext がない環境は黙る。ZzFX のチャンクが届かない等の
      // 失敗は errors() に残す（描画のチャンクの失敗と同じ。console には出さない）
      void unlockAudio((e) => errorLog.push(e));
      life.firstInput(); // Poki の要件: 最初の入力で gameplayStart（読み込みの途中なら loadingStop の後）
    },
    onPress: (ts) => perf?.markInput(ts),
  });
  // 止まった音（iOS のバックグラウンドからの復帰・電話の後など）を、次の入力のハンドラの中で同期に戻す（BL-104）。
  // タッチでは pointerdown が利用者の操作とみなされないブラウザがあるので、pointerup・touchend でも呼ぶ（running なら何もしない）
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(type, resumeAudio, true);

  // モーダル・シートの表示中は掘削の入力を止める（ゲームは止めない。Q-37 (e)。BL-046）
  onModalChange((open) => input.setBlocked('modal', open));

  // 広告の再生中はループ・入力・音を止め、gameplay も止める
  platform.ads.onPlaying((playing) => {
    life.setPaused('ad', playing);
    input.setBlocked('ad', playing);
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
    onStatus: (st) => store.setSaveStatus(saveDisplay(st, slots.readOnly)),
  });
  // タブを隠したら gameplay とループを止める（保存は autosave が先に行う。戻ったときの早送りは S3 の BL-030）。
  // 見えるようになったら、ほかに止まる理由がなければ gameplay を再開する（CrazyGames は gameplay の合図を送らず、ループだけ止める）
  life.setPaused('hidden', document.hidden);
  document.addEventListener('visibilitychange', () => {
    life.setPaused('hidden', document.hidden);
    if (document.hidden) loop.pause();
    else loop.resume();
  });
  // 幕間（新しい帯に入った直後の 1.5 秒。ドリルが止まる）の間は gameplay を止める（ストアの通知は 200ms ごと）
  store.subscribe(() => life.setPaused('interlude', interludeLeftMs(store.state) > 0));

  const onLangChange = (l: Lang): void => {
    settings.lang = l;
    persistSettings();
  };
  // ご褒美の口（R1 のチケット・R2 のチケット・動画の付与）。壁時計は store.wallTime()（startLoop がつないだ app の時計。BL-059）。
  // 動画の要求（requestReward）は BL-059 の広告の流れでつなぐ（'rewarded' のときだけ rewards.grantAd を呼ぶ）
  const rewards = createRewardHooks(store);
  render(h(Ctx.Provider, { value: { store, platform, version: APP_VERSION, onLangChange, rewards } }, h(App, {})), uiRoot);

  const contextEvents: string[] = [];
  // 描画（Phaser）の起動。チャンクの読み込みや起動の失敗は記録に残し（errors()・S3 の「エラー情報をコピー」）、
  // HUD・入力・保存は続ける（レビュー S-3）
  let view: View | null = null;
  try {
    const { createView } = await import('../view/game.ts');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    view = await createView(stage, {
      state: () => store.state,
      drain: () => store.drainView(),
      onInputRendered: (now) => perf?.markRendered(now),
      hasPendingInput: () => perf?.hasPendingInput() ?? false,
      stressParticles: params.particles,
      reduceMotion,
      onContext: (ev) => contextEvents.push(ev),
      layout: () => root.dataset.layout,
    });
  } catch (e) {
    errorLog.push(e);
  }

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

  life.loadingStop();
  root.dataset.ready = 'true';

  if (DEV_BUILD && perf && params.fps && view) {
    const v = view;
    perf.mountOverlay(
      () =>
        `${v.rendererName().slice(0, 40)}\ndpr ${devicePixelRatio} ${innerWidth}x${innerHeight} ${root.dataset.layout}\nparticles ${v.aliveParticles()} depth ${store.state.run.depth}m`,
    );
  }
  if (DEV_BUILD && params.debug) (await import('./dev-panel.ts')).mountDevPanel({ store, platform });
  if (import.meta.env.VITE_TEST_HOOKS === 'true') {
    const m = await import('./test-hooks.ts');
    if (view) m.install({ store, loop, perf, platform, view, contextEvents, clock, autosave, slots, errors: errorLog });
  }
}

void boot();
