// 読み取り専用のセッション（新しい版のセーブ）の扱い（Q-26 ②③。BL-046）。main.ts から 1 か所ずつ使う
// - saveDisplay: UI に見せる保存の状態。読み取り専用なら readonly を最優先（readonly → unavailable → failing → ok）。
//   起動時の setSaveStatus と autosave の onStatus の両方で使う（autosave が failing・ok を通知しても readonly のまま）
// - persistSettings: 設定（onsen-driller:settings）を書く唯一の口。読み取り専用の間は書かない（メモリの設定だけ変える。TS-E5-13）。
//   言語の切り替え（onLangChange）と S3 の設定の画面（BL-045）はこれを通す
import type { KeyValueStore } from '../platform/types.ts';
import type { SaveStatus } from '../save/slots.ts';
import { saveSettings, type Settings } from './settings.ts';
import type { SaveDisplayStatus } from './store.ts';

export function saveDisplay(st: SaveStatus, readOnly: boolean): SaveDisplayStatus {
  return readOnly ? 'readonly' : st;
}

/** 設定を書く関数を作る（読み取り専用の間は何もしない）。書いたら true */
export function makePersistSettings(storage: KeyValueStore, settings: Settings, isReadOnly: () => boolean): () => boolean {
  return () => (isReadOnly() ? false : saveSettings(storage, settings));
}
