// T1「掘る」（gdd §11-2。BL-043）: 道具の進化（次の段・解放の条件・見た目のプレビュー）、ドリルのレベル、自動掘削機。
// 自動掘りの切り替えは HUD（キャンバスの下端。StageActions.tsx）にある
import type { Qty } from '../../core/index.ts';
import type { Lang } from '../../i18n/index.ts';
import { BuyButton } from './BuyButton.tsx';

export function DigPanel({ qty, lang }: { qty: Qty; lang: Lang }) {
  return (
    <div class="list" data-testid="panel-dig">
      <BuyButton item="tool" qty={qty} lang={lang} />
      <BuyButton item="drill" qty={qty} lang={lang} />
      <BuyButton item="autoDigger" qty={qty} lang={lang} />
    </div>
  );
}
