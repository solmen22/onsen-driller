// UI（Preact・DOM。arch §15・gdd §11-1）: HUD の帯・キャンバスの下端のボタン（BL-042）、タブと一覧（BL-043）
// - 縦・横の配置は styles/global.css（#app の data-layout。判定は ui/layout.ts の layoutOf）
// - タブは 5 つ（tab-1〜tab-5。クリックか 1〜5 キー）。中身があるのは T1・T2・T3（BL-044）・T4・T5（BL-045）
// - 湯宿の「！」（BL-044。Q-38 (b)）: SpringFound のたびに（T2 を開いていないとき）立て、T2 を開いたら消す。保存しない（メモリだけ）
// - 改良の「！」（BL-044 の T3。CEO 2026-10-18）: 新しい改良が解放されたとき（T3 を開いていないとき）に立て、T3 を開いたら消す。T2 と同じく保存しない。
//   core にイベントがないので（core は変えない。TS-044-18）、解放済みの改良の集合（upgradeViews）が前の通知より増えたことで決める。
//   起動・読み込みの直後の集合は「前」として覚えるだけで、立てない。転生で戻った後にまた解放されたら立てる
// - 転生の印（BL-045。Q-47 (g)）: その周回で初めて転生の推奨に届いたら（T4 を開いていないとき）tab-4 に「！」と別の色の点を出し、
//   T4 を開いたら消す。保存しない（メモリだけ）。起動・読み込みの直後に推奨のままなら出す（読み直したら出し直す）。
//   セーブ全体で初めて 150m に届いたときの「！」は BL-049・050
// - 購入数（×1 → ×10 → 最大）は切り替えボタン（qty-toggle）か Shift。タブをまたいで共通で、保存しない（再読み込みで ×1）
// - ご褒美のシート（R2: ブーストのボタン、R3: 鉱脈のチップ）とトースト（BL-046）。モーダル・シートの表示中は 1〜5・Shift を使わない
import { useEffect, useRef, useState } from 'preact/hooks';
import { offlineClaimView, prestigeView, upgradeViews, type Qty } from '../core/index.ts';
import { getLang, resolveLang, setLang, t, type Lang, type TextKey } from '../i18n/index.ts';
import { formatNum } from './format.ts';
import { useGame, useUi } from './hooks/use-game.ts';
import { Hud } from './hud/Hud.tsx';
import { StageActions } from './hud/StageActions.tsx';
import { keyCommand, nextQty, type TabNo } from './keys.ts';
import { isModalOpen } from './overlay/modal-state.ts';
import { RewardSheet } from './overlay/RewardSheet.tsx';
import { Toasts } from './overlay/Toasts.tsx';
import { WelcomeModal, type WelcomeChoice } from './overlay/WelcomeModal.tsx';
import { EndingCard } from './overlay/EndingCard.tsx';
import { endingCardClosed, isEndingCardRequested, onEndingCardRequest } from './overlay/ending-card.ts';
import { DigPanel } from './panels/DigPanel.tsx';
import { InnPanel } from './panels/InnPanel.tsx';
import { MenuPanel } from './panels/MenuPanel.tsx';
import { PrestigePanel } from './panels/PrestigePanel.tsx';
import { UpgradesPanel } from './panels/UpgradesPanel.tsx';

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
  const { onLangChange, rewards, store, settings, platform } = useUi();
  const [tab, setTabState] = useState<TabNo>(1);
  const [innAlert, setInnAlert] = useState(false);
  const [upgradeAlert, setUpgradeAlert] = useState(false);
  const [prestigeDot, setPrestigeDot] = useState(false);
  const tabRef = useRef<TabNo>(1);
  const setTab = (n: TabNo): void => {
    tabRef.current = n;
    setTabState(n);
    if (n === 2) setInnAlert(false); // T2 を開いたら消す
    if (n === 3) setUpgradeAlert(false); // T3 を開いたら消す
    if (n === 4) setPrestigeDot(false); // T4 を開いたら消す
  };
  const [qty, setQty] = useState<Qty>(1);
  const [lang, setLangState] = useState<Lang>(getLang());
  const [sheet, setSheet] = useState<'R2' | 'R3' | null>(null);
  // エンディングのカード（BL-023）: app の ad-flow が出すと決めたら出す。おかえりが出ている間は、閉じた後に出す（Q-55 (d)）
  const [ending, setEnding] = useState(isEndingCardRequested);
  useEffect(() => onEndingCardRequest(setEnding), []);
  // おかえり（R1）: 未受け取りのオフライン収入があれば出す（core の offlineClaimView。付けるのは S3 の BL-030）。
  // 受け取りの口（rewards）がない間は出さない（受け取れないモーダルを出さない）
  const welcome = useGame((s) => {
    const w = offlineClaimView(s);
    return w ? { amount: formatNum(w.coins, lang), canDouble: w.canDouble } : null;
  });
  // 鉱脈のシート（R3）が鉱脈が開いた・消えたときに閉じるのは RewardSheet の中（要求中は閉じない。PR #55 のレビュー S-5）
  /**
   * おかえりの受け取り。受け取れたら true（モーダルは pendingOffline が null になって消える）。
   * 'video' の ×2 は requestReward('R1') が rewarded のときに grantAd('R1') が付けている（BL-059）。
   * ×2 が付かなかったら（チケットの不足・core が断った・動画の報酬が断られた）×1 で受け取る。受け取れずに閉じられない
   * モーダルを残さない（PR #55 のレビュー S-4。放置の報酬を人質にしない）
   */
  const onWelcome = (c: WelcomeChoice): boolean => {
    if (!rewards) return false;
    if (c === 'ticket') rewards.claimOffline('double');
    if (store.state.run.pendingOffline !== null) rewards.claimOffline('normal');
    return store.state.run.pendingOffline === null;
  };
  const onLang = (l: Lang): void => {
    setLang(l);
    setLangState(l);
    onLangChange?.(l);
  };
  // 端末の言語に合わせる（設定は auto。判定は resolveLang の 1 か所）
  const onLangAuto = (): void => {
    settings?.set({ lang: 'auto' });
    const l = resolveLang('auto', platform.locale());
    setLang(l);
    setLangState(l);
    setRev((x) => x + 1);
  };
  // 設定を変えたら全体を描き直す（数値の表記は HUD・一覧の数に効く）
  const [, setRev] = useState(0);

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

  // 新しい改良の解放で改良のタブに「！」（T3 を開いていないとき）。解放済み（購入済みを含む）の ID の並びで比べる
  const unlockedUpgrades = useGame(
    (s) => upgradeViews(s).map((v) => v.id).join(','),
    (a, b) => a === b,
  );
  const seenUpgrades = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = unlockedUpgrades === '' ? [] : unlockedUpgrades.split(',');
    const prev = seenUpgrades.current;
    seenUpgrades.current = new Set(ids);
    if (prev === null) return; // 起動・読み込みの直後は覚えるだけ
    if (tabRef.current !== 3 && ids.some((id) => !prev.has(id))) setUpgradeAlert(true);
  }, [unlockedUpgrades]);

  // 転生の推奨に届いたら tab-4 に点（その周回で 1 回。周回は転生の回数で見分ける。Q-47 (g)）
  const recommendedRun = useGame((s) => (prestigeView(s).recommended ? s.meta.prestiges : -1));
  const dotRun = useRef(-1);
  useEffect(() => {
    if (recommendedRun < 0 || dotRun.current === recommendedRun) return;
    dotRun.current = recommendedRun;
    if (tabRef.current !== 4) setPrestigeDot(true);
  }, [recommendedRun]);

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
              data-alert={(x.no === 2 && innAlert) || (x.no === 3 && upgradeAlert) ? 'true' : undefined}
              title={`${t(x.key)} (${x.no})`}
              onClick={() => setTab(x.no)}
            >
              <span aria-hidden="true">{x.icon}</span>
              <span class="tab-label">{t(x.key)}</span>
              {((x.no === 2 && innAlert) || (x.no === 3 && upgradeAlert)) && (
                <span class="tab-alert" role="img" aria-label={t('ui.tabAlert')}>
                  {t('ui.tabAlertMark')}
                </span>
              )}
              {x.no === 4 && prestigeDot && <span class="tab-dot" data-testid="tab-4-dot" role="img" aria-label={t('prestige.dot')} />}
            </button>
          ))}
        </nav>
        <div class="panel-body" role="tabpanel">
          {BUY_TABS.includes(tab) && <QtyToggle qty={qty} onNext={() => setQty(nextQty)} />}
          {tab === 1 ? (
            <DigPanel qty={qty} lang={lang} />
          ) : tab === 2 ? (
            <InnPanel qty={qty} lang={lang} />
          ) : tab === 3 ? (
            <UpgradesPanel lang={lang} />
          ) : tab === 4 ? (
            <PrestigePanel lang={lang} />
          ) : (
            <MenuPanel lang={lang} onLang={onLang} onLangAuto={onLangAuto} onChanged={() => setRev((x) => x + 1)} />
          )}
        </div>
      </section>
      <Toasts />
      {sheet !== null && <RewardSheet key={sheet} placement={sheet} onClose={() => setSheet(null)} />}
      {welcome !== null && rewards !== undefined && sheet === null && (
        <WelcomeModal amount={welcome.amount} canDouble={welcome.canDouble} ticketHook onClaim={onWelcome} />
      )}
      {ending && (welcome === null || rewards === undefined) && <EndingCard onSkip={endingCardClosed} />}
    </>
  );
}
