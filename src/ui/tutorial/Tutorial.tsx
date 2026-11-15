// チュートリアルの表示（gdd §12。BL-049）: 指の印（tutorial-finger）・吹き出し（tutorial-bubble）・光る枠（data-tutorial-glow）
// - 画面を止めない（モーダルにしない。modal-state に数えない。掘削の入力も止めない）。指の印は押下を通す（pointer-events: none）
// - 吹き出しはステージの上端に出し、下端の自動掘り・ブーストのボタンと「タップで掘る」の案内に重ねない
// - 光る枠: 光らせる要素（data-testid）に data-tutorial-glow="true" を付ける。描くたびに付け直す（タブを切り替えて要素が出たときにも付く）。
//   段が変わったら外す
// - 段を済ませる: 「済み」の条件を満たしたら出さない（書かない）。吹き出しの OK で core の {type:'tutorial', step} を書く（プレイヤーの操作のときだけ書く）
import { useEffect } from 'preact/hooks';
import { t } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { TUTORIAL_STEPS, tutorialNow } from './tutorial-view.ts';

const GLOW = 'data-tutorial-glow';

export function Tutorial() {
  const { store } = useUi();
  const no = useGame((s) => tutorialNow(s)?.no ?? 0);
  const step = TUTORIAL_STEPS.find((d) => d.no === no) ?? null;

  // 光る枠（描くたびに付け直す。前の段の印は外す）
  useEffect(() => {
    const id = step?.glow;
    for (const el of document.querySelectorAll(`[${GLOW}]`)) if (el.getAttribute('data-testid') !== id) el.removeAttribute(GLOW);
    if (id) document.querySelector(`[data-testid="${id}"]`)?.setAttribute(GLOW, 'true');
  });
  useEffect(
    () => () => {
      for (const el of document.querySelectorAll(`[${GLOW}]`)) el.removeAttribute(GLOW);
    },
    [],
  );

  if (!step) return null;
  return (
    <>
      {step.finger && <div class="tutorial-finger" data-testid="tutorial-finger" data-step={step.no} aria-hidden="true" />}
      {step.text && (
        <div class="tutorial-bubble" data-testid="tutorial-bubble" data-step={step.no} role="status">
          <p class="tutorial-text">{t(step.text)}</p>
          <button type="button" class="tutorial-ok" data-testid="tutorial-ok" onClick={() => store.dispatch({ type: 'tutorial', step: step.no })}>
            {t('tutorial.ok')}
          </button>
        </div>
      )}
    </>
  );
}
