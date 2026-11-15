// T4「転生」（gdd §5-8・§11-2。BL-045。Q-47 (a)(h)(k)）
// - 解放前（セーブ全体の最深 < 150m）: 案内だけ（「150m で解放」「あと 〇m」・1 行の説明。prestige-locked）。ボタンは出さない
// - 解放後: 今得られる湯の華（prestige-gain。data-value）・次に増えるまでの深さ（prestige-next）・推奨か目安（prestige-recommended・
//   prestige-guide）・今の全生産の上乗せ（prestige-mult-now）・転生のボタン（btn-prestige。得られる湯の華が 0 の間は押せない）・湯の華の木
// - 地形の選択は BL-024（地形の中身と転生の地形の引数）が入ってから足す（BL-045 の受け入れ基準 1 の残り）
// - 木のノードを取るのは store.dispatch({type:'takePerk'}) だけ（確認をはさまない。振り直しは転生の確認の画面で無料）
// - 転生のボタンを押したその場で openPrestigeConfirm を呼ぶ（ループを止めてから確認の画面の値を読む。Q-47 (j)）
import { useState } from 'preact/hooks';
import type { PerkId } from '../../content/perks.ts';
import { t, type Lang } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { openPrestigeConfirm } from '../overlay/prestige-confirm.ts';
import { PrestigeModal } from '../overlay/PrestigeModal.tsx';
import { PerkTree } from './PerkTree.tsx';
import { perkTreeRows, prestigePanelView, type PerkTreeRows } from './prestige-view.ts';

const sameRows = (a: PerkTreeRows | null, b: PerkTreeRows | null): boolean => a?.sig === b?.sig;

export function PrestigePanel({ lang }: { lang: Lang }) {
  const { store } = useUi();
  const v = useGame((s) => prestigePanelView(s, lang));
  const tree = useGame((s) => perkTreeRows(s, lang), sameRows);
  const [confirm, setConfirm] = useState<{ close: () => void } | null>(null);

  if (!v.unlocked) {
    return (
      <div class="list" data-testid="panel-prestige" data-state="locked">
        <div class="prestige-locked" data-testid="prestige-locked">
          <p class="prestige-line">{v.lockedTitle}</p>
          <p class="note" data-testid="prestige-locked-left">
            {v.lockedLeft}
          </p>
          <p class="note">{t('prestige.locked.desc')}</p>
        </div>
      </div>
    );
  }

  const open = (): void => {
    if (confirm !== null || !v.canPrestige) return;
    const close = openPrestigeConfirm(() => setConfirm(null)); // 隠れたら app が閉じさせる（onDismiss）
    setConfirm({ close });
  };
  const take = (id: PerkId): void => {
    store.dispatch({ type: 'takePerk', perk: id });
  };

  return (
    <div class="list" data-testid="panel-prestige" data-state={v.canPrestige ? 'ready' : 'open'}>
      <p class="prestige-line" data-testid="prestige-gain" data-value={v.gainValue}>
        {v.gainText}
        {v.bonusText && <small class="prestige-bonus"> {v.bonusText}</small>}
      </p>
      <p class="note" data-testid="prestige-next" data-left={v.nextLeft}>
        {v.nextText}
      </p>
      {v.guideText &&
        (v.recommended ? (
          <p class="note prestige-recommended" data-testid="prestige-recommended">
            {v.guideText}
          </p>
        ) : (
          <p class="note" data-testid="prestige-guide">
            {v.guideText}
          </p>
        ))}
      <p class="note" data-testid="prestige-mult-now" data-value={v.multValue}>
        {v.multText}
      </p>
      <button
        type="button"
        class={`row prestige-btn${v.canPrestige ? ' buy-affordable' : ''}`}
        data-testid="btn-prestige"
        disabled={!v.canPrestige}
        aria-disabled={v.canPrestige ? 'false' : 'true'}
        onClick={open}
      >
        <span class="row-name">{t('prestige.btn')}</span>
      </button>
      <h3 class="inn-head">{t('perk.head')}</h3>
      {tree && <PerkTree rows={tree} idPrefix="perk" onPick={take} />}
      {confirm !== null && <PrestigeModal lang={lang} close={confirm.close} onClosed={() => setConfirm(null)} />}
    </div>
  );
}
