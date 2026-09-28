// UI（Preact・DOM）: HUD・タブ・購入の一覧（PoC は「掘る」「湯宿」「設定」だけ中身がある）
import { useState } from 'preact/hooks';
import { autoDigState, buyQuote, incomePerSec, nextTool, num, temperatureOf, type GameState, type LevelItem, type Qty } from '../core/index.ts';
import { TOOLS } from '../content/tools.ts';
import type { SpringId } from '../content/springs.ts';
import { getLang, setLang, t, type Lang, type TextKey } from '../i18n/index.ts';
import { formatNum } from './format.ts';
import { useGame, useUi } from './hooks/use-game.ts';

type Tab = 'dig' | 'onsen' | 'upgrades' | 'prestige' | 'menu';
const TABS: { id: Tab; key: TextKey; icon: string }[] = [
  { id: 'dig', key: 'tab.dig', icon: '⛏' },
  { id: 'onsen', key: 'tab.onsen', icon: '♨' },
  { id: 'upgrades', key: 'tab.upgrades', icon: '⚙' },
  { id: 'prestige', key: 'tab.prestige', icon: '✿' },
  { id: 'menu', key: 'tab.menu', icon: '≡' },
];

function Hud({ lang }: { lang: Lang }) {
  const v = useGame((s) => ({
    coins: formatNum(s.run.coins, lang),
    perSec: formatNum(incomePerSec(s), lang),
    depth: s.run.depth,
    maxDepth: s.run.maxDepth,
    temp: temperatureOf(s),
    hits: s.stats.hits,
  }));
  return (
    <div class="hud" data-testid="hud">
      <div class="hud-box">
        <div class="hud-coins" data-testid="hud-coins">
          <span class="coin-icon" aria-hidden="true" /> {v.coins}
        </div>
        <div class="hud-sub">
          +{v.perSec} {t('hud.perSec')} · {t('hud.depth')} <span data-testid="hud-depth">{v.depth}m</span>{' '}
          <span data-testid="hud-temp">{v.temp}℃</span>
        </div>
      </div>
      {v.hits === 0 && <div class="hint">{t('hud.tapHint')}</div>}
    </div>
  );
}

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
  const { store } = useUi();
  const v = useGame((s) => ({ drill: s.run.drill.level, auto: s.run.autoDig.level, dig: autoDigState(s) }));
  const on = v.dig === 'on';
  return (
    <div class="list">
      <ToolRow lang={lang} />
      <BuyRow item="drill" label={t('item.drill')} level={v.drill} qty={qty} lang={lang} />
      <BuyRow item="autoDigger" label={t('item.autoDigger')} level={v.auto} qty={qty} lang={lang} />
      <button
        class="row toggle"
        data-testid="toggle-auto-dig"
        data-state={v.dig}
        aria-pressed={on}
        disabled={v.dig === 'locked'}
        onClick={() => store.dispatch({ type: 'setAutoDig', on: !on })}
      >
        <span class="row-name">{t('item.autoDig')}</span>
        <span class="row-cost">{v.dig === 'locked' ? t('buy.locked') : on ? t('state.on') : t('state.off')}</span>
      </button>
    </div>
  );
}

function OnsenTab({ qty, lang }: { qty: Qty; lang: Lang }) {
  const v = useGame((s: GameState) => ({
    bath: s.run.bath.level,
    slots: s.run.bath.slots.join(','),
    springs: Object.entries(s.run.springs)
      .map(([id, sp]) => `${id}:${sp?.pump ?? 0}`)
      .join(','),
  }));
  const springs = v.springs ? v.springs.split(',').map((x) => x.split(':') as [SpringId, string]) : [];
  return (
    <div class="list">
      <div class="slots" data-testid="slots">
        <span>{t('slot.title')}:</span>
        {v.slots.split(',').map((id, i) => (
          <span class="slot" key={i}>
            {id ? t(`spring.${id}` as TextKey) : t('slot.empty')}
          </span>
        ))}
      </div>
      <BuyRow item="bath" label={t('item.bath')} level={v.bath} qty={qty} lang={lang} />
      {springs.length === 0 && <p class="note">{t('onsen.none')}</p>}
      {springs.map(([id, lv]) => (
        <BuyRow key={id} item={`pump:${id}`} label={`${t('item.pump')}: ${t(`spring.${id}` as TextKey)}`} level={Number(lv)} qty={qty} lang={lang} />
      ))}
    </div>
  );
}

function MenuTab({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const { platform, version } = useUi();
  return (
    <div class="list">
      <button class="row" data-testid="lang-toggle" onClick={() => onLang(lang === 'ja' ? 'en' : 'ja')}>
        <span class="row-name">{t('menu.lang')}</span>
        <span class="row-cost">{lang === 'ja' ? '日本語' : 'English'}</span>
      </button>
      <p class="note">
        {t('menu.version')}: {version} · {t('menu.target')}: {platform.target}
      </p>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>('dig');
  const [qty, setQty] = useState<Qty>(1);
  const [lang, setLangState] = useState<Lang>(getLang());
  const onLang = (l: Lang): void => {
    setLang(l);
    setLangState(l);
  };
  return (
    <>
      <Hud lang={lang} />
      <section class="panel" data-testid="panel">
        <nav class="tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} role="tab" class="tab" aria-selected={tab === x.id} data-testid={`tab-${x.id}`} onClick={() => setTab(x.id)}>
              <span aria-hidden="true">{x.icon}</span>
              <span class="tab-label">{t(x.key)}</span>
            </button>
          ))}
        </nav>
        <div class="panel-body">
          {(tab === 'dig' || tab === 'onsen') && (
            <div class="qty" role="group">
              {([1, 10, 'max'] as Qty[]).map((q) => (
                <button key={String(q)} class="qty-btn" aria-pressed={qty === q} data-testid={`qty-${q}`} onClick={() => setQty(q)}>
                  {q === 'max' ? t('buy.max') : `×${q}`}
                </button>
              ))}
            </div>
          )}
          {tab === 'dig' && <DigTab qty={qty} lang={lang} />}
          {tab === 'onsen' && <OnsenTab qty={qty} lang={lang} />}
          {tab === 'upgrades' && <p class="note">{t('upgrades.soon')}</p>}
          {tab === 'prestige' && <p class="note">{t('prestige.soon')}</p>}
          {tab === 'menu' && <MenuTab lang={lang} onLang={onLang} />}
        </div>
      </section>
    </>
  );
}
