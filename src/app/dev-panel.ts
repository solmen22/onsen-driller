// 開発用のデバッグパネル（arch §12-2 の dev アダプタの行。BL-056）。URL に `?debug` を付けたときだけ出す。
// main.ts が DEV_BUILD（`npm run dev`・e2e のビルド）のときだけ動的に読み込むので、本番の 4 ビルドには入らない。
// プレイヤーに見せる UI ではないので、Preact の UI の層（ui/）には入れず、素の DOM で作る（文言も英語だけ）。
// - 状態の表示（深さ・最深・コイン・打撃・ブロック・道具・ドリル Lv・チケット・幕間の残り）
// - 時間を進める（ロジックだけ。+10 秒・+1 分・+10 分。store.advance）
// - 付与（コイン +1,000・コイン ×10・チケット +1・深さ +10m。core の applyGrant。テスト用フックの grant と同じ）
// - 偽の広告の結果の切り替え（rewarded・failed・unavailable。setAdResult を持つ dev アダプタのときだけ）
import { applyGrant, mul, toStr, type GrantInput } from '../core/index.ts';
import type { Platform, RewardResult } from '../platform/types.ts';
import type { GameStore } from './store.ts';

export interface DevPanelDeps {
  store: GameStore;
  platform: Platform & { setAdResult?: (r: RewardResult) => void };
  doc?: Document;
}

export interface DevPanel {
  readonly el: HTMLElement;
  dispose(): void;
}

const AD_RESULTS: readonly RewardResult[] = ['rewarded', 'failed', 'unavailable'];

export function mountDevPanel(d: DevPanelDeps): DevPanel {
  const doc = d.doc ?? document;
  const { store } = d;
  const el = doc.createElement('div');
  el.dataset['testid'] = 'dev-panel';
  el.style.cssText =
    'position:fixed;left:4px;bottom:4px;z-index:9998;max-width:min(96vw,360px);padding:6px;background:#000b;color:#fff;font:11px/1.4 monospace;border-radius:4px';

  const text = doc.createElement('pre');
  text.dataset['testid'] = 'dev-state';
  text.style.cssText = 'margin:0 0 4px;white-space:pre-wrap';
  el.appendChild(text);

  const row = (): HTMLElement => {
    const r = doc.createElement('div');
    r.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    el.appendChild(r);
    return r;
  };
  const button = (parent: HTMLElement, id: string, label: string, fn: () => void): void => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset['testid'] = id;
    b.style.cssText = 'font:inherit;padding:2px 6px';
    b.addEventListener('click', fn);
    parent.appendChild(b);
  };
  const grant = (p: GrantInput): void => {
    store.pushEvents(applyGrant(store.state, p));
    store.notify();
  };

  const time = row();
  for (const [id, label, ms] of [
    ['dev-advance-10s', '+10s', 10_000],
    ['dev-advance-1m', '+1m', 60_000],
    ['dev-advance-10m', '+10m', 600_000],
  ] as const) {
    button(time, id, label, () => store.advance(ms));
  }
  const give = row();
  button(give, 'dev-grant-coins', '+1000 coins', () => grant({ coins: '1000' }));
  button(give, 'dev-grant-coins-x10', 'coins x10', () => grant({ coins: toStr(mul(store.state.run.coins, 9)) }));
  button(give, 'dev-grant-ticket', '+1 ticket', () => grant({ tickets: 1 }));
  button(give, 'dev-grant-depth', '+10m depth', () => grant({ depth: store.state.run.depth + 10 }));

  const setAdResult = d.platform.setAdResult;
  if (setAdResult) {
    const ads = row();
    const label = doc.createElement('label');
    label.textContent = 'fake ad: ';
    const select = doc.createElement('select');
    select.dataset['testid'] = 'dev-ad-result';
    select.style.cssText = 'font:inherit';
    for (const r of AD_RESULTS) {
      const o = doc.createElement('option');
      o.value = r;
      o.textContent = r;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      const v = AD_RESULTS.find((r) => r === select.value);
      if (v) setAdResult(v);
    });
    label.appendChild(select);
    ads.appendChild(label);
  }

  const render = (): void => {
    const s = store.state;
    const r = s.run;
    text.textContent = [
      `${d.platform.target}  depth ${r.depth}m (max ${r.maxDepth}m)  coins ${toStr(r.coins)}`,
      `hits ${s.stats.hits}  blocks ${s.stats.blocks}  tool ${r.drill.tool}  drill Lv${r.drill.level}  tickets ${s.meta.tickets}`,
      `interlude ${r.interludeMs}ms  auto ${r.autoDig.on ? 'on' : 'off'}`,
    ].join('\n');
  };
  render();
  const unsubscribe = store.subscribe(render);
  doc.body.appendChild(el);
  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
