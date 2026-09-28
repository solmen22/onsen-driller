// キャンバスの下端のボタン（gdd §11-1 の「[自動掘り] [ブースト]」。BL-042）: HUD の一部。押すものを画面の下のほうに集める（片手操作）。
// - 自動掘りの切り替え: data-state="locked|off|on"（selector autoDigState）。locked（ツルハシの前）は disabled。色だけでなく文字でも状態を出す
// - 掘削ブースト: S1 は押せない（disabled・aria-disabled・data-state="unavailable"。Q-20）。使える形にするのは S2 の BL-058・046・059
// - 最初の 1 打の前だけ「タップで掘る」の案内を出す（押下はキャンバスに通す）
// ボタンはステージ（#stage）の子ではないので、押してもステージの pointerdown（掘削）にはならない
import { autoDigState } from '../../core/index.ts';
import { t } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';

export function StageActions() {
  const { store } = useUi();
  const v = useGame((s) => ({ dig: autoDigState(s), started: s.stats.hits > 0 }));
  const on = v.dig === 'on';
  const locked = v.dig === 'locked';
  return (
    <div class="stage-actions">
      {!v.started && <p class="hint">{t('hud.tapHint')}</p>}
      <button
        class="act act-auto"
        type="button"
        data-testid="toggle-auto-dig"
        data-state={v.dig}
        aria-pressed={on}
        disabled={locked}
        title={locked ? t('hud.autoDigLocked') : undefined}
        onClick={() => store.dispatch({ type: 'setAutoDig', on: !on })}
      >
        <span class="act-label">{t('item.autoDig')}</span>
        <span class="act-state">{locked ? t('buy.locked') : on ? t('state.on') : t('state.off')}</span>
      </button>
      <button class="act act-boost" type="button" data-testid="btn-boost" data-state="unavailable" disabled aria-disabled="true">
        <span class="act-label">{t('hud.boost')}</span>
        <span class="act-state">{t('hud.boostSoon')}</span>
      </button>
    </div>
  );
}
