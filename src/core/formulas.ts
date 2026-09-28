// 式と派生値（gdd §5・§7-1）。状態を読むだけで、書き換えない
import { PARAMS } from '../content/params.ts';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import { GUEST_BY_ID, GUESTS, type GuestDef, type GuestId } from '../content/guests.ts';
import { TOOLS, type ToolDef } from '../content/tools.ts';
import { ORE_BY_ID, type OreId } from '../content/ores.ts';
import { STRATA } from '../content/strata.ts';
import { add, mul, num, ONE, pow, sumGeometric, type Num } from './num.ts';
import { hash01, hash01Kind } from './rng.ts';
import type { GameState } from './state.ts';

const B = PARAMS.block;

/** 地層の帯の境目（gdd §5-1。content/strata.ts の start） */
export const BAND_STARTS: readonly number[] = STRATA.map((b) => b.start);

/** 深さの帯（0 始まり。30m は帯 2＝1。開始の深さを含む） */
export function bandOfDepth(depth: number): number {
  let band = 0;
  for (let i = 0; i < STRATA.length; i++) if (depth >= (STRATA[i]?.start ?? 0)) band = i;
  return band;
}

export function slotted(s: GameState): SpringId[] {
  const out: SpringId[] = [];
  for (const id of s.run.bath.slots) if (id !== null) out.push(id);
  return out;
}

export const isSlotted = (s: GameState, id: SpringId): boolean => s.run.bath.slots.includes(id);

export function guestConditionMet(s: GameState, g: GuestDef): boolean {
  const c = g.condition;
  switch (c.kind) {
    case 'anySlotted':
      return slotted(s).length > 0;
    case 'slottedLevel':
      return isSlotted(s, c.spring) && (s.run.springs[c.spring]?.pump ?? 0) >= c.level;
    case 'allSlotsDistinct': {
      const ids = slotted(s);
      return s.run.bath.slots.length >= c.slots && ids.length >= c.slots && new Set(ids).size === ids.length;
    }
  }
}

export const computeGuests = (s: GameState): GuestId[] => GUESTS.filter((g) => guestConditionMet(s, g)).map((g) => g.id);

/** 枠の源泉とお客さんから決まる倍率を 1 回の走査でまとめて求める（step ごとに呼ぶので配列を作らない） */
export interface Modifiers {
  incomeAll: number;
  drillPower: number;
  oreValue: number;
  hardness: number;
  autoDig: number;
  digCoins: number;
  /** お客さんによる源泉ごとの倍率（カピバラ → 塩化物泉 ×2） */
  saltMult: number;
}

export function modifiers(s: GameState): Modifiers {
  const m: Modifiers = { incomeAll: 1, drillPower: 1, oreValue: 1, hardness: 1, autoDig: 1, digCoins: 1, saltMult: 1 };
  for (const id of s.run.bath.slots) {
    if (id === null) continue;
    const e = SPRING_BY_ID[id].effect;
    if (e.kind === 'incomeAll') m.incomeAll *= e.mult;
    else if (e.kind === 'drillPower') m.drillPower *= e.mult;
    else if (e.kind === 'oreValue') m.oreValue *= e.mult;
    else if (e.kind === 'hardness') m.hardness *= e.mult;
  }
  for (const gid of s.run.guests) {
    const e = GUEST_BY_ID[gid].effect;
    if (e.kind === 'incomeAll') m.incomeAll *= e.mult;
    else if (e.kind === 'drillPower') m.drillPower *= e.mult;
    else if (e.kind === 'autoDig') m.autoDig *= e.mult;
    else if (e.kind === 'digCoins') m.digCoins *= e.mult;
    else if (e.kind === 'springIncome' && e.spring === 'salt') m.saltMult *= e.mult;
  }
  return m;
}

/** 累計の湯の華 1 つにつき全生産 +2%（gdd §5-8） */
export const yunohanaMult = (s: GameState): Num => add(ONE, mul(s.meta.yunohana.lifetime, PARAMS.prestige.bonusPerYunohana));

/** ブロックの HP: h₀ × g_h^d × 地形・効果の倍率 */
export const blockHp = (s: GameState, depth: number, m: Modifiers = modifiers(s)): Num => mul(pow(B.gh, depth), B.h0 * m.hardness);

/**
 * 鉱石の配置は「周回のシード × 深さ」のハッシュ（打つ順番・刻み幅・オフラインで変わらない）。
 * 深さ 0〜4m（最初の 5 ブロック）は鉱石にしない（最初の強化までの時間をシードによらず一定にする。Q-02）
 */
export const isOre = (s: Readonly<GameState>, depth: number): boolean => depth >= B.oreFreeDepth && hash01(s.run.seed, depth) < B.oreChance;

/** 帯の 1 種目を選ぶ割合（Q-07。content/ores.ts の weight） */
const firstOreShare = (band: number): number => ORE_BY_ID[STRATA[band]?.ores[0] ?? 'quartz'].weight;

/**
 * 深さ depth のブロックの鉱石（鉱石でなければ null）。種類は hash32(seed ^ 0x6f726573, depth) / 2^32 が
 * 帯の 1 種目の割合（0.7）未満なら 1 種目、そうでなければ 2 種目（Q-07）。打つ順番・刻み幅・オフラインで変わらない
 */
export function oreAt(s: Readonly<GameState>, depth: number): OreId | null {
  if (!isOre(s, depth)) return null;
  const band = bandOfDepth(depth);
  const ores = STRATA[band]?.ores;
  if (!ores) return null;
  return hash01Kind(s.run.seed, depth) < firstOreShare(band) ? ores[0] : ores[1];
}

/** 地温（表示用。℃ の整数）: content/params.ts の折れ線（深さ m → ℃）。間は直線、最後の点より深いところは 1m あたり tempSlopeAfter（gdd §5-1） */
export function temperatureAt(depth: number): number {
  const c = PARAMS.tempCurve;
  const first = c[0];
  const last = c[c.length - 1];
  if (!first || !last) return 0;
  const d = Number.isFinite(depth) && depth > 0 ? depth : 0;
  if (d <= first[0]) return Math.round(first[1]);
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1];
    const b = c[i];
    if (a && b && d <= b[0]) return Math.round(a[1] + ((b[1] - a[1]) * (d - a[0])) / (b[0] - a[0]));
  }
  return Math.round(last[1] + (d - last[0]) * PARAMS.tempSlopeAfter);
}

/** ブロックの価値: v₀ × g_v^d（鉱石は ×8 × 泉質の倍率）× 掘削コインの倍率 */
export function blockValue(s: GameState, depth: number, ore: boolean, m: Modifiers = modifiers(s)): Num {
  const k = (ore ? B.oreMult * m.oreValue : 1) * m.digCoins;
  return mul(pow(B.gv, depth), B.v0 * k);
}

export function toolMult(tool: number): number {
  let m = 1;
  for (let i = 1; i <= tool; i++) m *= TOOLS[i]?.mult ?? 1;
  return m;
}

/** 25 レベルごとに ×2 */
const milestone = (level: number, every: number): Num => pow(2, Math.floor(level / every));

/** ドリル威力: (1＋Lv) × 2^floor(Lv/25) × 道具の倍率 × その他の倍率（gdd §5-3） */
export function drillPower(s: GameState, m: Modifiers = modifiers(s)): Num {
  const lv = s.run.drill.level;
  return mul(mul(mul(milestone(lv, PARAMS.drill.milestoneEvery), 1 + lv), toolMult(s.run.drill.tool) * m.drillPower), yunohanaMult(s));
}

/** 自動掘削機の打数/秒: 0.2 × Lv × 2^floor(Lv/25) × 倍率 */
export function autoDiggerHitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  const lv = s.run.autoDig.level;
  if (lv <= 0) return 0;
  return PARAMS.autoDigger.hitsPerLv * lv * 2 ** Math.floor(lv / PARAMS.drill.milestoneEvery) * m.autoDig;
}

function pumpMilestoneMult(level: number): number {
  let m = 1;
  for (const lv of PARAMS.pumpMilestones) if (level >= lv) m *= 2;
  return m;
}

function springIncomeRaw(s: GameState, id: SpringId, m: Modifiers): number {
  const lv = s.run.springs[id]?.pump ?? 0;
  if (lv <= 0) return 0;
  return SPRING_BY_ID[id].flow * lv * pumpMilestoneMult(lv) * (id === 'salt' ? m.saltMult : 1);
}

export const springIncome = (s: GameState, id: SpringId, m: Modifiers = modifiers(s)): Num => num(springIncomeRaw(s, id, m));

/** 入湯料/秒（枠につないだ源泉だけ。S1 は PoC の実装を仮に使う。本実装は S2 の BL-015・016） */
export function bathIncomePerSec(s: GameState, m: Modifiers = modifiers(s)): Num {
  // 源泉ごとの基本量は number の範囲（MVP では最大でも 1e12 程度）なので、合計してから Decimal にする
  let sum = 0;
  for (const id of s.run.bath.slots) if (id !== null) sum += springIncomeRaw(s, id, m);
  if (sum <= 0) return num(0);
  const bath = 1 + s.run.bath.level * PARAMS.bath.bonusPerLv;
  return mul(num(sum * bath * m.incomeAll), yunohanaMult(s));
}

export function slotsForBathLevel(level: number): number {
  let n = 0;
  for (const at of PARAMS.bath.slotsAtLevel) if (level >= at) n++;
  return n;
}

export const drillCost = (level: number): Num => sumGeometric(1, PARAMS.drill.c0, PARAMS.drill.r, level);
export const autoDiggerCost = (level: number): Num => sumGeometric(1, PARAMS.autoDigger.c0, PARAMS.autoDigger.r, level);
export const bathCost = (level: number): Num => sumGeometric(1, PARAMS.bath.c0, PARAMS.bath.r, level);
export const pumpCost = (id: SpringId, level: number): Num => sumGeometric(1, SPRING_BY_ID[id].pumpC0, SPRING_BY_ID[id].pumpR, level);

/** 次に進化できる道具（周回の最深で解放。最後の段なら null） */
export function nextTool(s: GameState): ToolDef | null {
  const t = TOOLS[s.run.drill.tool + 1];
  if (!t || s.run.maxDepth < t.unlockDepth) return null;
  return t;
}

export function yunohanaGain(s: GameState): Num {
  if (s.run.maxDepth < PARAMS.prestige.unlockDepth) return num(0);
  return num(Math.floor((s.run.maxDepth / PARAMS.prestige.divisor) ** 2));
}

export const springAtDepth = (depth: number): SpringId | null => SPRINGS.find((sp) => sp.depth === depth)?.id ?? null;
