// 式と派生値（gdd §5・§7-1）。状態を読むだけで、書き換えない。
import { PARAMS } from '../content/params.ts';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import { GUEST_BY_ID, GUESTS, type GuestDef, type GuestId } from '../content/guests.ts';
import { TOOLS, type ToolDef } from '../content/tools.ts';
import { num, numPow, type Num } from './num.ts';
import { hash01 } from './rng.ts';
import type { GameState } from './state.ts';

const B = PARAMS.block;

/** 地層の帯の境目（gdd §5-1） */
export const BAND_STARTS = [0, 30, 80, 150, 250, 400] as const;
export function bandOfDepth(depth: number): number {
  let band = 0;
  for (let i = 0; i < BAND_STARTS.length; i++) if (depth >= (BAND_STARTS[i] ?? 0)) band = i;
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

export const computeGuests = (s: GameState): GuestId[] =>
  GUESTS.filter((g) => guestConditionMet(s, g)).map((g) => g.id);

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

export const yunohanaMult = (s: GameState): number =>
  1 + s.meta.yunohanaLifetime.toNumber() * PARAMS.prestige.bonusPerYunohana;

export const blockHp = (s: GameState, depth: number, m: Modifiers = modifiers(s)): Num =>
  numPow(B.gh, depth).mul(B.h0 * m.hardness);

/** 鉱石の配置は「周回のシード × 深さ」のハッシュ（打つ順番・刻み幅・オフラインで変わらない） */
export const isOre = (s: GameState, depth: number): boolean => hash01(s.run.seed, depth) < B.oreChance;

export function blockValue(s: GameState, depth: number, ore: boolean, m: Modifiers = modifiers(s)): Num {
  const k = (ore ? B.oreMult * m.oreValue : 1) * m.digCoins;
  return numPow(B.gv, depth).mul(B.v0 * k);
}

export function toolMult(tool: number): number {
  let m = 1;
  for (let i = 1; i <= tool; i++) m *= TOOLS[i]?.mult ?? 1;
  return m;
}

const milestoneMult = (level: number, every: number): number => 2 ** Math.floor(level / every);

export function drillPower(s: GameState, m: Modifiers = modifiers(s)): Num {
  const lv = s.run.drill.level;
  const base = (1 + lv) * milestoneMult(lv, PARAMS.drill.milestoneEvery) * toolMult(s.run.drill.tool);
  return num(base * m.drillPower * yunohanaMult(s));
}

export function autoDiggerHitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  const lv = s.run.autoDig.level;
  return PARAMS.autoDigger.hitsPerLv * lv * milestoneMult(lv, PARAMS.drill.milestoneEvery) * m.autoDig;
}

/** 1 秒あたりの打数（長押し 4、自動掘り 2＋自動掘削機） */
export function hitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  const I = PARAMS.input;
  let h = s.run.hold ? I.holdPerSec : s.run.autoDig.on ? I.autoDigPerSec : 0;
  if (s.run.autoDig.on) h += autoDiggerHitsPerSec(s, m);
  return h;
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

export const springIncome = (s: GameState, id: SpringId, m: Modifiers = modifiers(s)): Num =>
  num(springIncomeRaw(s, id, m));

export function incomePerSec(s: GameState, m: Modifiers = modifiers(s)): Num {
  // 源泉ごとの基本量は number の範囲（MVP では最大でも 1e12 程度）なので、合計してから Decimal にする
  let sum = 0;
  for (const id of s.run.bath.slots) if (id !== null) sum += springIncomeRaw(s, id, m);
  const bath = 1 + s.run.bath.level * PARAMS.bath.bonusPerLv;
  return num(sum).mul(bath * m.incomeAll * yunohanaMult(s));
}

export function slotsForBathLevel(level: number): number {
  let n = 0;
  for (const at of PARAMS.bath.slotsAtLevel) if (level >= at) n++;
  return n;
}

export const drillCost = (level: number): Num => numPow(PARAMS.drill.r, level).mul(PARAMS.drill.c0);
export const autoDiggerCost = (level: number): Num => numPow(PARAMS.autoDigger.r, level).mul(PARAMS.autoDigger.c0);
export const bathCost = (level: number): Num => numPow(PARAMS.bath.r, level).mul(PARAMS.bath.c0);
export const pumpCost = (id: SpringId, level: number): Num =>
  numPow(SPRING_BY_ID[id].pumpR, level).mul(SPRING_BY_ID[id].pumpC0);

export function nextTool(s: GameState): ToolDef | null {
  const t = TOOLS[s.run.drill.tool + 1];
  if (!t || s.run.maxDepth < t.unlockDepth) return null;
  return t;
}

export function yunohanaGain(s: GameState): Num {
  if (s.run.maxDepth < PARAMS.prestige.unlockDepth) return num(0);
  return num(Math.floor((s.run.maxDepth / PARAMS.prestige.divisor) ** 2));
}

export const springAtDepth = (depth: number): SpringId | null =>
  SPRINGS.find((sp) => sp.depth === depth)?.id ?? null;
