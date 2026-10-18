// BL-059: 広告の流れ（app/ad-flow.ts）。シート → 広告 → 報酬・ミッドゲームの機会・広告の間の停止（TS-059-01〜17 の integration・unit の部分）
// 画面からの流れ（シートの動画のボタン・スピナー・案内）は ui-overlay、本物のビルドは E8（BL-074）・BL-103 の e2e
import { afterEach, describe, expect, it } from 'vitest';
import { createAdFlow, type AdFlowDeps } from '../../src/app/ad-flow.ts';
import { createLifecycle } from '../../src/app/lifecycle.ts';
import { GameStore } from '../../src/app/store.ts';
import { PARAMS } from '../../src/content/params.ts';
import { blockHp, interludeLeftMs, type GameState } from '../../src/core/index.ts';
import type { BreakPlacement, LateReward, Platform, RewardPlacement, RewardResult } from '../../src/platform/types.ts';
import { stateWith } from '../support/states.ts';

/** 手で動かす偽の広告（結果・onPlaying を好きな順で出せる。壊れたアダプタも模せる） */
function fakeAds() {
  const playing: ((p: boolean) => void)[] = [];
  const late: ((r: LateReward) => void)[] = [];
  const calls: string[] = [];
  let avail = true;
  let resolveReward: ((r: RewardResult) => void) | null = null;
  let rejectReward: ((e: unknown) => void) | null = null;
  let resolveBreak: (() => void) | null = null;
  const ads: Platform['ads'] = {
    rewardedAvailable: () => avail,
    showRewarded: (p: RewardPlacement) => {
      calls.push(`showRewarded:${p}`);
      return new Promise<RewardResult>((res, rej) => {
        resolveReward = res;
        rejectReward = rej;
      });
    },
    breakOpportunity: (p: BreakPlacement) => {
      calls.push(`breakOpportunity:${p}`);
      return new Promise<void>((res) => {
        resolveBreak = res;
      });
    },
    onPlaying: (cb) => void playing.push(cb),
    onLateReward: (cb) => void late.push(cb),
  };
  return {
    ads,
    calls,
    setAvail: (v: boolean) => (avail = v),
    emit: (p: boolean) => playing.forEach((cb) => cb(p)),
    /** 遅れた報酬（Q-45）を出す（壊れたアダプタを模して同じ id を 2 回出すこともできる） */
    late: (id: number, placement: RewardPlacement) => late.forEach((cb) => cb({ id, placement })),
    result: (r: RewardResult) => resolveReward?.(r),
    reject: (e: unknown) => rejectReward?.(e),
    endBreak: () => resolveBreak?.(),
  };
}

/** 広告の流れの部品をすべて記録する偽物 */
function rig(over: Partial<AdFlowDeps> = {}) {
  const a = fakeAds();
  const log: string[] = [];
  const signals: string[] = [];
  const life = createLifecycle({
    loadingStart: () => signals.push('loadingStart'),
    loadingStop: () => signals.push('loadingStop'),
    gameplayStart: () => signals.push('gameplayStart'),
    gameplayStop: () => signals.push('gameplayStop'),
  });
  life.loadingStart();
  life.loadingStop();
  life.firstInput();
  signals.length = 0;
  const st = {
    hidden: false,
    loopRunning: true,
    inputBlocked: false,
    muted: false,
    saves: 0,
    grants: [] as RewardPlacement[],
    resumes: 0,
    /** core が報酬を受けるか（false は休み中・鉱脈が消えたなど） */
    grantOk: true,
  };
  const errors: unknown[] = [];
  const flow = createAdFlow({
    ads: a.ads,
    isMuted: () => false,
    life,
    input: {
      setBlocked: (_r, on) => {
        st.inputBlocked = on;
        log.push(`input:${on}`);
      },
    },
    loop: {
      pause: () => {
        st.loopRunning = false;
      },
      resume: () => {
        st.loopRunning = true;
      },
    },
    isHidden: () => st.hidden,
    setMuted: (m) => {
      st.muted = m;
    },
    resumeAudio: () => void st.resumes++,
    saveBeforeAd: () => {
      st.saves++;
      log.push('save');
    },
    grant: (p) => {
      st.grants.push(p);
      log.push(`grant:${p}`);
      return { ok: st.grantOk };
    },
    onError: (e) => errors.push(e),
    ...over,
  });
  return { a, flow, life, st, signals, log, errors };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('リワード（requestReward）', () => {
  it('TS-059-01・16: 要求の前に保存を 1 回試し、showRewarded を 1 回。保存が例外でも広告は要求する', async () => {
    const r = rig({
      saveBeforeAd: () => {
        throw new Error('quota');
      },
    });
    const pr = r.flow.requestReward('R2');
    await flush();
    expect(r.a.calls).toEqual(['showRewarded:R2']);
    expect(r.errors).toHaveLength(1);
    r.a.result('rewarded');
    await expect(pr).resolves.toBe('rewarded');
  });

  it('S-5: 要求の前に reserve(p) を 1 回（保存の後・showRewarded の前）。連打でも 1 回。reserve の例外でも広告は要求する', async () => {
    const order: string[] = [];
    const r = rig({
      saveBeforeAd: () => void order.push('save'),
      reserve: (p) => void order.push(`reserve:${p}`),
    });
    r.a.ads.showRewarded = ((orig) => (p: RewardPlacement) => {
      order.push(`show:${p}`);
      return orig(p);
    })(r.a.ads.showRewarded);
    const prs = [r.flow.requestReward('R3'), r.flow.requestReward('R3')];
    await flush();
    expect(order).toEqual(['save', 'reserve:R3', 'show:R3']);
    r.a.result('rewarded');
    await Promise.all(prs);
    const bad = rig({
      reserve: () => {
        throw new Error('core');
      },
    });
    void bad.flow.requestReward('R3');
    await flush();
    expect(bad.a.calls).toEqual(['showRewarded:R3']);
    expect(bad.errors).toHaveLength(1);
  });

  it('TS-059-02: 要求中に何度呼んでも、要求は 1 回・報酬は 1 回（同じ Promise）', async () => {
    const r = rig();
    const prs = [1, 2, 3, 4, 5].map(() => r.flow.requestReward('R2'));
    await flush();
    expect(r.a.calls).toEqual(['showRewarded:R2']);
    expect(r.st.saves).toBe(1);
    r.a.result('rewarded');
    expect(await Promise.all(prs)).toEqual(Array(5).fill('rewarded'));
    expect(r.st.grants).toEqual(['R2']);
    // 終わった後の要求は新しい要求
    void r.flow.requestReward('R3');
    await flush();
    expect(r.a.calls).toEqual(['showRewarded:R2', 'showRewarded:R3']);
  });

  it('TS-059-04: rewarded のときだけ、結果が分かった後に grant を 1 回（R1・R2・R3）', async () => {
    for (const p of ['R1', 'R2', 'R3'] as const) {
      const r = rig();
      const pr = r.flow.requestReward(p);
      await flush();
      expect(r.st.grants).toEqual([]); // 結果の前には渡さない
      r.a.result('rewarded');
      await pr;
      expect(r.log).toEqual(['save', `grant:${p}`]);
    }
  });

  it('TS-059-05: failed・unavailable・reject は報酬なしで、その結果（reject は failed）を返す。例外は外に出ない', async () => {
    for (const end of ['failed', 'unavailable', 'reject'] as const) {
      const r = rig();
      const pr = r.flow.requestReward('R2');
      await flush();
      if (end === 'reject') r.a.reject(new Error('sdk'));
      else r.a.result(end);
      await expect(pr).resolves.toBe(end === 'reject' ? 'failed' : end);
      expect(r.st.grants).toEqual([]);
    }
  });

  it('TS-059-06: 同じ要求に rewarded が 2 回来ても報酬は 1 回。onPlaying の二重・true なしの false は無視する', async () => {
    const r = rig();
    const pr = r.flow.requestReward('R2');
    await flush();
    r.a.emit(false); // true の前の false
    expect(r.signals).toEqual([]);
    r.a.emit(true);
    r.a.emit(true);
    r.a.emit(false);
    r.a.emit(false);
    r.a.result('rewarded');
    r.a.result('rewarded');
    await pr;
    await flush();
    expect(r.st.grants).toEqual(['R2']);
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
    expect(r.st.loopRunning).toBe(true);
    expect(r.st.inputBlocked).toBe(false);
  });

  it('TS-059-06: 時間切れの failed の後に遅れて再生されたら、再生の間だけ止まり、終われば戻る（見終えなければ報酬なし）', async () => {
    const r = rig();
    const pr = r.flow.requestReward('R2');
    await flush();
    r.a.result('failed'); // 開始まで 30 秒の時間切れ（onPlaying なし）
    await expect(pr).resolves.toBe('failed');
    r.a.emit(true);
    expect([r.st.loopRunning, r.st.inputBlocked, r.st.muted]).toEqual([false, true, true]);
    r.a.emit(false); // アダプタが遅れた報酬を出さない（始まった後の失敗・再生の時間切れ）
    expect([r.st.loopRunning, r.st.inputBlocked, r.st.muted]).toEqual([true, false, false]);
    expect(r.st.grants).toEqual([]);
  });

  it('TS-059-17 ②: 隠れている間に rewarded が返ったらその時点で報酬を渡し、ループは見えるまで止まったまま', async () => {
    const r = rig();
    const pr = r.flow.requestReward('R2');
    await flush();
    r.a.emit(true);
    r.st.hidden = true;
    r.flow.syncHidden();
    r.a.emit(false);
    r.a.result('rewarded');
    await pr;
    expect(r.st.grants).toEqual(['R2']);
    expect(r.st.loopRunning).toBe(false);
    r.st.hidden = false;
    r.flow.syncHidden();
    expect(r.st.loopRunning).toBe(true);
  });
});

describe('広告の再生中の停止（onPlaying）', () => {
  it('TS-059-03・15: 再生中はループ・入力・音・gameplay を止め、終わりで戻して音の再開の関数を呼ぶ', () => {
    const r = rig();
    r.a.emit(true);
    expect(r.st).toMatchObject({ loopRunning: false, inputBlocked: true, muted: true, resumes: 0 });
    expect(r.signals).toEqual(['gameplayStop']);
    r.a.emit(false);
    expect(r.st).toMatchObject({ loopRunning: true, inputBlocked: false, muted: false, resumes: 1 });
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
  });

  it('ポータルの消音中なら、広告が終わっても消音のまま', () => {
    const r = rig({ isMuted: () => true });
    r.a.emit(true);
    r.a.emit(false);
    expect(r.st.muted).toBe(true);
  });

  it('TS-059-13 ①: 広告の最中にタブを隠して見せても、ループは動き出さない（PR #16 のレビュー S-3）', () => {
    const r = rig();
    r.a.emit(true);
    r.st.hidden = true;
    r.flow.syncHidden();
    r.st.hidden = false;
    r.flow.syncHidden();
    expect(r.st.loopRunning).toBe(false);
    r.a.emit(false);
    expect(r.st.loopRunning).toBe(true);
  });

  it('TS-059-13 ②: 隠れている間に広告が終わってもループは止まったまま、見えたら動く', () => {
    const r = rig();
    r.a.emit(true);
    r.st.hidden = true;
    r.flow.syncHidden();
    r.a.emit(false);
    expect(r.st.loopRunning).toBe(false);
    r.st.hidden = false;
    r.flow.syncHidden();
    expect(r.st.loopRunning).toBe(true);
  });
});

describe('ミッドゲーム（BreakOpportunity → breakOpportunity）', () => {
  it('TS-059-08・09: BreakOpportunity のイベントのときだけ breakOpportunity(placement) を呼ぶ。ほかのイベントでは呼ばない', async () => {
    const r = rig();
    r.flow.onEvents([{ type: 'StratumEntered', band: 3 }]);
    expect(r.a.calls).toEqual([]);
    r.flow.onEvents([{ type: 'BreakOpportunity', placement: 'M2', band: 3 }]);
    expect(r.a.calls).toEqual(['breakOpportunity:M2']);
    r.a.endBreak();
    await flush();
    r.flow.onEvents([{ type: 'BreakOpportunity', placement: 'M1' }]);
    expect(r.a.calls).toEqual(['breakOpportunity:M2', 'breakOpportunity:M1']);
  });

  it('TS-059-11: break の間はループ・入力を止め、onPlaying(false) が先に来ても gameplayStart は Promise が決まった後の 1 回だけ', async () => {
    const r = rig();
    r.flow.onEvents([{ type: 'BreakOpportunity', placement: 'M2', band: 3 }]);
    expect(r.flow.breaking).toBe(true);
    expect([r.st.loopRunning, r.st.inputBlocked]).toEqual([false, true]);
    r.a.emit(true);
    r.a.emit(false);
    expect(r.signals).toEqual(['gameplayStop']); // ad が外れても break が残る
    expect([r.st.loopRunning, r.st.inputBlocked]).toEqual([false, true]);
    r.a.endBreak();
    await flush();
    expect(r.signals).toEqual(['gameplayStop', 'gameplayStart']);
    expect([r.st.loopRunning, r.st.inputBlocked, r.flow.breaking]).toEqual([true, false, false]);
  });

  it('機会が重なったら後のものは渡さない。breakOpportunity が例外・reject でも止めたものを戻す', async () => {
    const r = rig();
    r.flow.onEvents([
      { type: 'BreakOpportunity', placement: 'M2', band: 3 },
      { type: 'BreakOpportunity', placement: 'M2', band: 4 },
    ]);
    expect(r.a.calls).toEqual(['breakOpportunity:M2']);
    r.a.endBreak();
    await flush();
    const bad = rig();
    bad.a.ads.breakOpportunity = () => Promise.reject(new Error('sdk'));
    bad.flow.onEvents([{ type: 'BreakOpportunity', placement: 'M2', band: 3 }]);
    await flush();
    expect([bad.st.loopRunning, bad.st.inputBlocked, bad.flow.breaking]).toEqual([true, false, false]);
    expect(bad.signals).toEqual(['gameplayStop', 'gameplayStart']);
    expect(bad.errors).toHaveLength(1);
  });
});

describe('本物のストア・core とつないだ M2（TS-059-10・11）', () => {
  const onStratum = PARAMS.ads.midgame.onStratum;
  afterEach(() => {
    (PARAMS.ads.midgame as { onStratum: boolean }).onStratum = onStratum;
  });

  /** 149m のブロックの残り HP を 1 にした状態（次の 1 打で 150m・帯 4 に入る） */
  const at149 = (): GameState => {
    const s = stateWith({ seed: 1, depth: 149, tool: 1 });
    s.run.blockDmg = blockHp(s, 149).sub(1);
    return s;
  };

  /** main.ts と同じ順に結線する: ad-flow の onEvents と、通知のたびの interlude */
  const wire = () => {
    const r = rig();
    const store = new GameStore(at149());
    store.onEvents((evs) => r.flow.onEvents(evs));
    store.subscribe(() => r.life.setPaused('interlude', interludeLeftMs(store.state) > 0));
    return { ...r, store };
  };

  it('TS-059-11: 帯 4 の幕間の始まり → 終わりで、合図は gameplayStop → gameplayStart の 1 往復だけ（break が interlude より先に立つ）', async () => {
    const w = wire();
    w.store.dispatch({ type: 'tap' });
    expect(w.store.state.run.depth).toBe(150);
    expect(w.signals).toEqual(['gameplayStop']); // 幕間の始まり
    w.store.advance(1500); // 幕間の終わり: BreakOpportunity（pushEvents）→ 通知で interlude が外れる
    expect(w.a.calls).toEqual(['breakOpportunity:M2']);
    expect(interludeLeftMs(w.store.state)).toBe(0);
    expect(w.signals).toEqual(['gameplayStop']); // start → stop のちらつきがない
    w.a.emit(true);
    w.a.emit(false);
    w.a.endBreak();
    await flush();
    expect(w.signals).toEqual(['gameplayStop', 'gameplayStart']);
  });

  it('TS-059-10: ads.midgame.onStratum が false なら core がイベントを出さず、breakOpportunity も break もない', () => {
    (PARAMS.ads.midgame as { onStratum: boolean }).onStratum = false;
    const w = wire();
    w.store.dispatch({ type: 'tap' });
    w.store.advance(1500);
    expect(w.a.calls).toEqual([]);
    expect(w.flow.breaking).toBe(false);
    expect(w.signals).toEqual(['gameplayStop', 'gameplayStart']); // 幕間の合図は通常どおり
  });
});

describe('遅れた報酬（Q-45。決定 0010 の 5: 開始の時間切れの後に遅れて始まり、最後まで見られた広告には報酬を 1 回だけ）', () => {
  it('TS-059-06: 時間切れの failed の後に、遅れて最後まで見られたら報酬を 1 回付けて知らせる。同じ id が 2 回来ても 1 回', async () => {
    const r = rig();
    const told: RewardPlacement[] = [];
    r.flow.onLateReward((p) => told.push(p));
    const pr = r.flow.requestReward('R2');
    await flush();
    r.a.result('failed');
    await expect(pr).resolves.toBe('failed');
    expect(r.st.grants).toEqual([]); // 時間切れの時点では付けない
    r.a.emit(true);
    r.a.emit(false);
    r.a.late(1, 'R2');
    expect(r.st.grants).toEqual(['R2']);
    expect(told).toEqual(['R2']);
    r.a.late(1, 'R2'); // 壊れたアダプタの二重の知らせ
    expect(r.st.grants).toEqual(['R2']);
    expect(told).toEqual(['R2']);
    expect(r.log).toEqual(['save', 'input:true', 'input:false', 'grant:R2']); // 保存は要求の前の 1 回だけ
  });

  it('別の要求と混ざらない: 次の要求の最中に前の要求の遅れた報酬が来ても、前の placement に付け、今の要求の Promise・報酬はそのまま', async () => {
    const r = rig();
    const told: RewardPlacement[] = [];
    r.flow.onLateReward((p) => told.push(p));
    const first = r.flow.requestReward('R2');
    await flush();
    r.a.result('failed');
    await first;
    const second = r.flow.requestReward('R3');
    await flush();
    expect(r.a.calls).toEqual(['showRewarded:R2', 'showRewarded:R3']);
    let settled = false;
    void second.then(() => (settled = true));
    r.a.late(1, 'R2');
    await flush();
    expect(settled).toBe(false); // 今の要求は終わらない
    expect(r.st.grants).toEqual(['R2']);
    expect(r.flow.requestReward('R3')).toBe(second); // 要求中の口もそのまま（連打で 2 回目を出さない）
    r.a.result('rewarded');
    await expect(second).resolves.toBe('rewarded');
    expect(r.st.grants).toEqual(['R2', 'R3']); // 今の要求の報酬はその結果の 1 回だけ
    expect(told).toEqual(['R2']); // 知らせは遅れた報酬だけ（ふつうの報酬はシートが閉じて分かる）
    r.a.late(2, 'R3'); // 別の id は別の要求
    expect(r.st.grants).toEqual(['R2', 'R3', 'R3']);
  });

  it('core が断ったら（R2 の休み中・R3 の鉱脈が消えた）何も付けず知らせない。grant・購読者の例外は外に出ない。購読はやめられる', () => {
    const r = rig();
    const told: RewardPlacement[] = [];
    const off = r.flow.onLateReward((p) => told.push(p));
    r.st.grantOk = false;
    r.a.late(1, 'R3');
    expect(told).toEqual([]);
    r.st.grantOk = true;
    r.a.late(1, 'R3'); // 断られた id をもう一度受けても付けない（1 つの要求に 1 回）
    expect(r.st.grants).toEqual(['R3']);
    expect(told).toEqual([]);
    const bad = rig({
      grant: () => {
        throw new Error('core');
      },
    });
    bad.flow.onLateReward(() => {
      throw new Error('ui');
    });
    expect(() => bad.a.late(1, 'R2')).not.toThrow();
    expect(bad.errors).toHaveLength(1); // grant の例外だけ（付かなかったので知らせない）
    const two = rig();
    const got: RewardPlacement[] = [];
    two.flow.onLateReward(() => {
      throw new Error('ui');
    });
    two.flow.onLateReward((p) => got.push(p));
    expect(() => two.a.late(1, 'R2')).not.toThrow();
    expect(got).toEqual(['R2']); // 前の購読者の例外で後の購読者が止まらない
    expect(two.errors).toHaveLength(1);
    off();
    r.a.late(2, 'R2');
    expect(r.st.grants).toEqual(['R3', 'R2']);
    expect(told).toEqual([]); // 購読をやめた後は知らせない
  });
});
