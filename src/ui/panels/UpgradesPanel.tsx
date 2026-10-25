// T3「改良」（gdd §5-7・§11-2。BL-044 の T3。Q-38 (c)・(e)）: まだ買っていない改良を上、買った改良を下に、内容定義の順で並べる
// - 行は BuyButton（名前・効果・コスト・足りないときの「あと N 秒」。表示と購入は同じ buyQuote）。購入数は出さない（一度きり。qty は 1 固定）
// - 未解放の改良は行を出さず、「次の改良」（名前・効果・条件と今の進み）を 1 行だけ出す。1 つも解放されていなければ upgrades-empty
// - UI は状態を読むだけで、変えるのは BuyButton の store.dispatch（buy）だけ（TS-044-18）
// - 開いている間は、買った行をその位置のまま「購入済み」にする（組の入れ替えは次に T3 を開いたとき。連打で、指の下に来た別の改良を
//   買わないように。CEO 決定 2026-10-18〔PR #72 のレビューの H-1 の案 a〕）。行が動くのは解放のときだけ
// - 冒頭の説明は、T3 を開いた時点でまだ 1 つも買っていないとき（解放 0 のときを含む）だけ出す（H-2）。開いている間に最初の 1 つを
//   買っても消さない（消すと下の行が上に詰まり、2 回目のタップが次の改良に当たる。PR #72 の再レビューの Must・Q-51 の CEO 決定）。
//   消えるのは次に T3 を開いたとき
import { useRef } from 'preact/hooks';
import { UPGRADES, type UpgradeId } from '../../content/upgrades.ts';
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
      data-unfound={next.kind === 'pump' ? String(next.unfound) : undefined}
    >
      <span class="upgrades-next-head">{t('upgrades.next', { name: next.name })}</span>
      <span class="upgrades-next-effect">{next.effect}</span>
      <span class="upgrades-next-cond">{next.condition}</span>
    </p>
  );
}

export function UpgradesPanel({ lang }: { lang: Lang }) {
  const v = useGame((s) => upgradesView(s), sameUpgrades);
  // 開いた時点で買ってあった改良（この組だけを下に出す。開いている間に買ったものは上の組の同じ位置に残る）
  const boughtAtOpen = useRef<ReadonlySet<UpgradeId> | null>(null);
  if (boughtAtOpen.current === null) boughtAtOpen.current = new Set(v.bought);
  const bought = new Set(v.bought);
  const shownBought = UPGRADES.map((u) => u.id).filter((id) => bought.has(id) && boughtAtOpen.current!.has(id));
  const shownAvailable = UPGRADES.map((u) => u.id).filter((id) => (v.available.includes(id) || bought.has(id)) && !shownBought.includes(id));
  const empty = shownAvailable.length === 0 && shownBought.length === 0;
  return (
    <div class="list" data-testid="panel-upgrades" data-state={empty ? 'empty' : 'open'}>
      {boughtAtOpen.current.size === 0 && (
        <p class="note upgrades-intro" data-testid="upgrades-intro">
          {t('upgrades.intro')}
        </p>
      )}
      {empty ? (
        v.next && <NextLine next={v.next} testId="upgrades-empty" />
      ) : (
        <>
          <h3 class="inn-head">{t('upgrades.available')}</h3>
          <div class="upgrades-group" data-testid="upgrades-available" data-count={shownAvailable.length}>
            {shownAvailable.length === 0 ? (
              <p class="note" data-testid="upgrades-none">
                {t(v.next ? 'upgrades.noneAvailable' : 'upgrades.allBought')}
              </p>
            ) : (
              shownAvailable.map((id) => <BuyButton key={id} item={`upgrade:${id}`} qty={1} lang={lang} />)
            )}
          </div>
          {v.next && <NextLine next={v.next} testId="upgrades-next" />}
          {shownBought.length > 0 && (
            <>
              <h3 class="inn-head">{t('upgrades.boughtHead')}</h3>
              <div class="upgrades-group" data-testid="upgrades-bought" data-count={shownBought.length}>
                {shownBought.map((id) => (
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
