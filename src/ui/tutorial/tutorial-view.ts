// チュートリアル 8 段（gdd §12。BL-049）の契機と誘導。純粋な関数（状態 → 今出す段）
// - 画面を止めるモーダルは使わない。指の印（段 1）・光る枠（data-tutorial-glow）・短い吹き出しで誘導する
// - 済んだ段の番号は保存する（state.tutorial.step。core の {type:'tutorial', step}）。済んだ段は二度と出さない
// - 今出す段: 済んだ段より後で、契機を満たした段のうち、いちばん後ろの段（先の段の契機を満たしたら、手前の段は飛ばして済んだ扱い。
//   古いセーブ・転生の後に、手前の段を順に出し直さないため）。契機は周回をまたいで満たしやすいもの（最深・道具など）でも、
//   済んだ段より後ろだけを見るので出し直さない
// - 段を済ませる: その段の「済み」の条件を満たしたら（例 ツルハシを買った。出さないだけで書かない）、または吹き出しの「OK」で（書く）。
//   UI は状態を見て状態を書かない（書くのはプレイヤーの操作のときだけ。テスト用フックの stateHash が UI の描画の時刻で変わらないように）
// - 最初の周回だけ（meta.prestiges が 0）。段 1〜8 はどれも最初の周回の中の出来事で、転生の後に周回の値〔道具・コインなど〕が戻っても
//   出し直さない
// - 設定で消したら（state.tutorial.dismissed）何も出さない
import { GUEST_BY_ID } from '../../content/guests.ts';
import type { GameState } from '../../core/index.ts';
import type { TextKey } from '../../i18n/index.ts';
import type { TabNo } from '../keys.ts';

export interface TutorialStepDef {
  no: number;
  /** 契機 */
  trigger: (s: Readonly<GameState>) => boolean;
  /** 済み（OK を押さなくても済む条件。なければ OK でだけ済む） */
  done?: (s: Readonly<GameState>) => boolean;
  /** 光らせる要素（data-testid）。なければ光らせない */
  glow?: string;
  /** 吹き出しの文（段 1 は既存の「タップで掘る」の案内と指の印なので吹き出しなし） */
  text?: TextKey;
  /** 指の印（地下を指す。段 1） */
  finger?: boolean;
  /** そのタブに「！」を出す（段 8 は転生タブ） */
  alertTab?: TabNo;
}

const hasLevel10Guest = (s: Readonly<GameState>): boolean =>
  s.run.guests.some((g) => {
    const c = GUEST_BY_ID[g].condition;
    return c.kind === 'slottedLevel' && c.level >= 10;
  });

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  // 1. 起動直後: 地下に指の印（文は既存の「タップで掘る（長押しで掘り続ける）」）
  { no: 1, trigger: () => true, done: (s) => s.stats.hits > 0, finger: true },
  // 2. コイン 3: ツルハシを光らせる
  { no: 2, trigger: (s) => s.run.coins.gte(3), done: (s) => s.run.drill.tool >= 1, glow: 'buy-tool', text: 'tutorial.2' },
  // 3. ツルハシを買った: 自動掘りの切り替えを光らせる
  { no: 3, trigger: (s) => s.run.drill.tool >= 1, done: (s) => s.run.autoDig.on, glow: 'toggle-auto-dig', text: 'tutorial.3' },
  // 4. 10m: 地温を光らせる（25℃を超えると温泉）
  { no: 4, trigger: (s) => s.run.maxDepth >= 10, glow: 'hud-temp', text: 'tutorial.4' },
  // 5. 最初の源泉（30m の単純温泉）: 湯宿タブ（「！」は源泉の発見で App が出す）→ ポンプ
  { no: 5, trigger: (s) => Object.keys(s.run.springs).length > 0, done: (s) => Object.values(s.run.springs).some((x) => (x?.pump ?? 0) >= 2), glow: 'tab-2', text: 'tutorial.5' },
  // 6. 湯船の枠が 2: 源泉は入れ替えられる（枠を光らせる。湯宿タブを開いているときに見える）
  { no: 6, trigger: (s) => s.run.bath.slots.length >= 2, glow: 'inn-slot-1', text: 'tutorial.6' },
  // 7. 最初の Lv10 のお客さん（ポンプ Lv10 で来るお客さん）: お客さんの一覧へ
  { no: 7, trigger: hasLevel10Guest, glow: 'tab-2', text: 'tutorial.7' },
  // 8. 150m（転生の解放。セーブ全体で初めて）: 転生タブに「！」と 3 行の説明（強制しない）
  { no: 8, trigger: (s) => s.stats.bestDepth >= 150, glow: 'tab-4', text: 'tutorial.8', alertTab: 4 },
];

/** 今出す段（なければ null）。契機を満たしたいちばん後ろの段が「済み」なら出さない */
export function tutorialNow(s: Readonly<GameState>): TutorialStepDef | null {
  if (s.tutorial.dismissed || s.meta.prestiges > 0) return null;
  const passed = s.tutorial.step;
  let step: TutorialStepDef | null = null;
  for (const d of TUTORIAL_STEPS) if (d.no > passed && d.trigger(s)) step = d;
  return step?.done?.(s) ? null : step;
}
