// 式と派生値（gdd §5・§7-1）。状態を読むだけで、書き換えない
import type { Effect } from '../content/effects.ts';
import { PARAMS } from '../content/params.ts';
import { SPRINGS, SPRING_BY_ID, type SpringId } from '../content/springs.ts';
import { GUEST_BY_ID, GUESTS, type GuestDef, type GuestId } from '../content/guests.ts';
import { TOOLS, type ToolDef } from '../content/tools.ts';
import { ORE_BY_ID, type OreId } from '../content/ores.ts';
import { STRATA } from '../content/strata.ts';
import { add, mul, num, ONE, pow, sumGeometric, type Num } from './num.ts';
import { hash01, hash01Kind } from './rng.ts';
import type { GameState, UpgradeId } from './state.ts';

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

/**
 * 倍率を集める場所（BL-016）。枠の源泉・来ているお客さん・買った改良（BL-018）の効果（content/effects.ts の共通の語彙）を
 * applyEffect で 1 つにまとめる。倍率は 1、足し算は 0 から始め、すべて掛け算（足し算）で重なるので順番によらない。
 * 式の側は、ここの値だけを読む（ドリル威力・自動掘削・ブロックの HP と価値・入湯料・オフライン効率）
 */
export interface Modifiers {
  /** 全源泉の入湯料 */
  incomeAll: number;
  /** 源泉ごとの入湯料（カピバラ → 塩化物泉 ×2、改良の源泉ごとの ×3） */
  springIncome: Record<SpringId, number>;
  /** ドリル威力（すべての打撃） */
  drillPower: number;
  /** 自動掘削機の打数/秒 */
  autoDig: number;
  /** 鉱石の価値 */
  oreValue: number;
  /** 地層の硬さ（ブロックの HP） */
  hardness: number;
  /** 掘削で得るコイン（ブロックの価値） */
  digCoins: number;
  /** オフライン効率に足す値（上限は offlineEfficiency で丸める） */
  offlineEff: number;
}

/** 効果を 1 つ m に掛ける（足す）。源泉・お客さん・改良・湯の華の木で共通 */
export function applyEffect(m: Modifiers, e: Effect): void {
  switch (e.kind) {
    case 'incomeAll':
      m.incomeAll *= e.mult;
      return;
    case 'springIncome':
      m.springIncome[e.spring] *= e.mult;
      return;
    case 'drillPower':
      m.drillPower *= e.mult;
      return;
    case 'autoDig':
      m.autoDig *= e.mult;
      return;
    case 'oreValue':
      m.oreValue *= e.mult;
      return;
    case 'hardness':
      m.hardness *= e.mult;
      return;
    case 'digCoins':
      m.digCoins *= e.mult;
      return;
    case 'offlineEff':
      m.offlineEff += e.add;
      return;
  }
}

/**
 * 改良（BL-018）の効果を引く「口」。BL-016 の時点では改良の定義がないので、何も返さない（知らない ID も効果なし）。
 * BL-018 で `import { UPGRADE_BY_ID } from '../content/upgrades.ts'` を足し、本体を
 * `return Object.hasOwn(UPGRADE_BY_ID, id) ? UPGRADE_BY_ID[id]?.effect : undefined;` にする（この 2 か所だけ）
 */
export function upgradeEffect(_id: UpgradeId): Effect | undefined {
  return undefined;
}

/** 倍率の初期値（どの効果もない状態） */
export const baseModifiers = (): Modifiers => ({
  incomeAll: 1,
  springIncome: { simple: 1, co2: 1, salt: 1, sulfur: 1, iron: 1 },
  drillPower: 1,
  autoDig: 1,
  oreValue: 1,
  hardness: 1,
  digCoins: 1,
  offlineEff: 0,
});

/** 今の状態の倍率: 買った改良 → 枠につないだ源泉 → 来ているお客さん → 掘削ブースト（step ごとに呼ぶので、配列を作らずに 1 回ずつ走査する） */
export function modifiers(s: GameState): Modifiers {
  const m = baseModifiers();
  for (const id of s.run.upgrades) {
    const e = upgradeEffect(id);
    if (e) applyEffect(m, e);
  }
  for (const id of s.run.bath.slots) if (id !== null) applyEffect(m, SPRING_BY_ID[id].effect);
  for (const gid of s.run.guests) applyEffect(m, GUEST_BY_ID[gid].effect);
  // 掘削ブースト（R2。BL-058）: 効果の途中はドリル威力と自動掘削機の打数 ×2（自動掘りの基本・手動の上限は変えない。Q-31 (d)）
  if (s.run.boost.remainingMs > 0) {
    m.drillPower *= PARAMS.boost.mult;
    m.autoDig *= PARAMS.boost.mult;
  }
  return m;
}

/** オフライン効率（gdd §9）: 基本 50% ＋ 枠の塩化物泉など（+25%）。100% を超えない（S3 の BL-030 の早送りが使う） */
export function offlineEfficiency(s: GameState, m: Modifiers = modifiers(s)): number {
  const eff = PARAMS.offline.eff + m.offlineEff;
  return Number.isFinite(eff) ? Math.min(PARAMS.offline.maxEff, Math.max(0, eff)) : PARAMS.offline.eff;
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

/** 自動掘削機の打数/秒: 0.2 × Lv × 2^floor(Lv/25) × 倍率（上限 maxHitsPerSec。Infinity・NaN にしない。レビュー S-4） */
export function autoDiggerHitsPerSec(s: GameState, m: Modifiers = modifiers(s)): number {
  const lv = s.run.autoDig.level;
  if (!(lv > 0)) return 0;
  const raw = PARAMS.autoDigger.hitsPerLv * lv * 2 ** Math.floor(lv / PARAMS.drill.milestoneEvery) * m.autoDig;
  if (!(raw > 0)) return 0; // NaN・負
  return Math.min(PARAMS.autoDigger.maxHitsPerSec, raw); // Infinity も上限に
}

/** ポンプのマイルストーンの倍率（Lv10・25・50・100 に届くたびに ×2。gdd §5-4） */
export function pumpMilestoneMult(level: number): number {
  let m = 1;
  for (const lv of PARAMS.pumpMilestones) if (level >= lv) m *= 2;
  return m;
}

/** 次のマイルストーンの Lv（すべて越えていたら null。UI の「Lv25 で ×2」） */
export function nextPumpMilestone(level: number): number | null {
  for (const lv of PARAMS.pumpMilestones) if (level < lv) return lv;
  return null;
}

/** 源泉の基本の入湯料/秒（number）: 基本湧出 × Lv × マイルストーン × 源泉ごとの倍率。枠・全体の倍率の前で、つないでいるかは見ない */
function springIncomeRaw(s: GameState, id: SpringId, m: Modifiers): number {
  const lv = s.run.springs[id]?.pump ?? 0;
  if (lv <= 0) return 0;
  return SPRING_BY_ID[id].flow * lv * pumpMilestoneMult(lv) * m.springIncome[id];
}

/** 源泉の基本の入湯料/秒（枠・湯船・全体の倍率の前。未発見は 0。ボットの枠の並べ替えなどに使う） */
export const springIncome = (s: GameState, id: SpringId, m: Modifiers = modifiers(s)): Num => num(springIncomeRaw(s, id, m));

/**
 * 入湯料の基本量（number）に、つないだ源泉すべてに共通の倍率を掛ける（入湯料の式はここ 1 か所。レビュー PR #10 S-1）:
 * ×（1＋湯船の Lv × 5%）× 全入湯料（泉質・お客さん・改良。modifiers）× 転生（湯の華）。
 * number の部分は左から順に掛ける（S1 からの `sum * bath * incomeAll` と同じ丸め。リプレイのハッシュを保つ）
 */
function scaleBathIncome(raw: number, s: GameState, m: Modifiers): Num {
  if (!(raw > 0)) return num(0);
  return mul(num(raw * (1 + s.run.bath.level * PARAMS.bath.bonusPerLv) * m.incomeAll), yunohanaMult(s));
}

/**
 * 入湯料/秒（gdd §5-4。BL-015）＝ Σ（枠につないだ源泉の基本の入湯料）×（1＋湯船の Lv × 5%）× 全入湯料の倍率 × 転生の倍率。
 * 枠につないでいない源泉は 0（発見済みでも入らない）
 */
export function bathIncomePerSec(s: GameState, m: Modifiers = modifiers(s)): Num {
  // 源泉ごとの基本量は number の範囲（MVP では最大でも 1e12 程度）なので、合計してから Decimal にする
  let sum = 0;
  for (const id of s.run.bath.slots) if (id !== null) sum += springIncomeRaw(s, id, m);
  return scaleBathIncome(sum, s, m);
}

/**
 * 1 つの源泉の入湯料/秒（表示用）。つないでいる源泉なら、入湯料/秒の合計のうちその源泉の分（合計との差は丸めの範囲）。
 * つないでいない源泉は「今の倍率のまま」の目安で、その源泉をつなぐことで変わる泉質の効果（単純温泉の ×1.2 など）・
 * 来る／帰るお客さん（タヌキ・カピバラなど）の効果と、空きがなければ外す源泉の分は含めない（レビュー PR #10 N-2）
 */
export function springIncomeIfSlotted(s: GameState, id: SpringId, m: Modifiers = modifiers(s)): Num {
  return scaleBathIncome(springIncomeRaw(s, id, m), s, m);
}

/** 湯船の Lv に対する枠の数（Lv0・5・15・35 で 1・2・3・4。gdd §5-5） */
export function slotsForBathLevel(level: number): number {
  let n = 0;
  for (const at of PARAMS.bath.slotsAtLevel) if (level >= at) n++;
  return n;
}

/** 次の枠が増える湯船の Lv（最大の 4 枠なら null。UI の「Lv15 で枠 3」） */
export function nextSlotLevel(level: number): number | null {
  for (const at of PARAMS.bath.slotsAtLevel) if (level < at) return at;
  return null;
}

export const drillCost = (level: number): Num => sumGeometric(1, PARAMS.drill.c0, PARAMS.drill.r, level);
export const autoDiggerCost = (level: number): Num => sumGeometric(1, PARAMS.autoDigger.c0, PARAMS.autoDigger.r, level);
export const bathCost = (level: number): Num => sumGeometric(1, PARAMS.bath.c0, PARAMS.bath.r, level);
/** ポンプの次の 1 Lv のコスト（c₀ × r^今の Lv。Lv1 は発見時に無料なので、最初に買う Lv2 は c₀ × r。gdd §5-4） */
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
