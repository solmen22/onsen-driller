// 保存まわりの補助（e2e_E5_save-resume.md・e2e_E9_no-storage.md）
//
// - readSlots: 2 枠（onsen-driller:save:a / :b）の封筒 {schema, seq, savedAt, appVersion, checksum, game} を読む
// - reopenWithStorage: context.storageState() を取り、localStorage を書き換えて新しい context で開き直す。
//   同じページの再読み込みで試すと pagehide の保存が壊した枠を上書きしてしまうので、壊れた枠の試験は必ずこの方法で行う
// - injectStorageFault: 保存できない環境 V1〜V5 を context.addInitScript でページのスクリプトより先に入れる
import type { BrowserContext, Page } from '@playwright/test';
import type { Harness } from './fixtures.ts';
import type { SerializedState } from './hooks.ts';
import { STORAGE_PREFIX } from './privacy.ts';

export const SLOT_KEYS = { a: `${STORAGE_PREFIX}save:a`, b: `${STORAGE_PREFIX}save:b` } as const;
export type SlotName = keyof typeof SLOT_KEYS;

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

/** storageState の localStorage を書き換えて、新しい context・ページで開き直す（見張り付き） */
export async function reopenWithStorage(
  harness: Harness,
  from: BrowserContext,
  mutate: (ls: Map<string, string>) => void,
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
  const page = await context.newPage();
  return { context, page };
}

/** 保存できない環境の型（e2e_E9_no-storage.md「保存できない状態の作り方」） */
export type StorageFault = 'V1' | 'V2' | 'V3' | 'V4' | 'V5';

export const STORAGE_FAULTS: Record<StorageFault, string> = {
  V1: 'localStorage の参照で SecurityError（Safari のサードパーティ iframe・サイトデータのブロック）',
  V2: 'setItem が QuotaExceededError、getItem は null（容量超過・古い Safari のプライベートモード）',
  V3: 'getItem・setItem・removeItem・key がすべて例外（ストレージ API が壊れている）',
  V4: 'setItem は黙って成功し、getItem は常に null（書き込みが捨てられる）',
  V5: 'セーブのキーへの setItem が 2 回まで成功し、3 回目から QuotaExceededError（遊んでいる途中で容量がいっぱい）',
};

/** ページの中で動く。V5 は「onsen-driller:save: で始まるキー」への書き込みを数える（起動時の書き込みの確認などは数えない） */
function faultScript(v: StorageFault): void {
  const P = Storage.prototype;
  const quota = (): DOMException => new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  if (v === 'V1') {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  } else if (v === 'V2') {
    P.setItem = function () {
      throw quota();
    };
    P.getItem = function () {
      return null;
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
