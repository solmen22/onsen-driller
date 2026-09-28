// 設定（arch §6-1・§11。BL-027）: セーブとは別のキー onsen-driller:settings。「初めから」でも消えない。壊れていたら初期値
import type { KeyValueStore } from '../platform/types.ts';
import { safeJsonParse } from '../save/codec.ts';

export const SETTINGS_KEY = 'onsen-driller:settings';

export interface Settings {
  /** 言語（auto は platform.locale → navigator.language → 英語。arch §13） */
  lang: 'auto' | 'en' | 'ja';
  sfx: boolean;
  ambience: boolean;
  /** 数値の表記（S2 の BL-011） */
  notation: 'auto' | 'exp';
  /** 動きを減らす（auto は OS の prefers-reduced-motion。S3 の BL-037） */
  reduceMotion: 'auto' | 'on' | 'off';
  /** 画質（S3 の quality.ts） */
  quality: 'auto' | 'high' | 'low';
  /** 録画モード（UI を隠し、保存しない。S4 の BL-048） */
  recordingMode: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  lang: 'auto',
  sfx: true,
  ambience: true,
  notation: 'auto',
  reduceMotion: 'auto',
  quality: 'auto',
  recordingMode: false,
};

const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);

/** 信頼しない値 → 設定（知らない値・欠けた値は初期値） */
export function normalizeSettings(v: unknown): Settings {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    lang: oneOf(o.lang, ['auto', 'en', 'ja'], d.lang),
    sfx: bool(o.sfx, d.sfx),
    ambience: bool(o.ambience, d.ambience),
    notation: oneOf(o.notation, ['auto', 'exp'], d.notation),
    reduceMotion: oneOf(o.reduceMotion, ['auto', 'on', 'off'], d.reduceMotion),
    quality: oneOf(o.quality, ['auto', 'high', 'low'], d.quality),
    recordingMode: bool(o.recordingMode, d.recordingMode),
  };
}

/** 読む（なければ・壊れていれば初期値。例外を投げない） */
export function loadSettings(storage: KeyValueStore): Settings {
  try {
    const raw = storage.get(SETTINGS_KEY);
    if (raw === null || raw.length > 10_000) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(safeJsonParse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 書く（失敗しても例外を投げず false） */
export function saveSettings(storage: KeyValueStore, s: Settings): boolean {
  try {
    return storage.set(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
  } catch {
    return false;
  }
}
