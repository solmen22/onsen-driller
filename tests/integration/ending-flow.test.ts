// BL-023: エンディングのカードと止める理由 'ending'（app/ad-flow.ts）。CEO 決定 2026-11-15 の D6・Q-55。
// TS-ID はテスト設計者のシナリオ（scenarios/BL-023_legendary-ending.md）
import { describe, expect, it } from 'vitest';
import { createAdFlow, pausesForReward, type AdFlowDeps } from '../../src/app/ad-flow.ts';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import type { GameEvent } from '../../src/core/index.ts';
import type { BreakPlacement, Platform, RewardResult } from '../../src/platform/types.ts';
import { createPokiPlatform } from '../../src/platform/poki.ts';
import { pokiMock } from '../../e2e/mocks/poki.ts';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 手で終わらせるミッドゲーム・リワードの偽の広告と、合図・ループ・カードを記録する部品 */
function rig(over: Partial<AdFlowDeps> = {}) {
  const calls: string[] = [];
  const playing: ((p: boolean) => void)[] = [];
  let endBreak: ((fail?: boolean) => void) | null = null;
  let endReward: ((r: RewardResult) => void) | null = null;
  const ads: Platform['ads'] = {
    rewardedAvailable: () => true,
    showRewarded: (p) => {
      calls.push(`showRewarded:${p}`);
      return new Promise<RewardResult>((res) => (endReward = res));
    },
    breakOpportunity: (p: BreakPlacement) => {
      calls.push(`breakOpportunity:${p}`);
      return new Promise<void>((res, rej) => (endBreak = (fail) => (fail ? rej(new Error('ad failed')) : res())));
    },
    onPlaying: (cb) => void playing.push(cb),
    onLateReward: () => {},
  };
  const signals: string[] = [];
  const life = createLifecycle({
    loadingStart: () => {},
    loadingStop: () => {},
    gameplayStart: () => signals.push('gameplayStart'),
    gameplayStop: () => signals.push('gameplayStop'),
  });
  life.loadingStart();
  life.loadingStop();
  life.firstInput();
  signals.length = 0;
  const st = { hidden: false, loop: true, cards: 0 };
  const flow = createAdFlow({
    ads,
    isMuted: () => false,
    life,
    input: { setBlocked: () => {} },
    loop: { pause: () => void (st.loop = false), resume: () => void (st.loop = true) },
    isHidden: () => st.hidden,
    setMuted: () => {},
    resumeAudio: () => {},
    saveBeforeAd: () => {},
    grant: () => ({ ok: true }),
    showEnding: () => {
      st.cards++;
      calls.push('showEnding');
    },
    ...over,
  });
  return { flow, calls, signals, st, emitPlaying: (p: boolean) => playing.forEach((cb) => cb(p)), endBreak: (f?: boolean) => endBreak?.(f), endReward: (r: RewardResult) => endReward?.(r) };
}

const reached: GameEvent = { type: 'EndingReached', depth: 500 };
const shortcutPrestige: GameEvent[] = [{ type: 'PrestigeDone', gained: '1.44e2' }, { type: 'EndingReached', depth: 600 }, { type: 'BreakOpportunity', placement: 'M1' }];

describe('TS-023-09 カードの間は止まる理由 ending で止める', () => {
  it('EndingReached でカードを出し、ループと gameplay を止める。飛ばすと戻る（合図は 1 往復）', () => {
    const r = rig();
    r.flow.onEvents([{ type: 'BlockBroken', depth: 499, ore: null, coins: '1e0' }, reached]);
    expect(r.st).toMatchObject({ cards: 1, loop: false });
    expect(r.flow.endingOpen).toBe(true);
    expect(r.signals).toEqual(['gameplayStop']);
    r.flow.endingClosed();
    expect(r.st.loop).toBe(true);
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
    r.flow.endingClosed(); // 2 回目は何もしない
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
  });

  it('カードを出す口（showEnding）がない間は、止めない', () => {
    const r = rig({ showEnding: undefined });
    r.flow.onEvents([reached]);
    expect([r.flow.endingOpen, r.st.loop, r.signals]).toEqual([false, true, []]);
  });
});

describe('TS-023-11 近道の転生: M1 の広告の後にカード', () => {
  it('(a) PrestigeDone → EndingReached → M1 の列: 先に M1 を渡し、広告が終わってからカード。合図は止める 1 回・カードを閉じた後に始める 1 回', async () => {
    const r = rig();
    r.flow.onEvents(shortcutPrestige);
    expect(r.calls).toEqual(['breakOpportunity:M1']);
    expect(r.st.cards).toBe(0);
    r.endBreak();
    await flush();
    expect(r.calls).toEqual(['breakOpportunity:M1', 'showEnding']);
    expect([r.st.loop, r.flow.endingOpen]).toEqual([false, true]);
    expect(r.signals).toEqual(['gameplayStop']); // 'break' を外す前に 'ending' が立つので、ここで gameplayStart は出ない
    r.flow.endingClosed();
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
  });

  it('(b) M1 の機会がない（ads.midgame.onPrestige が false）: すぐカード', () => {
    const r = rig();
    r.flow.onEvents(shortcutPrestige.filter((e) => e.type !== 'BreakOpportunity'));
    expect(r.calls).toEqual(['showEnding']);
  });

  it('(c) M1 の広告が失敗しても、終わった後にカード', async () => {
    const r = rig();
    r.flow.onEvents(shortcutPrestige);
    r.endBreak(true);
    await flush();
    expect(r.calls).toEqual(['breakOpportunity:M1', 'showEnding']);
    expect(r.signals).toEqual(['gameplayStop']);
  });

  it('広告の再生中・転生の確認の画面・リワードの要求の間（Poki）は待ち、終わってから出す', async () => {
    const a = rig();
    a.emitPlaying(true);
    a.flow.onEvents([reached]);
    expect(a.st.cards).toBe(0);
    a.emitPlaying(false);
    expect(a.st.cards).toBe(1);

    const b = rig();
    b.flow.setPrestigeConfirm(true);
    b.flow.onEvents([reached]);
    expect(b.st.cards).toBe(0);
    b.flow.setPrestigeConfirm(false);
    expect(b.st.cards).toBe(1);
    expect(b.signals).toEqual(['gameplayStop']); // 確認の画面 → カードで止めたまま

    const c = rig({ pauseForReward: true });
    const pr = c.flow.requestReward('R2');
    c.flow.onEvents([reached]);
    expect(c.st.cards).toBe(0);
    c.endReward('rewarded');
    await pr;
    expect(c.st.cards).toBe(1);
    expect(c.signals).toEqual(['gameplayStop']);
  });
});

describe('TS-023-14 タブが隠れてもカードは閉じない（Q-55 (f)）', () => {
  it('隠れて戻っても開いたまま止まったまま。hidden と ending の両方が外れてから再開する', () => {
    const r = rig();
    r.flow.onEvents([reached]);
    r.st.hidden = true;
    r.flow.syncHidden();
    r.st.hidden = false;
    r.flow.syncHidden();
    expect([r.flow.endingOpen, r.st.loop]).toEqual([true, false]);
    r.flow.endingClosed();
    expect(r.st.loop).toBe(true);
  });
});

describe('TS-023-12 Poki（本物のアダプタ・SDK のモック。#88 の合図の保留）', () => {
  it('近道の転生の M1（commercialBreak）→ カード: SDK の gameplayStart はカードを閉じた後に 1 回だけ。広告の間に合図を出さない', async () => {
    const sdk = pokiMock();
    sdk.manual = true;
    const platform = createPokiPlatform({ getSdk: () => sdk });
    await platform.init();
    const life = createLifecycle(platform);
    life.loadingStart();
    life.loadingStop();
    life.firstInput();
    let card = false;
    const flow = createAdFlow({
      ads: platform.ads,
      isMuted: () => false,
      life,
      input: { setBlocked: () => {} },
      loop: { pause: () => {}, resume: () => {} },
      isHidden: () => false,
      setMuted: () => {},
      resumeAudio: () => {},
      saveBeforeAd: () => {},
      grant: () => ({ ok: true }),
      pauseForReward: pausesForReward(platform.target),
      showEnding: () => void (card = true),
    });
    sdk.log.length = 0;
    flow.onEvents(shortcutPrestige);
    await flush();
    sdk.start();
    sdk.finish();
    await flush();
    await flush();
    expect(card).toBe(true);
    expect(sdk.log.filter((x) => x === 'gameplayStart')).toEqual([]);
    flow.endingClosed();
    await flush();
    expect(sdk.log).toEqual(['gameplayStop', 'commercialBreak', 'gameplayStart']);
  });
});
