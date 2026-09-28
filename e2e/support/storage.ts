// 保存まわりの補助（e2e_E5_save-resume.md・e2e_E9_no-storage.md）
//
// - readSlots: 2 枠（onsen-driller:save:a / :b）の封筒 {schema, seq, savedAt, appVersion, checksum, game} を読む
// - reopenWithStorage: context.storageState() を取り、localStorage を書き換えて新しい context で開き直す。
//   同じページの再読み込みで試すと pagehide の保存が壊した枠を上書きしてしまうので、壊れた枠の試験は必ずこの方法で行う
// - injectStorageFault: 保存できない環境 V1〜V7 を context.addInitScript でページのスクリプトより先に入れる
import type { BrowserContext, Page } from '@playwright/test';
import type { Harness } from './fixtures.ts';
import type { SerializedState } from './hooks.ts';
import { STORAGE_PREFIX } from './privacy.ts';

export const SLOT_KEYS = { a: `${STORAGE_PREFIX}save:a`, b: `${STORAGE_PREFIX}save:b` } as const;
export type SlotName = keyof typeof SLOT_KEYS;
/** 両方の枠が壊れていたときに、壊れた生の文字列を 1 つだけ退避するキー（Q-11 の 4・arch §11「2 枠の規則」の 4） */
export const BROKEN_SLOT_KEY = `${STORAGE_PREFIX}save:broken`;

export interface SlotEnvelope {
  schema: number;
  seq: number;
  savedAt: number;
  appVersion: string;
  checksum: string;
  /** 封筒の game（文字列で入っていれば JSON として読んだもの） */
  game: SerializedState;
}

export interface SlotRead {
  raw: string | null;
  env: SlotEnvelope | null;
}

export type Slots = Record<SlotName, SlotRead>;

function parseSlot(raw: string | null): SlotRead {
  if (raw === null) return { raw, env: null };
  try {
    const o = JSON.parse(raw) as Omit<SlotEnvelope, 'game'> & { game: unknown };
    const game = (typeof o.game === 'string' ? JSON.parse(o.game) : o.game) as SerializedState;
    return { raw, env: { ...o, game } };
  } catch {
    return { raw, env: null };
  }
}

/** context の localStorage（オリジンごと）をキー → 値で読む */
export async function readLocalStorage(context: BrowserContext, origin: string): Promise<Map<string, string>> {
  const st = await context.storageState();
  const o = st.origins.find((x) => x.origin === origin);
  return new Map((o?.localStorage ?? []).map((e) => [e.name, e.value]));
}

export async function readSlots(context: BrowserContext, origin: string): Promise<Slots> {
  const ls = await readLocalStorage(context, origin);
  return { a: parseSlot(ls.get(SLOT_KEYS.a) ?? null), b: parseSlot(ls.get(SLOT_KEYS.b) ?? null) };
}

/** 2 枠のうち seq の大きいほう（新しいほう）と小さいほう */
export function newerOlder(s: Slots): { newer: SlotName; older: SlotName } {
  const sa = s.a.env?.seq ?? -1;
  const sb = s.b.env?.seq ?? -1;
  return sa >= sb ? { newer: 'a', older: 'b' } : { newer: 'b', older: 'a' };
}

/** 前の保存からの変化: 書き換わった枠 */
export function writtenSlots(before: Slots, after: Slots): SlotName[] {
  return (['a', 'b'] as const).filter((k) => before[k].raw !== after[k].raw);
}

/** セーブの枠のキーの接頭辞（`onsen-driller:save:a`・`:b`・`:broken`） */
export const SAVE_KEY_PREFIX = `${STORAGE_PREFIX}save:`;

/** localStorage のうちセーブの枠のキー（`onsen-driller:save:` で始まるもの）を、キーの順に並べる */
export const saveKeysOf = (ls: Map<string, string>): string[] => [...ls.keys()].filter((k) => k.startsWith(SAVE_KEY_PREFIX)).sort();

/**
 * storageState の localStorage を書き換えて、新しい context・ページで開き直す（見張り付き）。
 * beforePage は新しい context にページを開く前に呼ぶ（保存できない環境の初期化スクリプトを入れるときなど）
 */
export async function reopenWithStorage(
  harness: Harness,
  from: BrowserContext,
  mutate: (ls: Map<string, string>) => void,
  beforePage?: (context: BrowserContext) => Promise<void>,
): Promise<{ context: BrowserContext; page: Page }> {
  const st = await from.storageState();
  let o = st.origins.find((x) => x.origin === harness.origin);
  if (!o) {
    o = { origin: harness.origin, localStorage: [] };
    st.origins.push(o);
  }
  const map = new Map(o.localStorage.map((e) => [e.name, e.value]));
  mutate(map);
  o.localStorage = [...map].map(([name, value]) => ({ name, value }));
  const context = await harness.newContext({ storageState: st });
  if (beforePage) await beforePage(context);
  const page = await context.newPage();
  return { context, page };
}

/** 保存できない環境の型（e2e_E9_no-storage.md「保存できない状態の作り方」） */
export type StorageFault = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7';

export const STORAGE_FAULTS: Record<StorageFault, string> = {
  V1: 'localStorage の参照で SecurityError（Safari のサードパーティ iframe・サイトデータのブロック）',
  V2: 'setItem が QuotaExceededError、getItem は null（容量超過・古い Safari のプライベートモード）',
  V3: 'getItem・setItem・removeItem・key がすべて例外（ストレージ API が壊れている）',
  V4: 'setItem は黙って成功し、getItem は常に null（書き込みが捨てられる）',
  V5: 'セーブのキーへの setItem が 2 回まで成功し、3 回目から QuotaExceededError（遊んでいる途中で容量がいっぱい）',
  V6: '既存のセーブがあり、window.__quotaFull !== false の間はどのキーの setItem も QuotaExceededError（getItem・removeItem は本物。S-2）',
  V7: '既存のセーブがあり、window.__readFail !== false の間は onsen-driller:save: のキーの getItem だけが例外（setItem・removeItem は本物。S-1）',
};

/**
 * 保存できない環境で、状態（保存の状態 `save-warning` の data-state）がどうなるか（traceability §5-2 の Q-21・Q-23・Q-25 の回答）。
 * 規則は「読めるなら localStorage、読めなければメモリ」: 参照・試し書きの読み出しが例外（V1・V3）と、読めない枠がある（V7）は
 * 起動直後から unavailable（再試行しない）。試し書きの書き込みが失敗・読み戻しが合わない（V2・V4・V6）は起動直後から failing
 * （15 秒ごとに再試行し、成功したら ok）。V5 は ok で始まり、保存が失敗した時点で failing
 */
export const STARTUP_SAVE_STATUS: Record<StorageFault, 'ok' | 'failing' | 'unavailable'> = {
  V1: 'unavailable',
  V2: 'failing',
  V3: 'unavailable',
  V4: 'failing',
  V5: 'ok',
  V6: 'failing',
  V7: 'unavailable',
};

/**
 * ページの中で動く。
 * - V2 は setItem の呼び出しをキーごとに window.__setItemCalls に数える（TS-E9-07: 15 秒ごとの再試行の回数）
 * - V5 は「onsen-driller:save: で始まるキー」への書き込みを数える（起動時の試し書き onsen-driller:__probe は数えない。Q-21 の注意）
 */
function faultScript(v: StorageFault): void {
  const P = Storage.prototype;
  const w = window as unknown as { __setItemCalls?: Record<string, number>; __quotaFull?: boolean; __readFail?: boolean };
  const quota = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  if (v === 'V1') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  } else if (v === 'V2') {
    const calls: Record<string, number> = {};
    w.__setItemCalls = calls;
    P.setItem = function (k: string) {
      calls[String(k)] = (calls[String(k)] ?? 0) + 1;
      throw quota();
    };
    P.getItem = function () {
      return null;
    };
  } else if (v === 'V6') {
    const orig = Object.getOwnPropertyDescriptor(P, 'setItem')?.value as (this: Storage, k: string, v: string) => void;
    P.setItem = function (this: Storage, k: string, val: string) {
      if (w.__quotaFull !== false) throw quota();
      return orig.call(this, k, val);
    };
  } else if (v === 'V7') {
    const orig = Object.getOwnPropertyDescriptor(P, 'getItem')?.value as (this: Storage, k: string) => string | null;
    P.getItem = function (this: Storage, k: string) {
      if (w.__readFail !== false && String(k).startsWith('onsen-driller:save:')) throw new DOMException('read failed', 'UnknownError');
      return orig.call(this, k);
    };
  } else if (v === 'V3') {
    const broken = (): never => {
      throw new DOMException('Storage is broken.', 'UnknownError');
    };
    P.getItem = broken;
    P.setItem = broken;
    P.removeItem = broken;
    P.key = broken;
  } else if (v === 'V4') {
    P.setItem = function () {};
    P.getItem = function () {
      return null;
    };
  } else {
    const orig = Object.getOwnPropertyDescriptor(P, 'setItem')?.value as (this: Storage, k: string, v: string) => void;
    let saves = 0;
    let full = false;
    P.setItem = function (this: Storage, k: string, val: string) {
      if (full) throw quota();
      if (String(k).startsWith('onsen-driller:save:')) {
        saves++;
        if (saves > 2) {
          full = true;
          throw quota();
        }
      }
      return orig.call(this, k, val);
    };
  }
}

export async function injectStorageFault(context: BrowserContext, v: StorageFault): Promise<void> {
  await context.addInitScript(faultScript, v);
}

/** V2: セーブの枠のキー（onsen-driller:save:）への setItem の呼び出しの合計（window.__setItemCalls） */
export async function saveSetItemCalls(page: Page): Promise<number> {
  return page.evaluate((prefix) => {
    const c = (window as unknown as { __setItemCalls?: Record<string, number> }).__setItemCalls ?? {};
    return Object.entries(c)
      .filter(([k]) => k.startsWith(prefix))
      .reduce((n, [, v]) => n + v, 0);
  }, SAVE_KEY_PREFIX);
}
