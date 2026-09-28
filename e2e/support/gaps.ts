// いまの main のビルドに「まだ無い」フック・機能の一覧（BL-073）。
//
// 使い方: テストの先頭で needs('hook:seed', ...) と、そのテストが使うフック・機能を宣言する。
// KNOWN_GAPS に載っているものが 1 つでもあれば、そのテストを test.fixme（保留）にして理由を残す。期待値は変えない。
//
// 規則（偽の緑を防ぐため）
// - KNOWN_GAPS には「無いことが分かっているもの」だけを書く。載っていないものが欠けていれば、テストは普通に失敗する。
// - 実装が入ったら KNOWN_GAPS からその行を消す。消すと、それを使うテストが動き出す。
// - foundation.spec.ts の「フックと機能の一覧」が、KNOWN_GAPS とビルドの食い違いを検出して失敗する
//   （実装が入ったのに一覧に残っている → 行を消す／一覧に無いのに欠けている → BL-071 などの不足）。
//
// 基準にしたビルド: main c6a1f60（PoC。技術リードの T-022）。S1 の実装（BL-071 など）が main に入ったら見直す。
import { test } from '@playwright/test';

/** テストが宣言できる前提（フック・機能）と、その中身 */
const REQUIREMENTS = {
  // --- テスト用フック（BL-071。arch §8-4） ---
  'hook:seed': 'BL-071: __game.seed(n)（シードを指定して新しいゲームを始める）',
  'hook:setState': 'BL-071: __game.setState(s)',
  'hook:setClock': 'BL-071: __game.setClock(wallMs)（アプリの壁時計の差し替え）',
  'hook:grant': 'BL-071: __game.grant({coins, tickets, depth})',
  'hook:rect': "BL-071: __game.rect('drill')（キャンバス内の要素の画面上の矩形）",
  'hook:events': 'BL-071: __game.events(limit?)（直近のドメインイベント）',
  'hook:errors': 'BL-071: __game.errors()（捕まえたエラーの記録）',
  'hook:advance.input': 'BL-071: __game.advance(ms, {tapsPerSec, hold})（入力の引数。PoC は advance(ms) だけ）',
  // --- S1 の本体の機能 ---
  'feature:tickets': 'BL-042 ほか: 温泉チケット（state.meta.tickets。S1 の初期値 2）と hud-tickets',
  'feature:autoDigLock':
    'BL-012・BL-043（Q-03）: ツルハシ購入前の自動掘りのロックと toggle-auto-dig（data-state="locked|off|on"。PoC は toggle-autodig で常に押せる）',
  'feature:buyState': 'BL-043: 購入ボタンの data-state（affordable|insufficient|locked|maxed）',
  'feature:twoSlotSave':
    'BL-027: 2 枠保存（a・b に交互、seq の継続、有効で seq の大きい枠から読む。PoC は a の 1 枠だけで、seq は起動ごとに 1 から）',
  'feature:saveWarning': 'BL-027・BL-042: 保存できないときの save-warning の表示（PoC は黙ってメモリに切り替える）',
} as const;

export type Requirement = keyof typeof REQUIREMENTS;

/** いまのビルド（main c6a1f60 の PoC）に無いもの。実装が入ったら消す */
export const KNOWN_GAPS: readonly Requirement[] = [
  'hook:seed',
  'hook:setState',
  'hook:setClock',
  'hook:grant',
  'hook:rect',
  'hook:events',
  'hook:errors',
  'hook:advance.input',
  'feature:tickets',
  'feature:autoDigLock',
  'feature:buyState',
  'feature:twoSlotSave',
  'feature:saveWarning',
];

/** 後のスプリントで有効にするもの（CEO 決定・traceability.md の「S1 で動かすもの」の外） */
const LATER = {
  'S2:lifecycle':
    'S2 で有効にする（CEO 決定 Q-01）: ライフサイクル（loadingStop → 最初の入力で gameplayStart）は BL-056 の後に BL-074 と一緒に確認する',
  'S2:crazygames': 'S2 で有効にする（BL-057・BL-072）: e2e-crazygames のビルドと SDK のモック（page.route）の後',
  'S3:tutorial': 'S3 で有効にする（BL-049）: チュートリアルの指アイコン（tutorial-finger）の後',
  'S3:newerSave': 'S3 で有効にする（BL-028）: 新しい版のセーブの見本と読み取り専用の後',
  'S3:export': 'S3 で有効にする（BL-029）: 書き出し・読み込みの後',
  'S4:externalLinks': 'S4 で有効にする（BL-078。T5 は S3 の BL-045）: 設定画面の外部リンクの後',
  'S4:smoke': 'S4 で有効にする（BL-085）: 本番スモーク（test:smoke）で行う',
} as const;
export type Later = keyof typeof LATER;

export const describeRequirement = (r: Requirement): string => REQUIREMENTS[r];
export const isKnownGap = (r: Requirement): boolean => KNOWN_GAPS.includes(r);

/** 前提のうち KNOWN_GAPS にあるものがあれば、このテストを保留（fixme）にする。テスト本体の最初に呼ぶ */
export function needs(...reqs: Requirement[]): void {
  const missing = reqs.filter(isKnownGap);
  test.fixme(missing.length > 0, `保留（いまのビルドに無い）: ${missing.map((r) => `[${r}] ${REQUIREMENTS[r]}`).join(' / ')}`);
}

/** 後のスプリントで有効にするテストを保留にする */
export function later(key: Later): void {
  test.fixme(true, LATER[key]);
}
