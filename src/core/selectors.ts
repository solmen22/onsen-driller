// UI・描画用の派生値（arch §5: view が import してよい core の入口）。状態を読むだけで、書き換えない
// - buyQuote: 表示と購入で同じ関数を使う（「買えるように見えて買えない」を防ぐ。arch §6-2・Q-09）
// - incomePerSec: HUD の「毎秒の収入」と「あと N 秒」の共通の値（入湯料/秒＋自動の掘削のコイン/秒。手動は含めない）
import { GUESTS, type GuestCondition, type GuestEffect, type GuestId } from '../content/guests.ts';
import { PARAMS } from '../content/params.ts';
import { SPRING_BY_ID, SPRINGS, type SpringEffect, type SpringId } from '../content/springs.ts';
import { TOOLS } from '../content/tools.ts';
import { isUpgradeId, type UpgradeId } from '../content/upgrades.ts';
import {
  autoDiggerHitsPerSec,
  bathIncomePerSec,
  blockHp,
  blockValue,
  drillPower,
  modifiers,
  nextPumpMilestone,
  nextSlotLevel,
  offlineEfficiency,
  slotsForBathLevel,
  springIncomeIfSlotted,
  temperatureAt,
  type Modifiers,
} from './formulas.ts';
import { autoDigUnlocked } from './input.ts';
import { add, affordGeometric, div, gt, mul, num, sub, sumGeometric, toNumber, ZERO, type Num } from './num.ts';
import type { GameState } from './state.ts';
import { upgradeQuote } from './upgrades.ts';

export { bandOfDepth, oreAt, springAtDepth, temperatureAt } from './formulas.ts';
export { autoDigUnlocked } from './input.ts';

/** レベルを買う品目（ドリル・自動掘削機・湯船・源泉ごとのポンプ） */
export type LevelItem = 'drill' | 'autoDigger' | 'bath' | `pump:${SpringId}`;
/** 購入の品目（道具の進化は 1 回で 1 段だけ） */
export type ItemId = LevelItem | 'tool' | `upgrade:${UpgradeId}`;
/** 購入数（×1・×10・最大） */
export type Qty = 1 | 10 | 'max';

/** 購入ボタンの状態（Q-17 の data-state と同じ名前） */
export type BuyState = 'affordable' | 'insufficient' | 'locked' | 'maxed';

export interface BuyQuote {
  item: ItemId;
  qty: Qty;
  state: BuyState;
  /** 買う数。'max' で 1 個も買えないとき・locked・maxed は 0。×1・×10 で足りないときは qty のまま（合計を表示するため） */
  n: number;
  /** n 個の合計コスト（n が 0 なら 0） */
  cost: Num;
  /** 次の 1 個のコスト（「最大」で 0 個のときに表示する。maxed は 0） */
  nextCost: Num;
  /** 今のレベル（道具は段。ポンプは未発見なら 0） */
  level: number;
  /** locked のときの解放の深さ（道具・未発見の源泉のポンプ） */
  unlockDepth?: number;
}

interface Series {
  c0: number;
  r: number;
  owned: number;
}

export const isSpringId = (v: unknown): v is SpringId => typeof v === 'string' && Object.hasOwn(SPRING_BY_ID, v);
/** 改良の品目（'upgrade:<id>'）か。形だけを見る（ID の妥当性は isItemId） */
export const isUpgradeItem = (item: ItemId): item is `upgrade:${UpgradeId}` => item.startsWith('upgrade:');
export const isQty = (v: unknown): v is Qty => v === 1 || v === 10 || v === 'max';
export function isItemId(v: unknown): v is ItemId {
  if (v === 'drill' || v === 'autoDigger' || v === 'bath' || v === 'tool') return true;
  if (typeof v === 'string' && v.startsWith('upgrade:')) return isUpgradeId(v.slice(8)); // 一度きりの改良（BL-018）
  return typeof v === 'string' && v.startsWith('pump:') && isSpringId(v.slice(5));
}

/** 品目の等比級数（コスト＝c0 × r^Lv）。未発見の源泉のポンプは null */
export function seriesOf(s: Readonly<GameState>, item: LevelItem): Series | null {
  switch (item) {
    case 'drill':
      return { c0: PARAMS.drill.c0, r: PARAMS.drill.r, owned: s.run.drill.level };
    case 'autoDigger':
      return { c0: PARAMS.autoDigger.c0, r: PARAMS.autoDigger.r, owned: s.run.autoDig.level };
    case 'bath':
      return { c0: PARAMS.bath.c0, r: PARAMS.bath.r, owned: s.run.bath.level };
    default: {
      const id = item.slice(5) as SpringId;
      const sp = s.run.springs[id];
      if (!sp) return null;
      const def = SPRING_BY_ID[id];
      return { c0: def.pumpC0, r: def.pumpR, owned: sp.pump };
    }
  }
}

function toolQuote(s: Readonly<GameState>, qty: Qty): BuyQuote {
  const level = s.run.drill.tool;
  const next = TOOLS[level + 1];
  if (!next) return { item: 'tool', qty, state: 'maxed', n: 0, cost: ZERO, nextCost: ZERO, level };
  const cost = num(next.cost);
  // 解放は周回の最深で判定する（今の深さではない。Q-08）
  if (s.run.maxDepth < next.unlockDepth) return { item: 'tool', qty, state: 'locked', n: 0, cost: ZERO, nextCost: cost, level, unlockDepth: next.unlockDepth };
  return { item: 'tool', qty, state: gt(cost, s.run.coins) ? 'insufficient' : 'affordable', n: 1, cost, nextCost: cost, level };
}

/**
 * 購入の見積もり（表示と購入で同じ関数。buy はこの state と cost で成否と差し引く額を決める）。
 * - 道具: qty によらず 1 段だけ。最後の段なら maxed、解放の深さに届かなければ locked
 * - 'max': 今のコインで買える数。1 個も買えなければ n: 0・cost: 0・insufficient（nextCost に次の 1 個のコスト）
 * - ×1・×10 で足りなければ insufficient（n・cost はその数の合計）
 * - レベルが上限（PARAMS.levelMax）なら maxed。上限の手前では、×10・最大は上限までの数（レビュー S-4）
 */
export function buyQuote(s: Readonly<GameState>, item: ItemId, qty: Qty): BuyQuote {
  if (item === 'tool') return toolQuote(s, qty);
  if (isUpgradeItem(item)) {
    // 改良は一度きり（qty によらず 1 回。TS-018-07）。見積もりは core/upgrades.ts
    const u = upgradeQuote(s, item.slice(8) as UpgradeId);
    return { item, qty, state: u.state, n: u.n, cost: u.state === 'affordable' || u.state === 'insufficient' ? u.cost : ZERO, nextCost: u.cost, level: u.level, ...(u.unlockDepth !== undefined ? { unlockDepth: u.unlockDepth } : {}) };
  }
  const se = seriesOf(s, item);
  if (!se) {
    const id = item.slice(5) as SpringId;
    return { item, qty, state: 'locked', n: 0, cost: ZERO, nextCost: ZERO, level: 0, unlockDepth: SPRING_BY_ID[id]?.depth };
  }
  const coins = s.run.coins;
  // レベルの上限（PARAMS.levelMax）に達したら maxed。×10・最大は上限までの数に減らす（レビュー S-4）
  const room = Math.max(0, PARAMS.levelMax - se.owned);
  if (room <= 0) return { item, qty, state: 'maxed', n: 0, cost: ZERO, nextCost: ZERO, level: se.owned };
  const nextCost = sumGeometric(1, se.c0, se.r, se.owned);
  if (qty !== 'max') {
    const k = Math.min(qty, room);
    const cost = sumGeometric(k, se.c0, se.r, se.owned);
    return { item, qty, state: gt(cost, coins) ? 'insufficient' : 'affordable', n: k, cost, nextCost, level: se.owned };
  }
  let n = Math.min(room, affordGeometric(coins, se.c0, se.r, se.owned));
  let cost = sumGeometric(n, se.c0, se.r, se.owned);
  // 丸めで「買えるように見えて買えない」を防ぐ: 所持金を超えたら 1 つずつ減らす
  while (n > 0 && gt(cost, coins)) {
    n--;
    cost = sumGeometric(n, se.c0, se.r, se.owned);
  }
  // 逆に少なく見積もっていたら足す（affordGeometricSeries の誤差。上限に張り付いた値で回り続けないよう 2 回まで）
  for (let i = 0; i < 2 && n < room; i++) {
    const more = sumGeometric(n + 1, se.c0, se.r, se.owned);
    if (gt(more, coins) || !gt(more, cost)) break;
    n++;
    cost = more;
  }
  if (n <= 0) return { item, qty, state: 'insufficient', n: 0, cost: ZERO, nextCost, level: se.owned };
  return { item, qty, state: 'affordable', n, cost, nextCost, level: se.owned };
}

/** 自動掘りのスイッチの状態（Q-03。HUD の toggle-auto-dig の data-state） */
export function autoDigState(s: Readonly<GameState>): 'locked' | 'off' | 'on' {
  if (!autoDigUnlocked(s)) return 'locked';
  return s.run.autoDig.on ? 'on' : 'off';
}

/** 自動の打数/秒（自動掘りの基本〔オンで解放済みなら 2〕＋自動掘削機。長押し・タップは含めない） */
export function autoHitsPerSec(s: Readonly<GameState>, m: Modifiers = modifiers(s)): number {
  const base = s.run.autoDig.on && autoDigUnlocked(s) ? PARAMS.input.autoDigPerSec : 0;
  return base + autoDiggerHitsPerSec(s, m);
}

/**
 * 毎秒の収入（見込み。PM の依頼 2）＝ 入湯料/秒 ＋ 自動の掘削のコイン/秒。
 * 自動の掘削のコイン/秒 ＝ 自動の打数/秒 × ドリル威力 ÷ 今のブロックの HP × 今の深さのブロックの価値の期待値
 * （鉱石の出現率 p で V×(1−p) ＋ 鉱石の価値×p。0〜4m は p＝0）。幕間は考えない（定常の見込み）
 */
export function incomePerSec(s: Readonly<GameState>): Num {
  const m = modifiers(s);
  const bath = bathIncomePerSec(s, m);
  const hits = autoHitsPerSec(s, m);
  if (!(hits > 0)) return bath;
  const d = s.run.depth;
  const p = d >= PARAMS.block.oreFreeDepth ? PARAMS.block.oreChance : 0;
  const expected = add(mul(blockValue(s, d, false, m), 1 - p), mul(blockValue(s, d, true, m), p));
  const perHit = div(mul(drillPower(s, m), expected), blockHp(s, d, m));
  return add(bath, mul(perHit, hits));
}

/**
 * 「あと N 秒」: ceil((cost − coins) ÷ incomePerSec)。返し方は 3 通り（BL-113）:
 * ① 足りていれば（coins ≥ cost）0 ② 足りず、収入が 0 なら null（「あと N コイン」を出す。Q-09）
 * ③ それ以外は 1 以上（差が Decimal の引き算の精度〔相対 1e-14 未満を 0 にする〕で消えた場合を含む）。
 * 足りているかは差ではなく比較で決める（buyQuote の厳密な比較と合わせる。差が 0 でも足りないことがある）
 */
export function secondsUntil(s: Readonly<GameState>, cost: Num): number | null {
  if (!s.run.coins.lt(cost)) return 0;
  const inc = incomePerSec(s);
  if (inc.eq(0)) return null;
  const lack = sub(cost, s.run.coins);
  // 割り切れる値が浮動小数の誤差で 8.000000001 になっても 9 にしないよう、ごく小さな許容を引いてから切り上げる（足りない間は 1 以上）
  return Math.max(1, Math.ceil(toNumber(div(lack, inc)) - 1e-9));
}

/** 源泉 1 つの表示用の値（湯宿タブ T2 の「発見済みの源泉とポンプ」。BL-015）。読み取り専用（effect は内容定義そのものなので書き換えない） */
export interface SpringView {
  readonly id: SpringId;
  /** 発見の深さ（未発見のとき「〇m で発見」） */
  readonly depth: number;
  readonly found: boolean;
  /** ポンプの Lv（未発見は 0。発見時に Lv1） */
  readonly pump: number;
  /** つないでいる枠（0 始まり）。つないでいなければ null */
  readonly slot: number | null;
  /** 今この源泉から入っている入湯料/秒（つないでいなければ 0。つないでいる源泉の合計は bathIncomePerSec と丸めの範囲で一致） */
  readonly incomePerSec: Num;
  /**
   * つないだときの入湯料/秒の目安（今の倍率のまま。未発見は 0）。その源泉をつなぐことで変わる泉質の効果・来る／帰るお客さんの効果と、
   * 空きがなければ外す源泉の分は含めない（「つなぐと +X/秒」と出すなら、この注意を UI の文言で補う）
   */
  readonly potentialPerSec: Num;
  /** 次に ×2 になるポンプの Lv（10・25・50・100。すべて越えたら null。未発見は 10） */
  readonly nextMilestone: number | null;
  /** 枠につないでいる間だけ効く効果（content/springs.ts の定義。書き換えない） */
  readonly effect: Readonly<SpringEffect>;
}

/** 源泉 5 種の表示用の値（content/springs.ts の順。未発見も含む） */
export function springViews(s: Readonly<GameState>): SpringView[] {
  const m = modifiers(s);
  return SPRINGS.map((def) => {
    const pump = s.run.springs[def.id]?.pump ?? 0;
    const slotIdx = s.run.bath.slots.indexOf(def.id);
    const potential = springIncomeIfSlotted(s, def.id, m);
    return {
      id: def.id,
      depth: def.depth,
      found: pump > 0,
      pump,
      slot: slotIdx >= 0 ? slotIdx : null,
      incomePerSec: slotIdx >= 0 ? potential : ZERO,
      potentialPerSec: potential,
      nextMilestone: nextPumpMilestone(pump),
      effect: def.effect,
    };
  });
}

/** 湯船の枠 1 つの表示用の値（BL-016）。読み取り専用 */
export interface SlotView {
  /** 枠の番号（0 始まり） */
  readonly slot: number;
  /** つないでいる源泉（空きは null） */
  readonly spring: SpringId | null;
  /** この枠の源泉から入っている入湯料/秒（空きは 0） */
  readonly incomePerSec: Num;
  /** この枠の源泉の効果（空きは null。内容定義そのものなので書き換えない） */
  readonly effect: Readonly<SpringEffect> | null;
}

/** 湯船の表示用の値（湯宿タブ T2 の「湯船の枠」「湯船のレベル」。BL-016）。読み取り専用 */
export interface BathView {
  readonly level: number;
  /** 今の枠の数（1〜4） */
  readonly slotCount: number;
  /** 枠の最大（MVP は 4） */
  readonly maxSlots: number;
  /** 次に枠が増える Lv（最大なら null） */
  readonly nextSlotLevel: number | null;
  /** 入湯料の合計に足している割合（%。Lv × 5） */
  readonly bonusPct: number;
  readonly slots: readonly SlotView[];
  /** オフライン効率（0.5〜1。枠の塩化物泉で +0.25） */
  readonly offlineEfficiency: number;
}

export function bathView(s: Readonly<GameState>): BathView {
  const m = modifiers(s);
  const level = s.run.bath.level;
  return {
    level,
    slotCount: slotsForBathLevel(level),
    maxSlots: PARAMS.bath.slotsAtLevel.length,
    nextSlotLevel: nextSlotLevel(level),
    bonusPct: Math.round(level * PARAMS.bath.bonusPerLv * 100 * 1e6) / 1e6,
    slots: s.run.bath.slots.map((id, slot) =>
      id === null
        ? { slot, spring: null, incomePerSec: ZERO, effect: null }
        : { slot, spring: id, incomePerSec: springIncomeIfSlotted(s, id, m), effect: SPRING_BY_ID[id].effect },
    ),
    offlineEfficiency: offlineEfficiency(s, m),
  };
}

/** お客さん 1 種の表示用の値（湯宿タブ T2 の「お客さんの一覧と来訪条件」。BL-017）。読み取り専用 */
export interface GuestView {
  readonly id: GuestId;
  /** 今来ている（効果が効いている） */
  readonly present: boolean;
  /** 図鑑に記録がある（どこかの周回で来たことがある） */
  readonly seen: boolean;
  /** 初来訪の壁時計（UTC の ms）。来たことがない・時刻が記録されていない（0）なら null */
  readonly firstSeenAt: number | null;
  /** 来訪の条件（内容定義そのもの。書き換えない）。進み具合は springViews（枠・ポンプの Lv）と bathView（埋まった枠）で出す */
  readonly condition: Readonly<GuestCondition>;
  /** 来ている間だけ効く効果（内容定義そのもの。書き換えない） */
  readonly effect: Readonly<GuestEffect>;
}

/** お客さんの表示用の値（content/guests.ts の順。来ていないお客さんも含む） */
export function guestViews(s: Readonly<GameState>): GuestView[] {
  return GUESTS.map((g) => {
    const seen = Object.hasOwn(s.collection.guestsSeen, g.id);
    const t = s.collection.guestsSeen[g.id];
    return {
      id: g.id,
      present: s.run.guests.includes(g.id),
      seen,
      firstSeenAt: seen && typeof t === 'number' && t > 0 ? t : null,
      condition: g.condition,
      effect: g.effect,
    };
  });
}

/** 今の深さの地温（表示用の ℃ の整数。HUD の深さの横） */
export const temperatureOf = (s: Readonly<GameState>): number => temperatureAt(s.run.depth);

/** 今のブロックの進み具合（入ったダメージ ÷ HP。0 以上 1 未満。ひびの段と道具の位置の補間に使う） */
export function blockProgress(s: Readonly<GameState>): number {
  const hp = blockHp(s, s.run.depth);
  if (hp.eq(0)) return 0;
  const r = toNumber(div(s.run.blockDmg, hp));
  return Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
}

/** 幕間の残り（ms。0 なら幕間ではない。描画の帯の名前のカード） */
export const interludeLeftMs = (s: Readonly<GameState>): number => s.run.interludeMs;
