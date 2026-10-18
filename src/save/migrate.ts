// セーブの版の移行（arch §11: 形を変えたら SAVE_SCHEMA_VERSION を上げ、ここに移行を足す）。
// - 入力は信頼しない保存の形の game（parseGame が run・meta がオブジェクトであることを確かめた後に呼ぶ）。入力は書き換えず、新しいオブジェクトを返す
// - game.schema が今の版より古ければ、1 版ずつ順に移す。schema がない・読めないものは 1 とみなす（S1〜S3 の v1 のセーブ）
// - 移行で足す値は「その版を知らないセーブにとって、いちばん自然な値」にする。値の検証・補正は移行の後の parseGame の仕事
// - 新しい版（今の版より大きい）はここに来ない（codec が先に newer にする）
import { SAVE_SCHEMA_VERSION, toStr, ZERO } from '../core/index.ts';

type Rec = Record<string, unknown>;
const isRecord = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** game.schema（整数・数値の文字列）。読めなければ 1 */
export function gameSchemaOf(game: Rec): number {
  const x = game.schema;
  const n = typeof x === 'string' && /^\d{1,9}$/.test(x) ? Number(x) : x;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

/**
 * v1 → v2（BL-021）: meta.lastPrestigeGain（前回の転生で得た湯の華）を足す。v1 は記録していないので 0
 * （＝2 周目以降の転生の推奨は最低値の 30 から。1.5 倍の基準は次の転生から効く）
 */
function v1ToV2(game: Rec): Rec {
  const meta = isRecord(game.meta) ? game.meta : {};
  return { ...game, schema: 2, meta: { ...meta, lastPrestigeGain: toStr(ZERO) } };
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
