// T2「湯宿」（gdd §6・§11-2。BL-044）: 湯船の枠・源泉とポンプ・湯船のレベル・お客さんの一覧と来訪条件
// - 入れ替え（Q-38 (d)）: 源泉を押して選ぶ（aria-pressed）→ 枠を押すと assignSlot。取り消しは Esc・同じ源泉をもう一度・タブの切り替え（部品が消える）。
//   源泉を選ばずに枠を押しても何もしない。枠を空きにする操作は置かない
// - UI は状態を読むだけで、変えるのは store.dispatch（assignSlot・buy）だけ（TS-044-18）
// - 30m の前（源泉なし）は中身を出さず、案内だけ（data-state="locked"。Q-38 (b)）
import { useEffect, useState } from 'preact/hooks';
import type { SpringId } from '../../content/springs.ts';
import type { Qty } from '../../core/index.ts';
import { t, type Lang } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { BuyButton } from './BuyButton.tsx';
import { innView, sameInn } from './inn-view.ts';

export function InnPanel({ qty, lang }: { qty: Qty; lang: Lang }) {
  const { store } = useUi();
  const v = useGame((s) => innView(s, lang), sameInn);
  const [sel, setSel] = useState<SpringId | null>(null);

  // Esc で選択を取り消す
  useEffect(() => {
    if (sel === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  if (!v.unlocked) {
    return (
      <div class="list" data-testid="panel-inn" data-state="locked">
        <p class="note" data-testid="inn-locked">
          {t('ui.innLocked')}
        </p>
      </div>
    );
  }

  const onSlot = (slot: number): void => {
    if (sel === null) return; // 選ばずに枠を押しても何もしない
    store.dispatch({ type: 'assignSlot', slot, spring: sel });
    setSel(null);
  };

  return (
    <div class="list" data-testid="panel-inn" data-state="open">
      <h3 class="inn-head">{t('slot.title')}</h3>
      {v.slots.map((x) => (
        <button
          key={x.slot}
          type="button"
          class={`row inn-slot${sel !== null ? ' inn-target' : ''}`}
          data-testid={`inn-slot-${x.slot}`}
          data-spring={x.spring}
          aria-disabled={sel === null}
          onClick={() => onSlot(x.slot)}
        >
          <span class="buy-main">
            <span class="row-name">
              {t('inn.slotNo', { n: x.slot + 1 })} <small>{x.name}</small>
            </span>
            {x.effect && <span class="buy-effect">{x.effect}</span>}
          </span>
          {x.income && <span class="row-cost">{x.income}</span>}
        </button>
      ))}
      <p class="note" data-testid="inn-hint" role="status">
        {sel === null ? t('inn.hintSelect') : t('inn.hintSlot', { spring: v.springs.find((x) => x.id === sel)?.name ?? '' })}
      </p>

      <h3 class="inn-head">{t('inn.springs')}</h3>
      {v.springs.map((x) =>
        x.found ? (
          <div key={x.id} class="inn-spring">
            <button
              type="button"
              class="row inn-pick"
              data-testid={`inn-spring-${x.id}`}
              data-found="true"
              data-slot={x.slot ?? undefined}
              aria-pressed={sel === x.id}
              onClick={() => setSel(sel === x.id ? null : x.id)}
            >
              <span class="buy-main">
                <span class="row-name">
                  {x.name} <small>{x.sub}</small>
                </span>
                <span class="buy-effect">{x.effect}</span>
              </span>
              <span class="row-cost">{x.slot === null ? t('inn.notConnected') : t('inn.inSlot', { n: x.slot + 1 })}</span>
            </button>
            <BuyButton item={`pump:${x.id}`} qty={qty} lang={lang} />
          </div>
        ) : (
          <div key={x.id} class="row inn-spring-unfound" data-testid={`inn-spring-${x.id}`} data-found="false">
            <span class="row-name">
              {x.name} <small>{x.sub}</small>
            </span>
          </div>
        ),
      )}

      <h3 class="inn-head">{t('item.bath')}</h3>
      <p class="note" data-testid="inn-bath" data-level={v.bath.level} data-slots={v.bath.slotCount} data-next-slot={v.bath.nextSlotLevel ?? undefined}>
        {t('buy.level', { n: v.bath.level })}
        {t('effect.sep')}
        {v.bath.bonusText}
        {v.bath.nextSlotText !== null && (
          <>
            {t('effect.sep')}
            {v.bath.nextSlotText}
          </>
        )}
      </p>
      <BuyButton item="bath" qty={qty} lang={lang} />

      <h3 class="inn-head">{t('inn.guests')}</h3>
      {v.guests.map((g) => (
        <div key={g.id} class="row inn-guest" data-testid={`inn-guest-${g.id}`} data-present={String(g.present)} data-state={g.state}>
          <span class="buy-main">
            <span class="row-name">
              {g.name} <small>{g.condition}</small>
            </span>
            <span class="buy-effect">{g.effect}</span>
          </span>
          <span class="row-cost" data-testid={`inn-guest-${g.id}-state`}>
            {g.stateText}
          </span>
        </div>
      ))}
    </div>
  );
}
