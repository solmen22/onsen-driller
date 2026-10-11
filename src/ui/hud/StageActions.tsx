// キャンバスの下端のボタン（gdd §11-1 の「[自動掘り] [ブースト]」。BL-042）: HUD の一部。押すものを画面の下のほうに集める（片手操作）。
// - 自動掘りの切り替え: data-state="locked|off|on"（selector autoDigState）。locked（ツルハシの前）は disabled。色だけでなく文字でも状態を出す
// - 掘削ブースト（BL-046。Q-37 (a)）: data-state="ready|active|cooldown|unavailable"（ui/overlay/boost-view.ts）。ready だけ押せて、
//   押すとご褒美のシート（R2）を開く。active・cooldown は残り時間（m:ss）を出す。どの状態も色だけで伝えず、aria-label に状態と時間。
//   ご褒美の core（BL-058）と広告の要求（BL-059）の口がない間は unavailable（S1 と同じ「準備中」）
// - 最初の 1 打の前だけ「タップで掘る」の案内を出す（押下はキャンバスに通す）
// ボタンはステージ（#stage）の子ではないので、押してもステージの pointerdown（掘削）にはならない
import { autoDigState, boostMult } from '../../core/index.ts';
import { t } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { boostView, type BoostView } from '../overlay/boost-view.ts';

/** ブーストのボタンの状態の文字（色だけで伝えない） */
function boostText(b: BoostView, wired: boolean): string {
  switch (b.state) {
    case 'active':
      return t('hud.boostActive', { d: boostMult().drill, a: boostMult().auto, t: b.time ?? '' }); // 実際の倍率（自動掘削機は ×4。BL-059）
    case 'cooldown':
      return t('hud.boostCooldown', { t: b.time ?? '' });
    case 'ready':
      return t('hud.boostReady');
    default:
      return wired ? t('hud.boostUnavailable') : t('hud.boostSoon');
  }
}

export function StageActions({ onBoost }: { onBoost?: () => void }) {
  const { store, platform, rewards, requestReward } = useUi();
  const wired = rewards !== undefined || requestReward !== undefined;
  const v = useGame((s) => {
    // 動画を出せるかは 5Hz の通知ごとに読み直す（SDK の状態は変わりうる）
    const canVideo = requestReward !== undefined && platform.ads.rewardedAvailable();
    // 時刻は store と同じ壁時計（store が R2 の休みを切り詰めるのと同じ。PR #42 のレビューの Should）
    const b = boostView(s, store.wallTime(), canVideo, rewards !== undefined);
    return { dig: autoDigState(s), started: s.stats.hits > 0, boost: b.state, boostTime: b.time };
  });
  const boost: BoostView = { state: v.boost, time: v.boostTime };
  const boostLabel = boostText(boost, wired);
  const boostOff = boost.state !== 'ready';
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
      <button
        class="act act-boost"
        type="button"
        data-testid="btn-boost"
        data-state={boost.state}
        disabled={boostOff}
        aria-disabled={boostOff}
        aria-label={t('hud.boostLabel', { state: boostLabel })}
        onClick={() => {
          if (!boostOff) onBoost?.();
        }}
      >
        <span class="act-label">{t('hud.boost')}</span>
        <span class="act-state">{boostLabel}</span>
      </button>
    </div>
  );
}
