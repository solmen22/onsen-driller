// HUD（gdd §11-2。BL-042）: キャンバスの上の帯。コイン・毎秒の収入・深さ（最深）と地温・温泉チケット・ラッキー鉱脈のチップ・設定ボタン、
// それと「保存できません」の案内（save-warning。出したまま。S2 の BL-046 で読み取り専用〔新しい版のセーブ〕を足し、
// ok → failing に変わったときのトーストは ui/overlay/Toasts.tsx）。
// 自動掘りの切り替えと掘削ブーストは、押しやすいようにキャンバスの下端に置く（StageActions.tsx）。
// data-testid と属性は traceability §5-1 の Q-17。テストが読む値は data-value に入れる（表示の文字は言語と表記で変わるため）
import { incomePerSec, temperatureOf, toStr } from '../../core/index.ts';
import { t, type Lang } from '../../i18n/index.ts';
import { formatNum, formatRate } from '../format.ts';
import { useGame, useSaveStatus, useUi } from '../hooks/use-game.ts';

export function Hud({ lang, onSettings, onVein }: { lang: Lang; onSettings: () => void; onVein?: () => void }) {
  const { rewards, requestReward } = useUi();
  /** 鉱脈のシート（R3）を開けるのは、ご褒美の口（BL-058・059）があるときだけ（ない間は S1 と同じく押せない） */
  const veinWired = onVein !== undefined && (rewards !== undefined || requestReward !== undefined);
  const v = useGame((s) => {
    const income = incomePerSec(s);
    return {
      coins: formatNum(s.run.coins, lang),
      coinsRaw: toStr(s.run.coins),
      income: formatRate(income, lang),
      incomeRaw: toStr(income),
      depth: s.run.depth,
      maxDepth: s.run.maxDepth,
      temp: temperatureOf(s),
      tickets: s.meta.tickets,
      vein: s.run.vein.active !== null,
    };
  });
  return (
    <header class="hud" data-testid="hud">
      <div class="hud-stats">
        <div class="hud-line">
          <span class="hud-coins" data-testid="hud-coins" data-value={v.coinsRaw} title={t('hud.coins')}>
            <span class="coin-icon" aria-hidden="true" />
            {v.coins}
          </span>
          <span class="hud-income" data-testid="hud-income" data-value={v.incomeRaw}>
            {t('hud.income', { n: v.income })}
          </span>
        </div>
        <div class="hud-line hud-sub">
          <span data-testid="hud-depth" data-value={v.depth} title={t('hud.depth')}>
            {v.depth}m
          </span>
          <span class="hud-max" data-testid="hud-max-depth" data-value={v.maxDepth}>
            {t('hud.maxDepth', { n: v.maxDepth })}
          </span>
          <span data-testid="hud-temp" data-value={v.temp}>
            {v.temp}℃
          </span>
        </div>
      </div>
      <div class="hud-side">
        {v.vein && (
          // ラッキー鉱脈は出ているときだけ（Q-20）。押すとご褒美のシート（R3）を開く（BL-046。口は BL-058・059）
          <button
            class="chip-vein"
            data-testid="chip-vein"
            type="button"
            disabled={!veinWired}
            aria-disabled={!veinWired}
            data-state={veinWired ? 'ready' : 'unavailable'}
            onClick={() => {
              if (veinWired) onVein?.();
            }}
          >
            {t('hud.vein')}
          </button>
        )}
        <span class="hud-tickets" data-testid="hud-tickets" data-value={v.tickets} title={t('hud.tickets')}>
          <span class="ticket-icon" aria-hidden="true" />
          {v.tickets}
        </span>
        <button class="hud-settings" data-testid="btn-settings" type="button" aria-label={t('hud.settings')} title={t('hud.settings')} onClick={onSettings}>
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
      <SaveWarning />
    </header>
  );
}

/**
 * 保存の案内（Q-11 の 5: ok 以外の間ずっと出す。閉じるボタンなし）。読み取り専用（新しい版のセーブ。Q-26）は
 * data-state="readonly" と「新しいバージョンのデータがあります。ページを再読み込みしてください」
 */
export function SaveWarning() {
  const status = useSaveStatus();
  if (status === 'ok') return null;
  return (
    <div class="save-warning" data-testid="save-warning" data-state={status} role="status">
      {status === 'readonly' ? t('save.newerVersion') : t('save.warning')}
    </div>
  );
}
