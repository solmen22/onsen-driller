// コンテンツ定義の整合の検査（arch §10）: ID の重複・参照切れ・順番・コストの単調性。テスト（tests/unit/strata-ores.test.ts）で使う
// （dev の起動での検査は main.ts に足していない。定義を変えると unit テストが落ちるので、それで代える。レビュー N-9）。
// 問題の一覧（文字列）を返す。空なら問題なし。i18n のキーの有無は i18n を import できない core の外（テスト）で確かめる
import type { Effect } from '../content/effects.ts';
import { GUESTS } from '../content/guests.ts';
import { PARAMS } from '../content/params.ts';
import { ORE_BY_ID, ORES } from '../content/ores.ts';
import { SPRING_BY_ID, SPRINGS } from '../content/springs.ts';
import { STRATA } from '../content/strata.ts';
import { TOOLS } from '../content/tools.ts';

const dupes = (ids: readonly string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);

/**
 * 効果（content/effects.ts）1 つの検査: 倍率は有限の正の数、足し算は有限の数、源泉ごとの効果の源泉が存在する（BL-016）。
 * owner は問題の文の頭（例 "springs: simple"）。改良（BL-018）の定義の検査でも使う
 */
export function effectProblems(owner: string, e: Effect): string[] {
  const p: string[] = [];
  if ('mult' in e && !(Number.isFinite(e.mult) && e.mult > 0)) p.push(`${owner} の効果 ${e.kind} の倍率が正の有限の数でない`);
  if ('add' in e && !Number.isFinite(e.add)) p.push(`${owner} の効果 ${e.kind} の値が有限の数でない`);
  if (e.kind === 'springIncome' && !Object.hasOwn(SPRING_BY_ID, e.spring)) p.push(`${owner} の効果の源泉 ${e.spring} がない`);
  return p;
}

export function contentProblems(): string[] {
  const p: string[] = [];
  // 地層: 0m から始まり、開始の深さが増えていく。帯ごとに 2 種の鉱石
  if (STRATA[0]?.start !== 0) p.push('strata: 最初の帯は 0m から');
  STRATA.forEach((b, i) => {
    const prev = STRATA[i - 1];
    if (prev && !(b.start > prev.start)) p.push(`strata: ${b.id} の開始の深さが前の帯より深くない`);
    b.ores.forEach((o, k) => {
      const def = ORE_BY_ID[o] as (typeof ORE_BY_ID)[typeof o] | undefined;
      if (!def) p.push(`strata: ${b.id} の鉱石 ${o} がない`);
      else if (def.band !== i) p.push(`strata: ${b.id} の鉱石 ${o} の帯が ${def.band}（${i} のはず）`);
      else if (k === 0 && !(def.weight > 0 && def.weight < 1)) p.push(`ores: ${o} の割合が 0〜1 でない`);
    });
    const [a, c] = b.ores.map((o) => ORE_BY_ID[o]?.weight ?? 0);
    if (Math.abs((a ?? 0) + (c ?? 0) - 1) > 1e-9) p.push(`ores: ${b.id} の 2 種の割合の合計が 1 でない`);
  });
  for (const d of dupes(STRATA.map((b) => b.id))) p.push(`strata: id ${d} が重複`);
  // 鉱石: 12 種、ID の重複なし、どれかの帯に属する
  for (const d of dupes(ORES.map((o) => o.id))) p.push(`ores: id ${d} が重複`);
  for (const o of ORES) if (!STRATA[o.band]?.ores.includes(o.id)) p.push(`ores: ${o.id} が帯 ${o.band} の鉱石にない`);
  // 道具: 解放の深さは減らず、コストは増える
  TOOLS.forEach((t, i) => {
    const prev = TOOLS[i - 1];
    if (!prev) return;
    if (t.unlockDepth < prev.unlockDepth) p.push(`tools: ${t.id} の解放の深さが前より浅い`);
    if (!(t.cost > prev.cost)) p.push(`tools: ${t.id} のコストが前より高くない`);
    if (!(t.mult > 1)) p.push(`tools: ${t.id} の倍率が 1 以下`);
  });
  for (const d of dupes(TOOLS.map((t) => t.id))) p.push(`tools: id ${d} が重複`);
  // 源泉: 深さ・コストの初期値・基本湧出が前より大きい。コストは Lv に対して単調に増える（r > 1）。名前のキーは spring.<id>（BL-015）
  SPRINGS.forEach((s, i) => {
    const prev = SPRINGS[i - 1];
    if (prev && !(s.depth > prev.depth && s.pumpC0 > prev.pumpC0)) p.push(`springs: ${s.id} の深さかコストが前より大きくない`);
    if (prev && !(s.flow > prev.flow)) p.push(`springs: ${s.id} の基本湧出が前より大きくない`);
    if (!(s.pumpC0 > 0 && s.pumpR > 1 && s.flow > 0)) p.push(`springs: ${s.id} のコスト・成長率・基本湧出が正でない（成長率は 1 より大きい）`);
    if (!(s.depth > 0 && Number.isInteger(s.depth))) p.push(`springs: ${s.id} の深さが正の整数でない`);
    if (s.nameKey !== `spring.${s.id}`) p.push(`springs: ${s.id} の名前のキーが spring.${s.id} でない`);
    p.push(...effectProblems(`springs: ${s.id}`, s.effect));
  });
  for (const d of dupes(SPRINGS.map((s) => s.id))) p.push(`springs: id ${d} が重複`);
  // ポンプのマイルストーン（Lv10・25・50・100）は 1 より大きく、増えていく
  PARAMS.pumpMilestones.forEach((lv, i) => {
    const prev = PARAMS.pumpMilestones[i - 1];
    if (!(lv > 1 && (prev === undefined || lv > prev))) p.push(`params: pumpMilestones の ${lv} が前より大きくない`);
  });
  for (const g of GUESTS) {
    const c = g.condition;
    if (c.kind === 'slottedLevel' && !Object.hasOwn(SPRING_BY_ID, c.spring)) p.push(`guests: ${g.id} の条件の源泉 ${c.spring} がない`);
    p.push(...effectProblems(`guests: ${g.id}`, g.effect));
  }
  // 湯船の枠: Lv0 で 1 枠から、枠が増える Lv は増えていく（BL-016）。オフライン効率の基本は 0〜上限
  const at = PARAMS.bath.slotsAtLevel;
  if (at[0] !== 0) p.push('params: bath.slotsAtLevel は Lv0（1 枠目）から');
  at.forEach((lv, i) => {
    const prev = at[i - 1];
    if (prev !== undefined && !(lv > prev)) p.push(`params: bath.slotsAtLevel の ${lv} が前より大きくない`);
  });
  if (!(PARAMS.bath.c0 > 0 && PARAMS.bath.r > 1 && PARAMS.bath.bonusPerLv > 0)) p.push('params: bath のコスト・成長率・倍率が正でない');
  if (!(PARAMS.offline.eff > 0 && PARAMS.offline.eff <= PARAMS.offline.maxEff)) p.push('params: offline.eff が 0〜maxEff にない');
  return p;
}
