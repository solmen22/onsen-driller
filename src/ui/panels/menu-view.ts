// T5「≡」の表示の中身（gdd §11-2。BL-045）。純粋な関数
// - エラー情報: 版・ビルド種別・ブラウザ（userAgent）・時刻・直近のエラー 20 件（app/errors.ts）を 1 つの文字列にする。
//   サーバーがないので、不具合の報告に貼ってもらう（gdd §11-2 [24][25]）。送信はしない（外部通信 0 のまま）
// - 設定の選択肢の巡回（押すたびに次へ）
import type { Settings } from '../../app/settings.ts';

export interface ErrorReportInput {
  version: string;
  target: string;
  userAgent: string;
  /** 時刻（ISO 8601） */
  time: string;
  errors: readonly string[];
}

export function errorReport(x: ErrorReportInput): string {
  const lines = [`Onsen Driller ${x.version} (${x.target})`, `UA: ${x.userAgent}`, `Time: ${x.time}`, `Errors: ${x.errors.length}`];
  x.errors.forEach((e, i) => lines.push(`${i + 1}. ${e}`));
  return lines.join('\n');
}

const NEXT_NOTATION: Record<Settings['notation'], Settings['notation']> = { auto: 'exp', exp: 'auto' };
const NEXT_MOTION: Record<Settings['reduceMotion'], Settings['reduceMotion']> = { auto: 'on', on: 'off', off: 'auto' };

export const nextNotation = (v: Settings['notation']): Settings['notation'] => NEXT_NOTATION[v];
export const nextMotion = (v: Settings['reduceMotion']): Settings['reduceMotion'] => NEXT_MOTION[v];

/** クレジットの行（素材・ライブラリ・フォントのライセンス。ASSETS.md・package.json の dependencies と合わせる） */
export const CREDIT_LIBS: readonly { name: string; license: string }[] = [
  { name: 'Phaser', license: 'MIT' },
  { name: 'Preact', license: 'MIT' },
  { name: 'break_infinity.js', license: 'MIT' },
  { name: 'lz-string', license: 'MIT' },
  { name: 'Valibot', license: 'MIT' },
  { name: 'ZzFX', license: 'MIT' },
];
