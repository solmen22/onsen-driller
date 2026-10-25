// キャンバスの下端のボタン（gdd §11-1 の「[自動掘り] [ブースト]」。BL-042）: HUD の一部。押すものを画面の下のほうに集める（片手操作）。
// - 自動掘りの切り替え: data-state="locked|off|on"（selector autoDigState）。locked（ツルハシの前）は disabled。色だけでなく文字でも状態を出す
// - 掘削ブースト（BL-046。Q-37 (a)）: data-state="ready|active|cooldown|unavailable"（ui/overlay/boost-view.ts）。ready だけ押せて、
//   押すとご褒美のシート（R2）を開く。active・cooldown は残り時間（m:ss）を出す。どの状態も色だけで伝えず、aria-label に状態と時間。
//   ご褒美の core（BL-058）と広告の要求（BL-059）の口がない間は unavailable（S1 と同じ「準備中」）
//   active の倍率は「×2」だけ。自動掘削機を持っているときだけ、名前（掘削機）で ×4 を足す（PR #55 のレビュー S-1）
// - btn-boost の幅は CSS（global.css の .act-boost）で決める（PR #55 のレビュー S-2）
// - 最初の 1 打の前だけ「タップで掘る」の案内を出す（押下はキャンバスに通す）
//   文に U+200B（ゼロ幅スペース）があれば、そこで区切り、区切りの中では改行しない（「長押し」の中で改行しない。
//   ja は区切る。en は区切らず、語の間で改行する）。区切りの間にだけ <wbr>（改行してよい所）を置く。CSS は global.css の .hint-phrase
// ボタンはステージ（#stage）の子ではないので、押してもステージの pointerdown（掘削）にはならない
import { Fragment } from 'preact';
import { autoDigState, boostMult } from '../../core/index.ts';
import { t } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { boostView, type BoostView } from '../overlay/boost-view.ts';

/** 区切り（i18n の文の中のゼロ幅スペース） */
const PHRASE_BREAK = '\u200b';

/** 最初の案内の中身。区切りがあれば、区切りごとに改行しない span にする（BL-136 の後続。nightly の 375×667） */
function HintText({ text }: { text: string }) {
  const phrases = text.split(PHRASE_BREAK);
  if (phrases.length === 1) return <>{text}</>;
  return (
    <>
      {phrases.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          <span class="hint-phrase">{p}</span>
        </Fragment>
      ))}
    </>
  );
}

/** ブーストのボタンの状態の文字（色だけで伝えない） */
function boostText(b: BoostView, wired: boolean, hasDigger: boolean): string {
  switch (b.state) {
    case 'active': {
      // 実際の倍率（ドリル ×2・自動掘削機 ×4。BL-059）。自動掘削機がなければ ×4 は出さない（S-1）
      const m = boostMult();
      const time = b.time ?? '';
      return hasDigger ? t('hud.boostActiveDigger', { d: m.drill, a: m.auto, t: time }) : t('hud.boostActive', { d: m.drill, t: time });
    }
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
    return { dig: autoDigState(s), started: s.stats.hits > 0, boost: b.state, boostTime: b.time, hasDigger: s.run.autoDig.level > 0 };
  });
  const boost: BoostView = { state: v.boost, time: v.boostTime };
  const boostLabel = boostText(boost, wired, v.hasDigger);
  const boostOff = boost.state !== 'ready';
  const on = v.dig === 'on';
  const locked = v.dig === 'locked';
  return (
    <div class="stage-actions">
      {!v.started && (
        <p class="hint">
          <HintText text={t('hud.tapHint')} />
        </p>
      )}
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
