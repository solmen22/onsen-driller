// BL-102: 効果音の解錠（audio/sfx.ts の unlockAudio）。AudioContext がない（Windows の Playwright の WebKit・Node）・
// コンストラクタが例外を投げる・resume() が拒否する環境でも、処理されない Promise の拒否を出さず、呼び出し元に例外を漏らさず、
// 音なしで掘り続けられることを確かめる。AudioContext がある環境では今までどおり読み込んで resume し、効果音が鳴る。
// ZzFX は本物を使い、Web Audio だけを vi.stubGlobal で差し替える。ZzFX はモジュールの読み込み時に new AudioContext を作るので、
// ケースごとに vi.resetModules で sfx.ts と ZzFX を読み込み直す
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInput } from '../../src/app/input.ts';
import { GameStore } from '../../src/app/store.ts';
import { createInitialState } from '../../src/core/index.ts';

type Sfx = typeof import('../../src/audio/sfx.ts');

/** sfx.ts と ZzFX を読み込み直す（読み込み済みの ZzFX・読み込み中の Promise を捨てる） */
async function freshSfx(): Promise<Sfx> {
  vi.resetModules();
  return import('../../src/audio/sfx.ts');
}

interface AudioCalls {
  created: number;
  resumed: number;
  played: number;
}

/** ZzFX が使う分だけの Web Audio の偽物を globalThis に置く。resume() の振る舞いは差し替えられる */
function stubWebAudio(resume: () => Promise<void> = () => Promise.resolve()): AudioCalls {
  const calls: AudioCalls = { created: 0, resumed: 0, played: 0 };
  const link = { connect: (next: unknown): unknown => next };
  class FakeAudioContext {
    readonly destination = {};
    constructor() {
      calls.created++;
    }
    resume(): Promise<void> {
      calls.resumed++;
      return resume();
    }
    createBuffer(channels: number, length: number): { getChannelData(i: number): Float32Array | undefined } {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i) => data[i] };
    }
    createBufferSource(): object {
      return {
        ...link,
        buffer: null,
        playbackRate: { value: 1 },
        loop: false,
        start: () => {
          calls.played++;
        },
      };
    }
    createGain(): object {
      return { ...link, gain: { value: 1 } };
    }
  }
  class FakeStereoPannerNode {
    connect(next: unknown): unknown {
      return next;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('StereoPannerNode', FakeStereoPannerNode);
  return calls;
}

/** コンストラクタが例外を投げる AudioContext（Web Audio を作れない環境）を置く。作ろうとした回数を返す */
function stubThrowingAudioContext(): { attempts: number } {
  const c = { attempts: 0 };
  class ThrowingAudioContext {
    constructor() {
      c.attempts++;
      throw new Error('NotSupportedError: audio is not available');
    }
  }
  vi.stubGlobal('AudioContext', ThrowingAudioContext);
  return c;
}

/** 音が使えない環境（ZzFX の読み込み・resume が失敗する）。setup は Web Audio の差し替えと、その環境になったことの確認 */
const unavailableEnvs: { name: string; setup: () => () => void }[] = [
  {
    name: 'AudioContext がない（Windows の Playwright の WebKit と同じ ReferenceError）',
    setup: () => {
      expect('AudioContext' in globalThis, '前提: Node には AudioContext がない').toBe(false);
      return () => undefined;
    },
  },
  {
    name: 'AudioContext のコンストラクタが例外を投げる',
    setup: () => {
      const c = stubThrowingAudioContext();
      return () => expect(c.attempts, 'ZzFX が AudioContext を作ろうとした').toBeGreaterThan(0);
    },
  },
  {
    name: 'resume() が拒否する',
    setup: () => {
      const calls = stubWebAudio(() => Promise.reject(new Error('NotAllowedError: resume refused')));
      return () => expect(calls.resumed).toBe(1);
    },
  },
  {
    name: 'resume() が同期で例外を投げる',
    setup: () => {
      const calls = stubWebAudio(() => {
        throw new Error('InvalidStateError: closed');
      });
      return () => expect(calls.resumed).toBe(1);
    },
  },
];

/** 処理されない Promise の拒否（Node の unhandledRejection。ブラウザの unhandledrejection に当たる）を集める */
let rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};
/** 未処理の拒否の判定を待つ（Node はマイクロタスクを流し切った後に判定するので、次のマクロタスクまで待つ） */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  rejections = [];
  process.on('unhandledRejection', onRejection);
});
afterEach(() => {
  process.off('unhandledRejection', onRejection);
  vi.unstubAllGlobals();
});

describe('unlockAudio — 音が使えない環境では音を諦めて続ける（BL-102）', () => {
  for (const env of unavailableEnvs) {
    it(`${env.name}: 拒否せず、例外も未処理の拒否も出ない。何度呼んでも同じ。以後の playHit・playBreak は何もしない`, async () => {
      const verify = env.setup();
      const sfx = await freshSfx();
      let first: Promise<void> | undefined;
      expect(() => {
        first = sfx.unlockAudio();
      }).not.toThrow();
      await expect(first).resolves.toBeUndefined();
      // 2 回目以降も例外なし・拒否なし（読み込みは再試行しない）
      expect(() => void sfx.unlockAudio()).not.toThrow();
      await expect(sfx.unlockAudio()).resolves.toBeUndefined();
      await settle();
      expect(rejections).toEqual([]);
      verify();
      expect(() => {
        sfx.playHit(1_000);
        sfx.playHit(2_000, 1.2);
        sfx.playBreak();
      }).not.toThrow();
    });
  }

  it('AudioContext がないと ZzFX の読み込み自体が拒否される（このテストが再現している条件の確認）', async () => {
    vi.resetModules();
    await expect(import('zzfx')).rejects.toThrow(/AudioContext/);
  });

  it('resume() が拒否したら音を諦める（その後の playHit・playBreak は鳴らさない）', async () => {
    const calls = stubWebAudio(() => Promise.reject(new Error('NotAllowedError')));
    const sfx = await freshSfx();
    await sfx.unlockAudio();
    sfx.playHit(1_000);
    sfx.playBreak();
    expect(calls.played).toBe(0);
    await settle();
    expect(rejections).toEqual([]);
  });
});

describe('unlockAudio — AudioContext がある環境（今までどおり。iOS 対策の「最初の入力で読み込んで resume」）', () => {
  it('読み込む前は鳴らない。unlock で ZzFX を読み込んで resume し、効果音が鳴る。何度呼んでも読み込みと resume は 1 回', async () => {
    const calls = stubWebAudio();
    const sfx = await freshSfx();
    sfx.playBreak();
    expect(calls.played, '読み込む前は何もしない').toBe(0);
    const p = sfx.unlockAudio();
    expect(sfx.unlockAudio(), '読み込み中に呼んでも同じ Promise').toBe(p);
    await p;
    await sfx.unlockAudio();
    expect(calls.created).toBe(1);
    expect(calls.resumed).toBe(1);
    sfx.playHit(1_000);
    expect(calls.played).toBe(1);
    sfx.playHit(1_050); // 80ms 未満の打撃は鳴らさない（1 秒に最大 12 回）
    expect(calls.played).toBe(1);
    sfx.playBreak();
    expect(calls.played).toBe(2);
    sfx.setMuted(true);
    sfx.playHit(2_000);
    sfx.playBreak();
    expect(calls.played, '消音中は鳴らさない').toBe(2);
    sfx.setMuted(false);
    sfx.playBreak();
    expect(calls.played).toBe(3);
    await settle();
    expect(rejections).toEqual([]);
  });
});

describe('音を諦めても掘る・購入が続く（main.ts と同じ結線: 最初の入力で unlockAudio、ストアの購読で playHit・playBreak）', () => {
  /** ツルハシ（3 コイン）の代金がたまる打撃の数は 29（Q-02）。余裕をみて 32 回叩く */
  const TAPS = 32;

  for (const env of unavailableEnvs) {
    it(`${env.name}: ステージを叩くと打撃・ブロックの破壊・コインが増え、ツルハシを買える。購読者の例外も未処理の拒否もない`, async () => {
      const verify = env.setup();
      const sfx = await freshSfx();
      const subscriberErrors: unknown[] = [];
      const store = new GameStore(createInitialState(1), { onError: (e) => subscriberErrors.push(e) });
      let lastHits = store.state.stats.hits;
      let lastBlocks = store.state.stats.blocks;
      store.subscribe(() => {
        const s = store.state.stats;
        if (s.hits > lastHits) sfx.playHit(performance.now());
        if (s.blocks > lastBlocks) sfx.playBreak();
        lastHits = s.hits;
        lastBlocks = s.blocks;
      });
      let unlocks = 0;
      const stage = new EventTarget();
      const input = setupInput({ stage, win: new EventTarget(), doc: new EventTarget() }, store, {
        onFirstInput: () => {
          unlocks++;
          void sfx.unlockAudio();
        },
      });
      try {
        const tap = (): void => {
          const down = new Event('pointerdown', { cancelable: true });
          Object.defineProperty(down, 'isPrimary', { value: true });
          stage.dispatchEvent(down);
          stage.dispatchEvent(new Event('pointerup'));
          store.advance(500); // 毎秒 2 回（打撃の上限にかからない）
        };
        tap();
        expect(unlocks, '最初の入力で音の解錠を呼んだ').toBe(1);
        await sfx.unlockAudio(); // 読み込みの失敗が確定するのを待つ（main.ts と同じ Promise）
        await settle();
        for (let i = 1; i < TAPS; i++) tap();
        await settle();

        const s = store.state;
        expect(s.stats.hits).toBe(TAPS);
        expect(s.stats.blocks).toBeGreaterThan(0);
        expect(s.run.coins.gte(3)).toBe(true);
        expect(store.dispatch({ type: 'buy', item: 'tool', qty: 1 }).ok).toBe(true);
        expect(store.state.run.drill.tool).toBe(1);
        tap();
        expect(store.state.stats.hits, '購入の後も掘れる').toBe(TAPS + 1);
        expect(subscriberErrors).toEqual([]);
        expect(rejections).toEqual([]);
        verify();
      } finally {
        input.dispose();
      }
    });
  }
});
