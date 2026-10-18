// T3「改良」（gdd §5-7・§11-2。BL-044 の T3。Q-38 (c)・(e)）: まだ買っていない改良を上、買った改良を下に、内容定義の順で並べる
// - 行は BuyButton（名前・効果・コスト・足りないときの「あと N 秒」。表示と購入は同じ buyQuote）。購入数は出さない（一度きり。qty は 1 固定）
// - 未解放の改良は行を出さず、「次の改良」（名前・効果・条件と今の進み）を 1 行だけ出す。1 つも解放されていなければ upgrades-empty
// - UI は状態を読むだけで、変えるのは BuyButton の store.dispatch（buy）だけ（TS-044-18）
import { t, type Lang } from '../../i18n/index.ts';
import { useGame } from '../hooks/use-game.ts';
import { BuyButton } from './BuyButton.tsx';
import { sameUpgrades, upgradesView, type NextUpgrade } from './upgrades-view.ts';

function NextLine({ next, testId }: { next: NextUpgrade; testId: string }) {
  return (
    <p
      class="note upgrades-next"
      data-testid={testId}
      data-id={next.id}
      data-kind={next.kind}
      data-target={next.target}
      data-current={next.current}
    >
      <span class="upgrades-next-head">{t('upgrades.next', { name: next.name })}</span>
      <span class="upgrades-next-effect">{next.effect}</span>
      <span class="upgrades-next-cond">{next.condition}</span>
    </p>
  );
}

export function UpgradesPanel({ lang }: { lang: Lang }) {
  const v = useGame((s) => upgradesView(s), sameUpgrades);
  const empty = v.available.length === 0 && v.bought.length === 0;
  return (
    <div class="list" data-testid="panel-upgrades" data-state={empty ? 'empty' : 'open'}>
      <p class="note upgrades-intro">{t('upgrades.intro')}</p>
      {empty ? (
        v.next && <NextLine next={v.next} testId="upgrades-empty" />
      ) : (
        <>
          <h3 class="inn-head">{t('upgrades.available')}</h3>
          <div class="upgrades-group" data-testid="upgrades-available" data-count={v.available.length}>
            {v.available.length === 0 ? (
              <p class="note">{t('upgrades.noneAvailable')}</p>
            ) : (
              v.available.map((id) => <BuyButton key={id} item={`upgrade:${id}`} qty={1} lang={lang} />)
            )}
          </div>
          {v.next && <NextLine next={v.next} testId="upgrades-next" />}
          {v.bought.length > 0 && (
            <>
              <h3 class="inn-head">{t('upgrades.boughtHead')}</h3>
              <div class="upgrades-group" data-testid="upgrades-bought" data-count={v.bought.length}>
                {v.bought.map((id) => (
                  <BuyButton key={id} item={`upgrade:${id}`} qty={1} lang={lang} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
