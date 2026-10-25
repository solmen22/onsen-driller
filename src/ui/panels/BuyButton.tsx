// 購入ボタン（gdd §11-3・Q-09・Q-17。BL-043）: 名前・レベル・効果・数・コスト・目安（足りないとき）・解放の条件（未解放のとき）。
// - data-state は buyQuote の state（affordable＝強調／insufficient＝「あと N 秒」／locked＝条件／maxed＝完了）
// - 未解放・完了は押せない（disabled）。足りないときは aria-disabled で押せるままにし、押すと core が断る（状態は変わらない）。
//   表示から押すまでの間にコインが増えて買えるようになっていれば、そのとき買える（買う数とコストは押した時点の buyQuote で決まる）
// - テストが読む値は data-*（data-n・data-cost・data-level、-eta の data-seconds・data-lack、-lock の data-depth）
// - 改良（T3）はレベルがないので -level を出さない。完了の文は buyView の doneText（改良は「購入済み」）
import type { ItemId, Qty } from '../../core/index.ts';
import { t, type Lang } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { buyView } from './buy-view.ts';
import { ToolPreview } from './ToolPreview.tsx';

export function BuyButton({ item, qty, lang }: { item: ItemId; qty: Qty; lang: Lang }) {
  const { store } = useUi();
  const v = useGame(
    (s) => buyView(s, item, qty, lang),
    (a, b) =>
      a.state === b.state &&
      a.n === b.n &&
      a.cost === b.cost &&
      a.level === b.level &&
      a.effectText === b.effectText &&
      a.eta?.text === b.eta?.text &&
      a.eta?.seconds === b.eta?.seconds &&
      a.name === b.name &&
      a.levelText === b.levelText &&
      a.costText === b.costText &&
      a.doneText === b.doneText,
  );
  const id = v.testId;
  const blocked = v.state === 'locked' || v.state === 'maxed';
  const previewId = item === 'tool' ? v.nextToolId : null;
  return (
    <button
      type="button"
      class={`row buy buy-${v.state}`}
      data-testid={id}
      data-state={v.state}
      data-n={v.n}
      data-cost={v.cost}
      data-level={v.level}
      disabled={blocked}
      aria-disabled={v.state !== 'affordable'}
      onClick={() => store.dispatch({ type: 'buy', item, qty: item === 'tool' ? 1 : qty })}
    >
      {previewId && <ToolPreview toolId={previewId} />}
      <span class="buy-main">
        <span class="buy-title">
          <span class="row-name" data-testid={`${id}-name`}>
            {v.name}
          </span>
          {v.levelText && (
            <small class="buy-level" data-testid={`${id}-level`}>
              {v.levelText}
            </small>
          )}
        </span>
        {v.effectText && (
          <span class="buy-effect" data-testid={`${id}-effect`}>
            {v.effectText}
          </span>
        )}
      </span>
      <span class="buy-side">
        {v.state === 'maxed' ? (
          <span class="buy-done" data-testid={`${id}-done`}>
            {v.doneText}
          </span>
        ) : (
          <span class="row-cost">
            {v.showQty && (
              <span class="buy-qty" data-testid={`${id}-qty`}>
                ×{v.n}{' '}
              </span>
            )}
            <span data-testid={`${id}-cost`}>{v.costText}</span>
          </span>
        )}
        {v.eta && (
          <span class="buy-eta" data-testid={`${id}-eta`} data-seconds={v.eta.seconds ?? undefined} data-lack={v.eta.lack}>
            {v.eta.text}
          </span>
        )}
        {v.unlockDepth !== null && (
          <span class="buy-lock" data-testid={`${id}-lock`} data-depth={v.unlockDepth}>
            {t('buy.unlockAt', { n: v.unlockDepth })}
          </span>
        )}
      </span>
    </button>
  );
}
