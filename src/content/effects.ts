// 倍率の効果の共通の語彙（BL-016）。源泉（枠につないでいる間）・お客さん（来ている間）・改良（買った後。BL-018）・
// 湯の華の木（S3）が同じ形で効果を書き、core/formulas.ts の applyEffect が 1 か所で Modifiers に掛ける。
// 倍率（mult）はすべて掛け算で重なる。足し算の効果（add）は足し合わせる
import type { SpringId } from './springs.ts';

export type Effect =
  /** 全源泉の入湯料 ×mult（単純温泉・タヌキ・レッサーパンダ、改良「のれん」など） */
  | { kind: 'incomeAll'; mult: number }
  /** その源泉の入湯料 ×mult（カピバラ → 塩化物泉、改良「湯もみ板」「源泉かけ流し」） */
  | { kind: 'springIncome'; spring: SpringId; mult: number }
  /** ドリル威力（すべての打撃のダメージ）×mult（二酸化炭素泉・ニホンザル、改良「振動ビット」など） */
  | { kind: 'drillPower'; mult: number }
  /** 自動掘削機の打数/秒 ×mult（キツネ、改良「掘削油」） */
  | { kind: 'autoDig'; mult: number }
  /** 鉱石の価値 ×mult（硫黄泉、改良「選鉱ざる」「研磨台」） */
  | { kind: 'oreValue'; mult: number }
  /** 地層の硬さ（ブロックの HP）×mult（含鉄泉 ×0.8） */
  | { kind: 'hardness'; mult: number }
  /** 掘削で得るコイン（ブロックの価値）×mult（ネコ、改良「宿帳」） */
  | { kind: 'digCoins'; mult: number }
  /** オフライン効率に足す（塩化物泉 +0.25。上限は params.offline.maxEff） */
  | { kind: 'offlineEff'; add: number };

export type EffectKind = Effect['kind'];
