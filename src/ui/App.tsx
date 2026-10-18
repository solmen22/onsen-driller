// UI（Preact・DOM。arch §15・gdd §11-1）: HUD の帯・キャンバスの下端のボタン（BL-042）、タブと一覧（BL-043）
// - 縦・横の配置は styles/global.css（#app の data-layout。判定は ui/layout.ts の layoutOf）
// - タブは 5 つ（tab-1〜tab-5。クリックか 1〜5 キー）。中身があるのは T1・T2（BL-044）で、T3〜T5 は「準備中」（panel-placeholder。Q-09）
// - 湯宿の「！」（BL-044。Q-38 (b)）: SpringFound のたびに（T2 を開いていないとき）立て、T2 を開いたら消す。保存しない（メモリだけ）
// - 購入数（×1 → ×10 → 最大）は切り替えボタン（qty-toggle）か Shift。タブをまたいで共通で、保存しない（再読み込みで ×1）
// - ご褒美のシート（R2: ブーストのボタン、R3: 鉱脈のチップ）とトースト（BL-046）。モーダル・シートの表示中は 1〜5・Shift を使わない
import { useEffect, useRef, useState } from 'preact/hooks';
import { offlineClaimView, veinView, type Qty } from '../core/index.ts';
import { getLang, setLang, t, type Lang, type TextKey } from '../i18n/index.ts';
import { formatNum } from './format.ts';
import { useGame, useUi } from './hooks/use-game.ts';
import { Hud } from './hud/Hud.tsx';
import { StageActions } from './hud/StageActions.tsx';
import { keyCommand, nextQty, type TabNo } from './keys.ts';
import { isModalOpen } from './overlay/modal-state.ts';
import { RewardSheet } from './overlay/RewardSheet.tsx';
import { Toasts } from './overlay/Toasts.tsx';
import { WelcomeModal, type WelcomeChoice } from './overlay/WelcomeModal.tsx';
import { DigPanel } from './panels/DigPanel.tsx';
import { InnPanel } from './panels/InnPanel.tsx';

export type { TabNo } from './keys.ts';

/** タブ（1＝掘る・2＝湯宿・3＝改良・4＝転生・5＝≡。data-testid は tab-<番号>。Q-17） */
export const TABS: readonly { no: TabNo; key: TextKey; icon: string }[] = [
  { no: 1, key: 'tab.dig', icon: '⛏' },
  { no: 2, key: 'tab.onsen', icon: '♨' },
  { no: 3, key: 'tab.upgrades', icon: '⚙' },
  { no: 4, key: 'tab.prestige', icon: '✿' },
  { no: 5, key: 'tab.menu', icon: '≡' },
];

/** 購入の一覧があるタブ（購入数の切り替えを出す。T3 には出さない。Q-38 (e)） */
const BUY_TABS: readonly TabNo[] = [1, 2];

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
            <span class="row-cost">{t(lang === 'ja' ? 'ui.langName.ja' : 'ui.langName.en')}</span>
          </button>
          <p class="note">
            {t('menu.version')}: {version} · {t('menu.target')}: {platform.target}
          </p>
        </>
      )}
    </div>
  );
}

/** 購入数の切り替えボタン（×1 → ×10 → 最大 → ×1。data-qty に今の値） */
function QtyToggle({ qty, onNext }: { qty: Qty; onNext: () => void }) {
  return (
    <button type="button" class="qty-btn" data-testid="qty-toggle" data-qty={String(qty)} aria-label={t('buy.qty')} title={t('buy.qty')} onClick={onNext}>
      <span class="qty-label">{t('buy.qty')}</span>
      <span class="qty-value">{qty === 'max' ? t('buy.max') : `×${qty}`}</span>
    </button>
  );
}

export function App() {
  const { onLangChange, rewards, store } = useUi();
  const [tab, setTabState] = useState<TabNo>(1);
  const [innAlert, setInnAlert] = useState(false);
  const tabRef = useRef<TabNo>(1);
  const setTab = (n: TabNo): void => {
    tabRef.current = n;
    setTabState(n);
    if (n === 2) setInnAlert(false); // T2 を開いたら消す
  };
  const [qty, setQty] = useState<Qty>(1);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [sheet, setSheet] = useState<'R2' | 'R3' | null>(null);
  // おかえり（R1）: 未受け取りのオフライン収入があれば出す（core の offlineClaimView。付けるのは S3 の BL-030）。
  // 受け取りの口（rewards）がない間は出さない（受け取れないモーダルを出さない）
  const welcome = useGame((s) => {
    const w = offlineClaimView(s);
    return w ? { amount: formatNum(w.coins, lang), canDouble: w.canDouble } : null;
  });
  const veinActive = useGame((s) => veinView(s).active);
  // 鉱脈のシート（R3）は、鉱脈が開いた・消えたら閉じる（押しても何も起きないシートを残さない）
  useEffect(() => {
    if (sheet === 'R3' && !veinActive) setSheet(null);
  }, [sheet, veinActive]);
  const onWelcome = (c: WelcomeChoice): void => {
    // 'video' の ×2 は requestReward('R1') が rewarded のときに grantAd('R1') が付けている（BL-059）。ここでは何もしない
    if (c === 'claim') rewards?.claimOffline('normal');
    else if (c === 'ticket') rewards?.claimOffline('double');
  };
  const onLang = (l: Lang): void => {
    setLang(l);
    setLangState(l);
    onLangChange?.(l);
  };

  // キー操作（1〜5 でタブ、Shift で購入数）。Space・矢印は app/input.ts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isModalOpen()) return; // 表示中は後ろの画面を変えない（Q-37 (e)）
      const c = keyCommand(e);
      if (c?.kind === 'tab') setTab(c.tab);
      else if (c?.kind === 'cycleQty') setQty(nextQty);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 源泉の発見で湯宿のタブに「！」（T2 を開いていないとき）
  useEffect(
    () =>
      store.onEvents((evs) => {
        if (tabRef.current !== 2 && evs.some((e) => e.type === 'SpringFound')) setInnAlert(true);
      }),
    [store],
  );

  return (
    <>
      <Hud lang={lang} onSettings={() => setTab(5)} onVein={() => setSheet('R3')} />
      <StageActions onBoost={() => setSheet('R2')} />
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
              data-alert={x.no === 2 && innAlert ? 'true' : undefined}
              title={`${t(x.key)} (${x.no})`}
              onClick={() => setTab(x.no)}
            >
              <span aria-hidden="true">{x.icon}</span>
              <span class="tab-label">{t(x.key)}</span>
              {x.no === 2 && innAlert && (
                <span class="tab-alert" role="img" aria-label={t('ui.tabAlert')}>
                  {t('ui.tabAlertMark')}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div class="panel-body" role="tabpanel">
          {BUY_TABS.includes(tab) && <QtyToggle qty={qty} onNext={() => setQty(nextQty)} />}
          {tab === 1 ? (
            <DigPanel qty={qty} lang={lang} />
          ) : tab === 2 ? (
            <InnPanel qty={qty} lang={lang} />
          ) : (
            <Placeholder tab={tab} lang={lang} onLang={onLang} />
          )}
        </div>
      </section>
      <Toasts />
      {sheet !== null && <RewardSheet key={sheet} placement={sheet} onClose={() => setSheet(null)} />}
      {welcome !== null && rewards !== undefined && sheet === null && (
        <WelcomeModal amount={welcome.amount} canDouble={welcome.canDouble} ticketHook onClaim={onWelcome} />
      )}
    </>
  );
}
