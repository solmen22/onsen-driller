// 転生の確認の画面（M3。gdd §5-8・§11-2。BL-045。Q-47 (d)(h)(j)(k)。TL-A の約束〔BL-021〕）
// - 2 段階: 1 段目は「得られるもの・なくなるもの・残るもの」・次の地形の選択（BL-024 の terrainChoices。初期は今の地形。testid は prestige-terrain・terrain-<id>〔data-state selected・selectable・locked〕、
//   選べない理由は文字で。新しく選べる地形の知らせは出さない。決定 0012 の追記 Q-54）・木の振り直し → 「次へ」（prestige-confirm-1）、2 段目は念押し →
//   「転生する」（prestige-confirm-2）。どちらの段でも「やめる」（prestige-cancel）・×・Esc・背景で取り消す（転生しない）
// - 開いている間は止める（ループ・gameplay。理由 'prestige'）: 開く側（PrestigePanel）が押したその場で openPrestigeConfirm を呼び、
//   返された閉じる関数を close で渡す。ここは閉じるときにそれを呼ぶ（unmount のときも念のため呼ぶ。2 回呼んでも 1 回と数える）
// - **確定は「dispatch({type:'prestige'}) → 閉じる関数」の順**（TS-021-45。M1 の 'break' が先に立ち、gameplay の合図が往復しない）
// - タブが隠れたら app が dismissPrestigeConfirm を呼び、onDismiss（開くときに渡したもの）で PrestigePanel がこの画面を消す。
//   戻ったら開き直したときの値を見せる（決定 0010 の 14 (b)）
// - 値は描くたびに prestigeView から読む（prestige-view.ts の prestigeConfirmView。保持した値を見せない）
// - 確定は 1 回だけ（連打・Enter の自動リピート・確定と取り消しのほぼ同時の押下でも。TS-021-21）
// - 開いている間は modal-state にも数える（Dialog。掘削の入力と 1〜5・Shift を止める）
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PerkId } from '../../content/perks.ts';
import type { TerrainId } from '../../content/terrains.ts';
import { t, type Lang } from '../../i18n/index.ts';
import { useGame, useUi } from '../hooks/use-game.ts';
import { PerkTree } from '../panels/PerkTree.tsx';
import { perkTreeRows, prestigeConfirmView, terrainRows, togglePlan, type PerkTreeRows, type TerrainRow } from '../panels/prestige-view.ts';
import { Dialog } from './Dialog.tsx';

export interface PrestigeModalProps {
  lang: Lang;
  /** openPrestigeConfirm が返した閉じる関数（止める理由を外す） */
  close: () => void;
  /** 画面を消す（確定・取り消しの後） */
  onClosed: () => void;
}

const sameRows = (a: PerkTreeRows | null, b: PerkTreeRows | null): boolean => a?.sig === b?.sig;
const sameTerrains = (a: TerrainRow[], b: TerrainRow[]): boolean => JSON.stringify(a) === JSON.stringify(b);

export function PrestigeModal({ lang, close, onClosed }: PrestigeModalProps) {
  const { store } = useUi();
  const [step, setStep] = useState<1 | 2>(1);
  const [respec, setRespec] = useState(false);
  // 振り直しの途中の木（開いたときの木から始める）。変えていなければ転生の perks は渡さない（今の木のまま）
  const [plan, setPlan] = useState<readonly PerkId[]>(() => [...store.state.meta.perks]);
  // 次の周回の地形（開いたときの地形から始める。変えていなければ転生の terrain は渡さない）
  const [terrain, setTerrain] = useState<TerrainId>(() => store.state.run.terrain);
  const terrains = useGame((s) => terrainRows(s), sameTerrains);
  const done = useRef(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => () => closeRef.current(), []);

  const v = useGame((s) => prestigeConfirmView(s, lang, respec ? plan : undefined));
  const tree = useGame((s) => (respec ? perkTreeRows(s, lang, plan) : null), sameRows);

  const finish = (): void => {
    closeRef.current();
    onClosed();
  };
  const cancel = (): void => {
    if (done.current) return;
    done.current = true;
    finish();
  };
  const confirm = (): void => {
    if (done.current) return;
    done.current = true;
    // 集合で比べる（外して取り直すと並びが定義の順に変わるが、同じ集合なら今の木のまま。PR #91 のレビュー N-3）
    const changed = respec && [...plan].sort().join() !== [...store.state.meta.perks].sort().join();
    const moved = terrain !== store.state.run.terrain;
    store.dispatch({ type: 'prestige', ...(changed ? { perks: plan } : {}), ...(moved ? { terrain } : {}) }); // dispatch → 閉じる（TS-021-45）
    finish();
  };

  return (
    <Dialog testId="modal-prestige" titleId="modal-prestige-title" title={t('prestige.confirm.title')} onDismiss={cancel}>
      <div class="sheet-body prestige-confirm" data-step={step}>
        {step === 1 ? (
          <>
            <h3 class="inn-head">{t('prestige.confirm.get')}</h3>
            <p class="prestige-line" data-testid="prestige-confirm-gain" data-value={v.gainValue}>
              {v.gainText}
              {v.bonusText && <small class="prestige-bonus"> {v.bonusText}</small>}
            </p>
            <p class="sheet-desc" data-testid="prestige-lifetime">
              {v.lifetimeText}
            </p>
            <p class="sheet-desc" data-testid="prestige-mult" data-value={v.multAfterValue}>
              {v.multText}
            </p>
            <p class="sheet-desc" data-testid="prestige-tickets" data-value={v.ticketsAdded}>
              {v.ticketsText}
            </p>
            {v.ticketCapText && (
              <p class="sheet-note" data-testid="prestige-ticket-cap" role="status">
                {v.ticketCapText}
              </p>
            )}
            {v.startText && (
              <p class="sheet-desc" data-testid="prestige-start">
                {t('prestige.confirm.start')}: {v.startText}
              </p>
            )}
            <h3 class="inn-head">{t('prestige.confirm.lose')}</h3>
            <p class="sheet-desc" data-testid="prestige-lose">
              {t('prestige.confirm.loseList')}
            </p>
            <h3 class="inn-head">{t('prestige.confirm.keep')}</h3>
            <p class="sheet-desc" data-testid="prestige-keep">
              {t('prestige.confirm.keepList')}
            </p>
            <h3 class="inn-head">{t('terrain.head')}</h3>
            <div class="terrain-list" data-testid="prestige-terrain" data-value={terrain} role="group" aria-label={t('terrain.head')}>
              {terrains.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  class={`row terrain-row${terrain === x.id ? ' inn-pick' : ''}`}
                  data-testid={`terrain-${x.id}`}
                  data-state={terrain === x.id ? 'selected' : x.selectable ? 'selectable' : 'locked'}
                  aria-pressed={terrain === x.id ? 'true' : 'false'}
                  disabled={!x.selectable}
                  onClick={() => setTerrain(x.id)}
                >
                  <span class="buy-main">
                    <span class="row-name">
                      {x.name}
                      {x.current && <small> {t('terrain.current')}</small>}
                    </span>
                    <span class="buy-effect">{x.traits}</span>
                    {x.lockText && <span class="buy-lock">{x.lockText}</span>}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              class="sheet-btn"
              data-testid="prestige-respec"
              aria-expanded={respec ? 'true' : 'false'}
              onClick={() => setRespec((x) => !x)}
            >
              {t('prestige.confirm.respec')}
            </button>
            {respec && tree && (
              <>
                <p class="sheet-desc">{t('prestige.confirm.respecNote')}</p>
                <button type="button" class="sheet-btn" data-testid="prestige-respec-reset" disabled={plan.length === 0} onClick={() => setPlan([])}>
                  {t('prestige.confirm.respecReset')}
                </button>
                <PerkTree rows={tree} idPrefix="plan" ownedPickable onPick={(id) => setPlan((p) => togglePlan(store.state, p, id))} />
              </>
            )}
            <button type="button" class="sheet-btn" data-testid="prestige-confirm-1" disabled={!v.canPrestige} onClick={() => setStep(2)}>
              {t('prestige.confirm.next')}
            </button>
          </>
        ) : (
          <>
            <p class="sheet-desc" data-testid="prestige-sure">
              {t('prestige.confirm.sure')}
            </p>
            <p class="prestige-line" data-testid="prestige-confirm-gain" data-value={v.gainValue}>
              {v.gainText}
              {v.bonusText && <small class="prestige-bonus"> {v.bonusText}</small>}
            </p>
            <button type="button" class="sheet-btn" data-testid="prestige-confirm-2" disabled={!v.canPrestige} onClick={confirm}>
              {t('prestige.confirm.ok')}
            </button>
          </>
        )}
        <button type="button" class="sheet-btn" data-testid="prestige-cancel" onClick={cancel}>
          {t('prestige.confirm.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
