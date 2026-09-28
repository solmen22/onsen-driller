// コンテンツ定義の整合の検査（arch §10）: ID の重複・参照切れ・順番・コストの単調性。テストと dev の起動で使う。
// 問題の一覧（文字列）を返す。空なら問題なし。i18n のキーの有無は i18n を import できない core の外（テスト）で確かめる
import { GUESTS } from '../content/guests.ts';
import { ORE_BY_ID, ORES } from '../content/ores.ts';
import { SPRING_BY_ID, SPRINGS } from '../content/springs.ts';
import { STRATA } from '../content/strata.ts';
import { TOOLS } from '../content/tools.ts';

const dupes = (ids: readonly string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);

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
  // 源泉: 深さが増え、コストの初期値も増える。お客さんの条件の源泉が存在する
  SPRINGS.forEach((s, i) => {
    const prev = SPRINGS[i - 1];
    if (prev && !(s.depth > prev.depth && s.pumpC0 > prev.pumpC0)) p.push(`springs: ${s.id} の深さかコストが前より大きくない`);
  });
  for (const d of dupes(SPRINGS.map((s) => s.id))) p.push(`springs: id ${d} が重複`);
  for (const g of GUESTS) {
    const c = g.condition;
    if (c.kind === 'slottedLevel' && !Object.hasOwn(SPRING_BY_ID, c.spring)) p.push(`guests: ${g.id} の条件の源泉 ${c.spring} がない`);
    const e = g.effect;
    if (e.kind === 'springIncome' && !Object.hasOwn(SPRING_BY_ID, e.spring)) p.push(`guests: ${g.id} の効果の源泉 ${e.spring} がない`);
  }
  return p;
}
