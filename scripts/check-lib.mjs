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
 * ターゲットごとの想定（QA test-strategy §4-5 の表）。値は「あるべきか」。
 * production: 本番に出すビルド（ソースマップ禁止・package の対象）
 */
export const TARGETS = {
  web: { cg: false, poki: false, hooks: false, headers: true, production: true },
  crazygames: { cg: true, poki: false, hooks: false, headers: false, production: true },
  itch: { cg: false, poki: false, hooks: false, headers: false, production: true },
  poki: { cg: false, poki: true, hooks: false, headers: false, production: true },
  // e2e 系: いまの出力名は e2e（テスト設計者の文書では e2e-web）。どちらでも同じ扱い
  e2e: { cg: false, poki: false, hooks: true, headers: false, production: false },
  'e2e-web': { cg: false, poki: false, hooks: true, headers: false, production: false },
  'e2e-crazygames': { cg: true, poki: false, hooks: true, headers: false, production: false },
  'e2e-poki': { cg: false, poki: true, hooks: true, headers: false, production: false },
};
/** 想定表にないターゲットは、何も入ってはいけない本番扱いで検査する（新しいターゲットの混入を見逃さない） */
export const UNKNOWN_TARGET = { cg: false, poki: false, hooks: false, headers: false, production: true };
export const PRODUCTION_TARGETS = Object.keys(TARGETS).filter((t) => TARGETS[t].production);

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
