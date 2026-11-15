// T5「≡」（gdd §11-2。BL-045）: 記録（図鑑・実績・統計）・設定・セーブ・このゲームについて（クレジット・プライバシーポリシー・版・エラー情報）
// - 中身がまだないもの（図鑑・実績・統計は BL-050、書き出し・読み込み・初めからは BL-029、プライバシーポリシーの画面は BL-143）は、
//   行だけ出して押せない（「準備中」）。入口の位置を先に決めておく
// - 設定: 言語（lang-toggle で日本語⇔英語、lang-auto で端末に合わせる）・効果音・数値の表記・動きを減らす（次の起動から）・
//   チュートリアル（setting-tutorial。セーブの tutorial.dismissed。core の {type:'tutorial', dismissed}。BL-049）。
//   保存は app の設定の口（settings.set・onLangChange）だけを通す（読み取り専用の間は書かない。Q-26 ③）。
//   環境音・画質・録画モードは、その機能が入るとき（音・画質・BL-048）に足す（効かない設定を出さない）
// - 外部リンクは置かない（プライバシーポリシーもゲームの中の画面にする。BL-143・Poki の要件）
// - 「エラー情報をコピー」: クリップボードに書き、書けなくても選べる文字の欄（errors-text）で出す。送信はしない
import { useRef, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../../app/settings.ts';
import { t, type Lang, type TextKey } from '../../i18n/index.ts';
import { useGame, useUi, type SettingsHooks } from '../hooks/use-game.ts';
import { Dialog } from '../overlay/Dialog.tsx';
import { CREDIT_LIBS, errorReport, nextMotion, nextNotation } from './menu-view.ts';

export interface MenuPanelProps {
  lang: Lang;
  /** 日本語⇔英語（設定に保存する） */
  onLang: (l: Lang) => void;
  /** 端末の言語に合わせる（設定は auto） */
  onLangAuto: () => void;
  /** 設定を変えた（App が描き直す。数値の表記が全体に効く） */
  onChanged: () => void;
}

/** 設定の口がない（テストで ctx を渡さない）ときはメモリだけの設定で動く */
function useSettings(): SettingsHooks {
  const { settings } = useUi();
  const local = useRef<Settings>({ ...DEFAULT_SETTINGS });
  if (settings) return settings;
  return {
    get: () => local.current,
    set: (patch) => {
      local.current = normalizeSettings({ ...local.current, ...patch });
    },
  };
}

function SoonRow({ id, label }: { id: string; label: TextKey }) {
  return (
    <button type="button" class="row menu-soon" data-testid={id} disabled>
      <span class="row-name">{t(label)}</span>
      <span class="row-cost">{t('panel.soon')}</span>
    </button>
  );
}

function CreditsModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog testId="modal-credits" titleId="modal-credits-title" title={t('menu.credits')} onDismiss={onClose}>
      <div class="sheet-body">
        <p class="sheet-desc" data-testid="credits-font">
          {t('credits.font')}
        </p>
        <p class="sheet-desc" data-testid="credits-libs">
          {t('credits.libs')}
        </p>
        <ul class="credits-list">
          {CREDIT_LIBS.map((x) => (
            <li key={x.name}>
              {x.name} — {x.license}
            </li>
          ))}
        </ul>
        <p class="sheet-desc" data-testid="credits-art">
          {t('credits.art')}
        </p>
        <button type="button" class="sheet-btn" data-testid="credits-close" onClick={onClose}>
          {t('modal.close')}
        </button>
      </div>
    </Dialog>
  );
}

export function MenuPanel({ lang, onLang, onLangAuto, onChanged }: MenuPanelProps) {
  const { platform, version, errors, store } = useUi();
  const tutorialOn = useGame((st) => !st.tutorial.dismissed);
  const settings = useSettings();
  const s = settings.get();
  const [credits, setCredits] = useState(false);
  const [report, setReport] = useState<{ text: string; copied: boolean | null } | null>(null);
  const set = (patch: Partial<Settings>): void => {
    settings.set(patch);
    onChanged();
  };

  const copyErrors = (): void => {
    const text = errorReport({
      version,
      target: platform.target,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      time: new Date().toISOString(),
      errors: errors?.() ?? [],
    });
    setReport({ text, copied: null });
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== 'function') {
      setReport({ text, copied: false });
      return;
    }
    clip.writeText(text).then(
      () => setReport((r) => (r && r.text === text ? { text, copied: true } : r)),
      () => setReport((r) => (r && r.text === text ? { text, copied: false } : r)),
    );
  };

  return (
    <div class="list" data-testid="panel-menu">
      <h3 class="inn-head">{t('menu.section.records')}</h3>
      <SoonRow id="menu-collection" label="menu.collection" />
      <SoonRow id="menu-achievements" label="menu.achievements" />
      <SoonRow id="menu-stats" label="menu.stats" />

      <h3 class="inn-head">{t('menu.section.settings')}</h3>
      <button class="row" type="button" data-testid="lang-toggle" data-value={s.lang} onClick={() => onLang(lang === 'ja' ? 'en' : 'ja')}>
        <span class="row-name">{t('menu.lang')}</span>
        <span class="row-cost">
          {t(lang === 'ja' ? 'ui.langName.ja' : 'ui.langName.en')}
          {s.lang === 'auto' && ` (${t('menu.auto')})`}
        </span>
      </button>
      {s.lang !== 'auto' && (
        <button class="row" type="button" data-testid="lang-auto" onClick={onLangAuto}>
          <span class="row-name">{t('menu.langAuto')}</span>
        </button>
      )}
      <button class="row" type="button" data-testid="setting-sfx" data-value={s.sfx ? 'on' : 'off'} aria-pressed={s.sfx ? 'true' : 'false'} onClick={() => set({ sfx: !s.sfx })}>
        <span class="row-name">{t('menu.sfx')}</span>
        <span class="row-cost">{t(s.sfx ? 'state.on' : 'state.off')}</span>
      </button>
      <button class="row" type="button" data-testid="setting-notation" data-value={s.notation} onClick={() => set({ notation: nextNotation(s.notation) })}>
        <span class="row-name">{t('menu.notation')}</span>
        <span class="row-cost">{t(s.notation === 'exp' ? 'menu.notation.exp' : 'menu.auto')}</span>
      </button>
      <button class="row" type="button" data-testid="setting-motion" data-value={s.reduceMotion} onClick={() => set({ reduceMotion: nextMotion(s.reduceMotion) })}>
        <span class="buy-main">
          <span class="row-name">{t('menu.motion')}</span>
          <span class="buy-lock">{t('menu.nextLaunch')}</span>
        </span>
        <span class="row-cost">{t(s.reduceMotion === 'on' ? 'state.on' : s.reduceMotion === 'off' ? 'state.off' : 'menu.motion.auto')}</span>
      </button>

      <button
        class="row"
        type="button"
        data-testid="setting-tutorial"
        data-value={tutorialOn ? 'on' : 'off'}
        aria-pressed={tutorialOn ? 'true' : 'false'}
        onClick={() => store.dispatch({ type: 'tutorial', dismissed: tutorialOn })}
      >
        <span class="row-name">{t('menu.tutorial')}</span>
        <span class="row-cost">{t(tutorialOn ? 'state.on' : 'state.off')}</span>
      </button>

      <h3 class="inn-head">{t('menu.section.save')}</h3>
      <SoonRow id="menu-export" label="menu.export" />
      <SoonRow id="menu-import" label="menu.import" />
      <SoonRow id="menu-new-game" label="menu.newGame" />

      <h3 class="inn-head">{t('menu.section.about')}</h3>
      <button class="row" type="button" data-testid="menu-credits" onClick={() => setCredits(true)}>
        <span class="row-name">{t('menu.credits')}</span>
      </button>
      <SoonRow id="menu-privacy" label="menu.privacy" />
      <button class="row" type="button" data-testid="btn-copy-errors" onClick={copyErrors}>
        <span class="row-name">{t('menu.copyErrors')}</span>
      </button>
      {report && (
        <>
          {report.copied !== null && (
            <p class="note" data-testid="errors-status" data-copied={String(report.copied)} role="status">
              {t(report.copied ? 'menu.copied' : 'menu.copyFailed')}
            </p>
          )}
          <textarea class="errors-text" data-testid="errors-text" readOnly rows={6} value={report.text} aria-label={t('menu.copyErrors')} />
        </>
      )}
      <p class="note" data-testid="menu-version">
        {t('menu.version')}: {version} · {t('menu.target')}: {platform.target}
      </p>
      {credits && <CreditsModal onClose={() => setCredits(false)} />}
    </div>
  );
}
