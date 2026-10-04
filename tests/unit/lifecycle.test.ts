// BL-056: ライフサイクル（app/lifecycle.ts。arch §7 の状態図）。ポータルへの loading・gameplay の合図の順番と冪等性
// e2e の TS-E1-03・04・TS-071-17 は、同じことを本物のビルドの platform.calls() で確かめる
import { describe, expect, it } from 'vitest';
import { createLifecycle, signalsHidden, type LifecyclePlatform, type PauseReason } from '../../src/app/lifecycle.ts';
import type { Target } from '../../src/platform/types.ts';

/** 呼ばれた順に名前を記録する Platform の 4 つの関数 */
function recorder(): { p: LifecyclePlatform; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    p: {
      loadingStart: () => calls.push('loadingStart'),
      loadingStop: () => calls.push('loadingStop'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
    },
  };
}

/** 読み込みを終えて最初の入力まで済ませた状態 */
function playingLife(): { life: ReturnType<typeof createLifecycle>; calls: string[] } {
  const { p, calls } = recorder();
  const life = createLifecycle(p);
  life.loadingStart();
  life.loadingStop();
  life.firstInput();
  return { life, calls };
}

describe('読み込みと最初の入力（TS-E1-03・04 の単体版）', () => {
  it('入力がない間は loadingStart → loadingStop だけ。最初の入力で gameplayStart がちょうど 1 回', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p);
    life.loadingStart();
    life.loadingStop();
    expect(calls).toEqual(['loadingStart', 'loadingStop']);
    expect(life.playing).toBe(false);
    life.firstInput();
    life.firstInput();
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
    expect(life.playing).toBe(true);
  });
  it('loadingStart・loadingStop は二度目を送らない', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p);
    life.loadingStart();
    life.loadingStart();
    life.loadingStop();
    life.loadingStop();
    expect(calls).toEqual(['loadingStart', 'loadingStop']);
  });
  it('読み込みの途中で押されたら、gameplayStart は loadingStop の後に送る', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p);
    life.loadingStart();
    life.firstInput();
    expect(calls).toEqual(['loadingStart']);
    life.loadingStop();
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
  });
});

describe('止まる理由（非表示・広告・幕間・転生の演出）', () => {
  const reasons: PauseReason[] = ['hidden', 'ad', 'interlude', 'prestige'];
  for (const r of reasons) {
    it(`${r}: 止まる間は gameplayStop 1 回、外れたら gameplayStart 1 回（同じ合図を二度送らない）`, () => {
      const { life, calls } = playingLife();
      calls.length = 0;
      life.setPaused(r, true);
      life.setPaused(r, true);
      expect(calls).toEqual(['gameplayStop']);
      expect(life.playing).toBe(false);
      life.setPaused(r, false);
      life.setPaused(r, false);
      expect(calls).toEqual(['gameplayStop', 'gameplayStart']);
      expect(life.playing).toBe(true);
    });
  }
  it('理由が重なったら、すべて外れるまで再開しない（非表示の間に広告が終わっても止まったまま）', () => {
    const { life, calls } = playingLife();
    calls.length = 0;
    life.setPaused('ad', true);
    life.setPaused('hidden', true);
    life.setPaused('ad', false);
    expect(calls).toEqual(['gameplayStop']);
    life.setPaused('hidden', false);
    expect(calls).toEqual(['gameplayStop', 'gameplayStart']);
  });
  it('最初の入力の前は止める・外すのどちらも何も送らない。入力の前に隠れて戻っても、入力までは gameplayStart しない', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p);
    life.loadingStart();
    life.loadingStop();
    life.setPaused('hidden', true);
    life.setPaused('hidden', false);
    life.setPaused('interlude', false);
    expect(calls).toEqual(['loadingStart', 'loadingStop']);
    life.firstInput();
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
  });
  it('隠れた状態で最初の入力が来ても（起動がバックグラウンドのタブ）、見えるまで gameplayStart しない', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p);
    life.loadingStart();
    life.setPaused('hidden', true);
    life.loadingStop();
    life.firstInput();
    expect(calls).toEqual(['loadingStart', 'loadingStop']);
    life.setPaused('hidden', false);
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
  });
});

describe('非表示を合図にするかはポータルごと（BL-057。PR #16 のレビュー S-1。arch §7 の表）', () => {
  it('crazygames だけ合図にしない（公式: "Don’t call this event when the user switches focus or leaves the game area"）', () => {
    const table = Object.fromEntries((['web', 'itch', 'crazygames', 'poki', 'dev'] as Target[]).map((t) => [t, signalsHidden(t)]));
    expect(table).toEqual({ web: true, itch: true, crazygames: false, poki: true, dev: true });
  });
  it('signalHidden: false なら、隠れて戻っても gameplayStop・gameplayStart を送らない。ほかの理由は今までどおり', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p, { signalHidden: false });
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    calls.length = 0;
    life.setPaused('hidden', true);
    expect(calls).toEqual([]);
    expect(life.playing).toBe(true);
    life.setPaused('hidden', false);
    expect(calls).toEqual([]);
    life.setPaused('ad', true);
    life.setPaused('ad', false);
    life.setPaused('interlude', true);
    life.setPaused('interlude', false);
    expect(calls).toEqual(['gameplayStop', 'gameplayStart', 'gameplayStop', 'gameplayStart']);
  });
  it('signalHidden: false なら、隠れている間に幕間・広告が終わると、その場で gameplayStart する（フォーカスはポータルが扱う）', () => {
    const { p, calls } = recorder();
    const life = createLifecycle(p, { signalHidden: false });
    life.loadingStart();
    life.setPaused('hidden', true); // 起動がバックグラウンドのタブでも
    life.loadingStop();
    life.firstInput();
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart']);
    life.setPaused('ad', true);
    life.setPaused('hidden', true);
    life.setPaused('ad', false);
    expect(calls).toEqual(['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart']);
  });
  it('既定（オプションなし）は今までどおり非表示で止める', () => {
    const { life, calls } = playingLife();
    calls.length = 0;
    life.setPaused('hidden', true);
    expect(calls).toEqual(['gameplayStop']);
  });
});
