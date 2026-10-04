// ビルド検査（check:size・check:assets・package）の共通部品（BL-008。DevOps）
// 単位・予算・ターゲットごとの想定は、traceability.md §5 の Q-15「回答（DevOps）」と一致させる。
import { readdirSync, statSync } from 'node:fs';
import { extname, join, posix } from 'node:path';
import { gzipSync } from 'node:zlib';

/** 予算の単位は MB＝10^6 バイト（Q-15。どちらの意味で読まれても上限を超えない安全側）。Cloudflare の 1 ファイル上限だけは公式の表記どおり MiB */
export const MB = 1_000_000;
export const MiB = 1024 * 1024;

export const BUDGET = {
  initialGzipFail: 5 * MB, // 初回ダウンロード（gzip 換算）: 超えたら失敗（QA §4-4）
  initialGzipWarn: 1.5 * MB, // 同: 超えたら警告（目標）
  totalFail: 8 * MB, // 合計（非圧縮）: 超えたら失敗（QA §4-4）
  totalSelf: 20 * MB, // DevOps の自主予算（infra §5-1）。8MB のほうが厳しいので単独で失敗する場面はない
  files: 300, // DevOps の自主予算（CrazyGames 1,500・itch 1,000 より厳しい）
  fileMax: 25 * MiB, // Cloudflare Pages の 1 ファイル上限（25 MiB）
  pathMax: 200, // itch.io のパス上限 240 文字に余裕を持たせる
};

export const SDK = { crazygames: 'sdk.crazygames.com', poki: 'game-cdn.poki.com' };
export const HOOK = '__game';

/**
 * 偽の広告（dev のアダプタ src/platform/dev.ts。VITE_TARGET=dev か VITE_FAKE_ADS=true のビルドにだけ入る）の目印
 * （コードレビュー S1-core の S-8: .env.local の VITE_FAKE_ADS=true が本番のビルドに入る経路）。
 * どちらも圧縮の後も残る文字列リテラル: 画面に出す文言 `FAKE AD (${label})` と、data-testid の `fake-ad`。
 * 本番は 1 つでもあれば失敗。偽の広告が入るはずの e2e は、2 つともないと失敗する（dev.ts の文字列を変えたときに、
 * 目印が古いまま本番の検査だけが素通りになる「偽の緑」を防ぐ。変えたらここも直す）
 */
export const FAKE_AD = ['FAKE AD', 'fake-ad'];

/**
 * ターゲットごとの想定（QA test-strategy §4-5 の表）。値は「あるべきか」。
 * fakeAds: 偽の広告（FAKE_AD）。QA の表では e2e＝web＋フック＋偽の広告、e2e-crazygames＝crazygames＋フック（SDK はモック）
 * production: 本番に出すビルド（ソースマップ禁止・package の対象）
 */
export const TARGETS = {
  web: { cg: false, poki: false, hooks: false, fakeAds: false, headers: true, production: true },
  crazygames: { cg: true, poki: false, hooks: false, fakeAds: false, headers: false, production: true },
  itch: { cg: false, poki: false, hooks: false, fakeAds: false, headers: false, production: true },
  poki: { cg: false, poki: true, hooks: false, fakeAds: false, headers: false, production: true },
  // e2e 系: 出力名は PoC では e2e、BL-007 から e2e-web（テスト設計者の文書と同じ）。どちらでも同じ扱い
  e2e: { cg: false, poki: false, hooks: true, fakeAds: true, headers: false, production: false },
  'e2e-web': { cg: false, poki: false, hooks: true, fakeAds: true, headers: false, production: false },
  'e2e-crazygames': { cg: true, poki: false, hooks: true, fakeAds: false, headers: false, production: false },
  'e2e-poki': { cg: false, poki: true, hooks: true, fakeAds: false, headers: false, production: false },
};
/** 想定表にないターゲットは、何も入ってはいけない本番扱いで検査する（新しいターゲットの混入を見逃さない） */
export const UNKNOWN_TARGET = { cg: false, poki: false, hooks: false, fakeAds: false, headers: false, production: true };
export const PRODUCTION_TARGETS = Object.keys(TARGETS).filter((t) => TARGETS[t].production);

/**
 * CI の e2e ジョブが verify から受け取るビルド（ci.yml の成果物 dist-e2e。BL-095）。名前は dist/ の下のディレクトリ名。
 * - e2e 系（`__game` あり）: e2e-web（E1・E5・E9 などが配信する mode e2e の出力）・e2e-crazygames（S2 の PW_MODE=e2e-crazygames）
 * - 本番の 4 種（`__game` なし）: 本番の起動の E2E（BL-097 の TS-007-03・09・13）が配信する
 * PoC の出力名 e2e（BL-007 の前の mode e2e）と e2e-poki（今の build:e2e は作らない）は入れない。
 * ci.yml の dist-e2e の path と、scripts/check-e2e-dist.mjs の確認はこの一覧に合わせる（test:checks が検査する）
 */
export const E2E_JOB_TARGETS = ['e2e-web', 'e2e-crazygames', ...PRODUCTION_TARGETS];

/**
 * 外部への送信の静的な検査（BL-096。コードレビュー PR #4 の M-1 の「あわせて」と N-10、CEO 決定）。
 * E2E の共通の検査（e2e/support/privacy.ts）は、タブ・context を閉じるときの送信や preconnect（接続だけで IP が外に出る）を
 * 見られないので、ビルドの出力のテキスト（.map を除く）で塞ぐ。どれも 1 つでもあれば失敗（全ターゲット）。
 * 誤検出が出たら、理由つきでターゲットごとに外す形を足す（外すのはコードレビュアーと QA リードの確認の後）
 */
export const NET_WORDS = [
  { rule: 'net.beacon', re: /sendBeacon/g, why: 'navigator.sendBeacon（ページを離れるときの送信。E2E では見えない）' },
  { rule: 'net.keepalive', re: /keepalive/gi, why: 'fetch の keepalive（ページを閉じた後も送る）' },
  { rule: 'net.preconnect', re: /preconnect|dns-prefetch/gi, why: 'rel="preconnect"・"dns-prefetch"（接続・DNS の問い合わせだけで IP が外に出る）' },
];
/** Service Worker（TS-007-10。MVP では入れない。infra §8 #8: 更新・ロールバックがキャッシュで遅れる）。本文の API 名とファイル名で見る */
export const SERVICE_WORKER = { text: 'serviceWorker', file: /^(?:sw|service-?worker)(?:[.-]|$)|workbox/i };
/** 出力の中の外部の絶対 URL（http・https・ws・wss）。引用符・括弧・空白などで終わる */
export const EXTERNAL_URL = /\b(?:https?|wss?):\/\/[^\s"'`<>()\\,;{}[\]]+/gi;
/**
 * 出力に書いてあってよい外部の絶対 URL（BL-096。**完全一致**。targets は 'all' かターゲット名の配列）。各行に理由を書く。
 * 追加・変更はコードレビュアーと QA リードの確認を受ける（web に Cloudflare Web Analytics〔BL-082〕を入れるなら web だけに足す）
 */
export const EXTERNAL_URL_ALLOW = [
  { url: 'http://www.w3.org/2000/svg', targets: 'all', why: 'SVG の XML 名前空間（Preact・Phaser の createElementNS の引数）。通信しない' },
  { url: 'http://www.w3.org/1999/xhtml', targets: 'all', why: 'XHTML の名前空間（Preact の foreignObject・Phaser）。通信しない' },
  { url: 'http://www.w3.org/1998/Math/MathML', targets: 'all', why: 'MathML の名前空間（Preact）。通信しない' },
  { url: 'https://phaser.io', targets: 'all', why: 'Phaser が起動時に console に出す名前の文字列。通信しない' },
  { url: 'https://phaser.io/', targets: 'all', why: 'Phaser の設定の gameURL の既定値（`https://phaser.io/`＋版。文字列として持つだけ）。通信しない' },
  { url: 'https://sdk.crazygames.com/crazygames-sdk-v3.js', targets: ['crazygames', 'e2e-crazygames'], why: 'CrazyGames の SDK（ポータルの必須。index.html の script）' },
  { url: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js', targets: ['poki', 'e2e-poki'], why: 'Poki の SDK（ポータルの必須。index.html の script）' },
];
/** そのターゲットで外部の URL が許されるか */
export const urlAllowed = (url, target) =>
  EXTERNAL_URL_ALLOW.some((a) => a.url === url && (a.targets === 'all' || a.targets.includes(target)));

/** 配信時に圧縮される（gzip 換算で数える）拡張子。画像・音声・フォント（woff2 など）はそのままの大きさで数える */
export const COMPRESSIBLE = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.svg', '.txt', '.xml', '.webmanifest']);

/** check:assets の対象（台帳と突き合わせる素材）の拡張子（Q-15） */
export const ASSET_EXT = new Set([
  // 画像
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico', '.bmp',
  // 音声・動画
  '.ogg', '.oga', '.opus', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.weba', '.mp4', '.webm',
  // フォント
  '.woff2', '.woff', '.ttf', '.otf', '.eot',
]);

/** dir 以下のファイルを、dir からの相対パス（区切りは /）で昇順に返す */
export function walk(dir) {
  const out = [];
  const rec = (d, rel) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) rec(p, r);
      else out.push(r);
    }
  };
  rec(dir, '');
  return out.sort();
}

export const extOf = (rel) => extname(rel).toLowerCase();

/** 配信時の大きさの見積もり（テキストは gzip レベル 9、それ以外はそのまま） */
export function transferSize(buf, rel) {
  return COMPRESSIBLE.has(extOf(rel)) ? gzipSync(buf, { level: 9 }).length : buf.length;
}

/** 初回ダウンロードに数えないファイル（Q-15）: Cloudflare の設定ファイル _headers と、DevTools だけが読むソースマップ */
export const isExcludedFromInitial = (rel) => rel === '_headers' || extOf(rel) === '.map';

/**
 * 素材の照合キー（Q-15）: ファイル名（ディレクトリは見ない）。Vite が assets/ に出力したものは
 * 末尾の「-<ハッシュ 8 文字>」を外す（例 assets/atlas-hmrc6vr3.png → atlas.png）。大文字小文字は区別する
 */
export function assetKey(rel) {
  const base = posix.basename(rel);
  if (rel.startsWith('assets/')) {
    const m = /^(.+)-[a-z0-9]{8}(\.[a-z0-9]+)$/.exec(base);
    if (m) return `${m[1]}${m[2]}`;
  }
  return base;
}

export const fmtMB = (n) => `${(n / MB).toFixed(3)} MB`;
export const fmtKB = (n) => (n / 1000).toFixed(1);
