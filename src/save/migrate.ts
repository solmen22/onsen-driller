// セーブの版の移行（arch §11: 形を変えたら SAVE_SCHEMA_VERSION を上げ、ここに移行を足す）。
// - 入力は信頼しない保存の形の game（parseGame が run・meta がオブジェクトであることを確かめた後に呼ぶ）。入力は書き換えず、新しいオブジェクトを返す
// - game.schema が今の版より古ければ、1 版ずつ順に移す。schema がない・読めないものは 1 とみなす（S1〜S3 の v1 のセーブ）
// - 移行で足す値は「その版を知らないセーブにとって、いちばん自然な値」にする。値の検証・補正は移行の後の parseGame の仕事
// - 新しい版（今の版より大きい）はここに来ない（codec が先に newer にする）
import { SAVE_SCHEMA_VERSION, toStr, ZERO } from '../core/index.ts';

type Rec = Record<string, unknown>;
const isRecord = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** game.schema（1 以上の整数・数字だけの文字列）を読む。読めなければ null */
export function readGameSchema(game: Rec): number | null {
  const x = game.schema;
  const n = typeof x === 'string' && /^\d{1,9}$/.test(x) ? Number(x) : x;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** game.schema。読めなければ 1（S1〜S3 の v1 とみなす。parseGame はこのとき補正の記録に schema を足す。PR #75 のレビュー N-4） */
export const gameSchemaOf = (game: Rec): number => readGameSchema(game) ?? 1;

/**
 * v1 → v2（BL-021・BL-022）: meta.lastPrestigeGain（前回の転生で得た湯の華）と run.startDepth（近道の坑道の始めの深さ）を足す。
 * v1 はどちらも持たないので 0（＝2 周目以降の転生の推奨は最低値の 30 から。1.5 倍の基準は次の転生から効く。v1 に近道はない）。
 * 版 2 は公開前なので、BL-022 の欄も版 2 に入れる（公開した版の形は変えない。arch §11 の版の履歴）
 */
function v1ToV2(game: Rec): Rec {
  const meta = isRecord(game.meta) ? game.meta : {};
  const run = isRecord(game.run) ? game.run : {};
  return { ...game, schema: 2, run: { ...run, startDepth: 0 }, meta: { ...meta, lastPrestigeGain: toStr(ZERO) } };
}

const STEPS: Readonly<Record<number, (g: Rec) => Rec>> = { 1: v1ToV2 };

/** 古い版の game を今の版の形に移す（今の版ならそのまま返す） */
export function migrateGame(game: Rec): Rec {
  let g = game;
  for (let from = gameSchemaOf(game); from < SAVE_SCHEMA_VERSION; from++) {
    const stepFn = STEPS[from];
    if (!stepFn) break;
    g = stepFn(g);
  }
  return g;
}
