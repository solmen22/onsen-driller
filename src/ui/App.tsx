// UI（Preact・DOM。arch §15・gdd §11-1）: HUD の帯・キャンバスの下端のボタン・タブと一覧（BL-042）
// - 縦・横の配置は styles/global.css（#app の data-layout。判定は ui/layout.ts の layoutOf）
// - タブは 5 つ（tab-1〜tab-5）。S1 で中身があるのは T1 だけで、T2〜T5 は「準備中」（panel-placeholder。Q-09）
import { useState } from 'preact/hooks';
import { buyQuote, nextTool, num, type LevelItem, type Qty } from '../core/index.ts';
import { TOOLS } from '../content/tools.ts';
import { getLang, setLang, t, type Lang, type TextKey } from '../i18n/index.ts';
import { formatNum } from './format.ts';
import { useGame, useUi } from './hooks/use-game.ts';
import { Hud } from './hud/Hud.tsx';
import { StageActions } from './hud/StageActions.tsx';

/** タブの番号（1＝掘る・2＝湯宿・3＝改良・4＝転生・5＝≡。data-testid は tab-<番号>。Q-17） */
export type TabNo = 1 | 2 | 3 | 4 | 5;
export const TABS: readonly { no: TabNo; key: TextKey; icon: string }[] = [
  { no: 1, key: 'tab.dig', icon: '⛏' },
  { no: 2, key: 'tab.onsen', icon: '♨' },
  { no: 3, key: 'tab.upgrades', icon: '⚙' },
  { no: 4, key: 'tab.prestige', icon: '✿' },
  { no: 5, key: 'tab.menu', icon: '≡' },
];

function BuyRow(props: { item: LevelItem; label: string; level: number; qty: Qty; lang: Lang }) {
  const { store } = useUi();
  const q = useGame((s) => {
    const r = buyQuote(s, props.item, props.qty);
    // 「最大」で 1 個も買えないときは ×0・0 コインではなく次の 1 個のコストを出す（Q-09）
    const cost = r.n > 0 ? r.cost : r.nextCost;
    return r.state === 'locked' ? null : { n: r.n, cost: formatNum(cost, props.lang), ok: r.state === 'affordable', state: r.state };
  });
  if (!q) return null;
  return (
    <button
      class={`row ${q.ok ? 'ok' : 'ng'}`}
      data-testid={`buy-${props.item.replace(':', '-')}`}
      data-state={q.state}
      aria-disabled={!q.ok}
      onClick={() => store.dispatch({ type: 'buy', item: props.item, qty: props.qty })}
    >
      <span class="row-name">
        {props.label} <small>{t('buy.level', { n: props.level })}</small>
      </span>
      <span class="row-cost">
        {props.qty !== 1 && q.n > 0 && `×${q.n} `}
        {t('buy.cost', { cost: q.cost })}
      </span>
    </button>
  );
}

function ToolRow({ lang }: { lang: Lang }) {
  const { store } = useUi();
  const v = useGame((s) => {
    const cur = TOOLS[s.run.drill.tool];
    const nt = nextTool(s);
    const future = TOOLS[s.run.drill.tool + 1];
    return {
      cur: cur?.id ?? 'shovel',
      next: nt?.id ?? null,
      cost: nt ? formatNum(num(nt.cost), lang) : '',
      ok: nt ? s.run.coins.gte(nt.cost) : false,
      lockedAt: !nt && future ? future.unlockDepth : null,
    };
  });
  return (
    <button
      class={`row ${v.ok ? 'ok' : 'ng'}`}
      data-testid="buy-tool"
      aria-disabled={!v.ok}
      onClick={() => store.dispatch({ type: 'buy', item: 'tool', qty: 1 })}
    >
      <span class="row-name">
        {t('item.tool')} <small>{t(`tool.${v.cur}` as TextKey)}</small>
      </span>
      <span class="row-cost">
        {v.next ? `→ ${t(`tool.${v.next}` as TextKey)} ${t('buy.cost', { cost: v.cost })}` : v.lockedAt !== null ? `${t('buy.locked')} (${v.lockedAt}m)` : t('buy.maxed')}
      </span>
    </button>
  );
}

function DigTab({ qty, lang }: { qty: Qty; lang: Lang }) {
  const v = useGame((s) => ({ drill: s.run.drill.level, auto: s.run.autoDig.level }));
  return (
    <div class="list" data-testid="panel-dig">
      <ToolRow lang={lang} />
      <BuyRow item="drill" label={t('item.drill')} level={v.drill} qty={qty} lang={lang} />
      <BuyRow item="autoDigger" label={t('item.autoDigger')} level={v.auto} qty={qty} lang={lang} />
    </div>
  );
}

/** S1 で中身のないタブ（T2〜T5）の仮の表示（Q-09）。T5 だけ言語の切り替えと版を残す（設定の本体は S3 の BL-045） */
function Placeholder({ tab, lang, onLang }: { tab: TabNo; lang: Lang; onLang: (l: Lang) => void }) {
  const { platform, version } = useUi();
  return (
    <div class="list">
      <p class="note placeholder" data-testid="panel-placeholder">
        {t(TABS[tab - 1]?.key ?? 'tab.menu')}: {t('panel.soon')}
      </p>
      {tab === 5 && (
        <>
          <button class="row" type="button" data-testid="lang-toggle" onClick={() => onLang(lang === 'ja' ? 'en' : 'ja')}>
            <span class="row-name">{t('menu.lang')}</span>
            <span class="row-cost">{lang === 'ja' ? '日本語' : 'English'}</span>
          </button>
          <p class="note">
            {t('menu.version')}: {version} · {t('menu.target')}: {platform.target}
          </p>
        </>
      )}
    </div>
  );
}

export function App() {
  const { onLangChange } = useUi();
  const [tab, setTab] = useState<TabNo>(1);
  const [qty, setQty] = useState<Qty>(1);
  const [lang, setLangState] = useState<Lang>(getLang());
  const onLang = (l: Lang): void => {
    setLang(l);
    setLangState(l);
    onLangChange?.(l);
  };
  return (
    <>
      <Hud lang={lang} onSettings={() => setTab(5)} />
      <StageActions />
      <section class="panel" data-testid="panel">
        <nav class="tabs" role="tablist">
          {TABS.map((x) => (
            <button
              key={x.no}
              type="button"
              role="tab"
              class="tab"
              aria-selected={tab === x.no}
              data-testid={`tab-${x.no}`}
              onClick={() => setTab(x.no)}
            >
              <span aria-hidden="true">{x.icon}</span>
              <span class="tab-label">{t(x.key)}</span>
            </button>
          ))}
        </nav>
        <div class="panel-body" role="tabpanel">
          {tab === 1 && (
            <div class="qty" role="group">
              {([1, 10, 'max'] as Qty[]).map((q) => (
                <button key={String(q)} type="button" class="qty-btn" aria-pressed={qty === q} data-testid={`qty-${q}`} onClick={() => setQty(q)}>
                  {q === 'max' ? t('buy.max') : `×${q}`}
                </button>
              ))}
            </div>
          )}
          {tab === 1 ? <DigTab qty={qty} lang={lang} /> : <Placeholder tab={tab} lang={lang} onLang={onLang} />}
        </div>
      </section>
    </>
  );
}
