// 湯の華の木（gdd §5-8 の表。BL-022 の画面。BL-045）: 3 系統（掘削・湯宿・客寄せ）を系統ごとのまとまりで、定義の順（浅い段から）に並べる
// - 狭い画面（320×568・縦の 390 幅）で名前と効果が切れないよう、系統は横の列ではなく縦のまとまり（見出し＋行）にする
// - ノードの状態は文字でも出す（取得済み・コスト・「〇〇を取ると取れる」。data-state: owned・available・insufficient・locked。色だけで伝えない）
// - 押せるのは available だけ（T4 では takePerk、確認の画面では振り直しの plan の切り替え）。確認の画面の振り直しでは owned も押せる（戻す）
import { t } from '../../i18n/index.ts';
import type { PerkId } from '../../content/perks.ts';
import type { PerkTreeRows } from './prestige-view.ts';

export interface PerkTreeProps {
  rows: PerkTreeRows;
  /** テストの ID の頭（T4 は perk、確認の画面は plan） */
  idPrefix: 'perk' | 'plan';
  /** 押したとき（ない間は押せない） */
  onPick?: (id: PerkId) => void;
  /** 取得済みのノードも押せる（確認の画面の振り直し） */
  ownedPickable?: boolean;
}

export function PerkTree({ rows, idPrefix, onPick, ownedPickable = false }: PerkTreeProps) {
  return (
    <div class="perk-tree" data-testid={`${idPrefix}-tree`} data-available={rows.availableValue}>
      <p class="note perk-available" data-testid={`${idPrefix}-available`} data-value={rows.availableValue}>
        {rows.availableText}
      </p>
      <div class="perk-columns">
        {rows.columns.map((col) => (
          <div key={col.branch} class="perk-branch" data-testid={`${idPrefix}-branch-${col.branch}`}>
            <h4 class="perk-branch-head">{t(`perk.branch.${col.branch}`)}</h4>
            {col.nodes.map((n) => {
              const pickable = onPick !== undefined && (n.state === 'available' || (ownedPickable && n.state === 'owned'));
              return (
                <button
                  key={n.id}
                  type="button"
                  class={`row perk-node perk-${n.state}`}
                  data-testid={`${idPrefix}-${n.id}`}
                  data-state={n.state}
                  data-cost={n.costValue}
                  aria-pressed={n.state === 'owned' ? 'true' : 'false'}
                  disabled={!pickable}
                  onClick={pickable ? () => onPick(n.id) : undefined}
                >
                  <span class="buy-main">
                    <span class="row-name">{n.name}</span>
                    <span class="buy-effect">{n.effect}</span>
                    {n.nextRun && <span class="perk-when">{t('perk.nextRun')}</span>}
                    {n.needs && <span class="buy-lock">{n.needs}</span>}
                  </span>
                  <span class="buy-side">
                    {n.state === 'owned' ? <span class="buy-done">{t('perk.owned')}</span> : <span class="row-cost">{n.cost}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
