// BL-102: 効果音の解錠（audio/sfx.ts の unlockAudio）。音が使えない環境でも、処理されない Promise の拒否を出さず、呼び出し元に
// 例外を漏らさず、音なしで掘り続けられることを確かめる。失敗の扱いは 2 つ（コードレビュー PR #8 の S-1。CEO 決定で案 (a)）:
// - 接頭辞なしの AudioContext がない環境（Windows の Playwright の WebKit・Node、webkitAudioContext だけの古い Safari）:
//   ZzFX を読み込みに行かず、黙って音なしで続ける（onFailure を呼ばない＝errors() は 0 件のまま）
// - それ以外の失敗（ZzFX のチャンクが届かない・コンストラクタが投げる・resume の失敗）: onFailure に 1 回だけ渡す（main.ts が errors() に残す）
// AudioContext がある環境では今までどおり読み込んで resume し、効果音が鳴る。
// ZzFX は本物を使い、Web Audio だけを vi.stubGlobal で差し替える（チャンクの失敗と、読み込みの有無を数えるときだけ vi.doMock）。
// ZzFX はモジュールの読み込み時に new AudioContext を作るので、ケースごとに vi.resetModules で sfx.ts と ZzFX を読み込み直す
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorLog, describeError } from '../../src/app/errors.ts';
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

/** ZzFX が使う分だけの Web Audio の偽物のクラスを作る。resume() の振る舞いは差し替えられる */
function fakeAudioContextClass(calls: AudioCalls, resume: () => Promise<void>): new () => object {
  const link = { connect: (next: unknown): unknown => next };
  return class FakeAudioContext {
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
  };
}

/** 偽の Web Audio を globalThis に置く（AudioContext と StereoPannerNode） */
function stubWebAudio(resume: () => Promise<void> = () => Promise.resolve()): AudioCalls {
  const calls: AudioCalls = { created: 0, resumed: 0, played: 0 };
  class FakeStereoPannerNode {
    connect(next: unknown): unknown {
      return next;
    }
  }
  vi.stubGlobal('AudioContext', fakeAudioContextClass(calls, resume));
  vi.stubGlobal('StereoPannerNode', FakeStereoPannerNode);
  return calls;
}

/** ZzFX の読み込みを偽物にして、読み込まれた回数を数える（読み込みに行かないことの確認用） */
function countZzfxLoads(): { loads: number } {
  const c = { loads: 0 };
  vi.doMock('zzfx', () => {
    c.loads++;
    return { zzfx: () => undefined, ZZFX: { volume: 0.3, audioContext: { resume: () => Promise.resolve() } } };
  });
  return c;
}

/** エラーの値を「値 / cause」の 1 行にする（vitest はモックの読み込みの失敗を包むので、cause まで見る） */
const failureText = (e: unknown): string => {
  const cause = e instanceof Error ? e.cause : undefined;
  return cause === undefined ? describeError(e) : `${describeError(e)} / ${describeError(cause)}`;
};

interface Env {
  name: string;
  /** 環境を作る。戻り値はテストの最後に、その環境になっていたことを確かめる */
  setup: () => () => void;
}

/** 環境の制約（黙って音なし。onFailure を呼ばない。ZzFX を読み込みに行かない） */
const silentEnvs: Env[] = [
  {
    name: 'AudioContext がない（Windows の Playwright の WebKit と同じ）',
    setup: () => {
      expect('AudioContext' in globalThis, '前提: Node には AudioContext がない').toBe(false);
      const c = countZzfxLoads();
      return () => expect(c.loads, 'ZzFX（のチャンク）を読み込みに行かない').toBe(0);
    },
  },
  {
    name: 'webkitAudioContext だけがある（Safari 14.0 以前。ZzFX は接頭辞なしの AudioContext を使う）',
    setup: () => {
      const calls: AudioCalls = { created: 0, resumed: 0, played: 0 };
      vi.stubGlobal('webkitAudioContext', fakeAudioContextClass(calls, () => Promise.resolve()));
      expect('AudioContext' in globalThis).toBe(false);
      const c = countZzfxLoads();
      return () => {
        expect(c.loads, 'ZzFX（のチャンク）を読み込みに行かない').toBe(0);
        expect(calls.created).toBe(0);
      };
    },
  },
];

/** それ以外の失敗（音は諦めるが、onFailure に 1 回だけ渡す）。pattern は渡された失敗の文字列（failureText） */
const recordedEnvs: (Env & { pattern: RegExp })[] = [
  {
    name: 'ZzFX のチャンク（assets/zzfx-<hash>.js）が届かない',
    pattern: /Failed to fetch dynamically imported module: .*zzfx-/,
    setup: () => {
      stubWebAudio();
      vi.doMock('zzfx', () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/zzfx-0a1b2c3d.js');
      });
      return () => undefined;
    },
  },
  {
    name: 'AudioContext のコンストラクタが例外を投げる',
    pattern: /NotSupportedError: audio is not available/,
    setup: () => {
      const c = { attempts: 0 };
      vi.stubGlobal(
        'AudioContext',
        class ThrowingAudioContext {
          constructor() {
            c.attempts++;
            throw new Error('NotSupportedError: audio is not available');
          }
        },
      );
      return () => expect(c.attempts, 'ZzFX が AudioContext を作ろうとした').toBe(1);
    },
  },
  {
    name: 'resume() が拒否する',
    pattern: /NotAllowedError: resume refused/,
    setup: () => {
      const calls = stubWebAudio(() => Promise.reject(new Error('NotAllowedError: resume refused')));
      return () => expect(calls.resumed).toBe(1);
    },
  },
  {
    name: 'resume() が同期で例外を投げる',
    pattern: /InvalidStateError: closed/,
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
  vi.doUnmock('zzfx');
  vi.unstubAllGlobals();
});

/** unlockAudio を 3 回呼び、例外が出ず、Promise が拒否されず、未処理の拒否もないことを確かめる。onFailure に渡されたものを返す */
async function unlockThrice(sfx: Sfx): Promise<unknown[]> {
  const failures: unknown[] = [];
  const onFailure = (e: unknown): void => {
    failures.push(e);
  };
  let first: Promise<void> | undefined;
  expect(() => {
    first = sfx.unlockAudio(onFailure);
  }).not.toThrow();
  await expect(first).resolves.toBeUndefined();
  // 2 回目以降も例外なし・拒否なし（読み込みは再試行しない）
  expect(() => void sfx.unlockAudio(onFailure)).not.toThrow();
  await expect(sfx.unlockAudio(onFailure)).resolves.toBeUndefined();
  await settle();
  expect(rejections).toEqual([]);
  return failures;
}

describe('unlockAudio — AudioContext がない環境は黙って音を諦める（BL-102）', () => {
  for (const env of silentEnvs) {
    it(`${env.name}: 拒否も例外も未処理の拒否もなく、onFailure も呼ばない。以後の playHit・playBreak は何もしない`, async () => {
      const verify = env.setup();
      const sfx = await freshSfx();
      expect(await unlockThrice(sfx)).toEqual([]);
      verify();
      expect(() => {
        sfx.playHit(1_000);
        sfx.playHit(2_000, 1.2);
        sfx.playBreak();
      }).not.toThrow();
    });
  }

  it('AudioContext がないまま ZzFX を読み込むと拒否される（読み込みの前に確かめる理由）', async () => {
    vi.resetModules();
    await expect(import('zzfx')).rejects.toThrow(/AudioContext/);
  });
});

describe('unlockAudio — それ以外の失敗は音を諦めて onFailure に 1 回だけ渡す（errors() に残す。コードレビュー PR #8 の S-1）', () => {
  for (const env of recordedEnvs) {
    it(`${env.name}: 拒否も例外も未処理の拒否もなく、onFailure に 1 回。以後の playHit・playBreak は何もしない`, async () => {
      const verify = env.setup();
      const sfx = await freshSfx();
      const failures = await unlockThrice(sfx);
      expect(failures).toHaveLength(1);
      expect(failureText(failures[0])).toMatch(env.pattern);
      verify();
      expect(() => {
        sfx.playHit(1_000);
        sfx.playBreak();
      }).not.toThrow();
    });
  }

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

  it('onFailure を渡さなくても、onFailure が例外を投げても、拒否も未処理の拒否も出ない', async () => {
    stubWebAudio(() => Promise.reject(new Error('NotAllowedError')));
    let sfx = await freshSfx();
    await expect(sfx.unlockAudio()).resolves.toBeUndefined();
    stubWebAudio(() => Promise.reject(new Error('NotAllowedError')));
    sfx = await freshSfx();
    await expect(
      sfx.unlockAudio(() => {
        throw new Error('log failed');
      }),
    ).resolves.toBeUndefined();
    await settle();
    expect(rejections).toEqual([]);
  });
});

describe('unlockAudio — AudioContext がある環境（今までどおり。iOS 対策の「最初の入力で読み込んで resume」）', () => {
  it('読み込む前は鳴らない。unlock で ZzFX を読み込んで resume し、効果音が鳴る。何度呼んでも読み込みと resume は 1 回', async () => {
    const calls = stubWebAudio();
    const sfx = await freshSfx();
    const failures: unknown[] = [];
    const onFailure = (e: unknown): void => {
      failures.push(e);
    };
    sfx.playBreak();
    expect(calls.played, '読み込む前は何もしない').toBe(0);
    const p = sfx.unlockAudio(onFailure);
    expect(sfx.unlockAudio(onFailure), '読み込み中に呼んでも同じ Promise').toBe(p);
    await p;
    await sfx.unlockAudio(onFailure);
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
    expect(failures).toEqual([]);
    expect(rejections).toEqual([]);
  });
});

describe('音を諦めても掘る・購入が続く（main.ts と同じ結線: 最初の入力で unlockAudio(errorLog.push)、ストアの購読で playHit・playBreak）', () => {
  /** ツルハシ（3 コイン）の代金がたまる打撃の数は 29（Q-02）。余裕をみて 32 回叩く */
  const TAPS = 32;
  const cases = [...silentEnvs.map((env) => ({ env, recorded: 0 })), ...recordedEnvs.map((env) => ({ env, recorded: 1 }))];

  for (const { env, recorded } of cases) {
    it(`${env.name}: 打撃・ブロックの破壊・コインが増え、ツルハシを買える。errors() は ${recorded} 件、購読者の例外・未処理の拒否なし`, async () => {
      const verify = env.setup();
      const sfx = await freshSfx();
      const errorLog = createErrorLog();
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
          void sfx.unlockAudio((e) => errorLog.push(e));
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
        await sfx.unlockAudio(); // 読み込みの成否が確定するのを待つ（main.ts と同じ Promise）
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
        expect(errorLog.list(), 'errors() の件数').toHaveLength(recorded);
        expect(subscriberErrors).toEqual([]);
        expect(rejections).toEqual([]);
        verify();
      } finally {
        input.dispose();
      }
    });
  }
});
