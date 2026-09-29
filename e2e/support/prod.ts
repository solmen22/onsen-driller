// 本番の 4 ビルドの起動の E2E（prod-builds のプロジェクト。BL-097）で使う値。配信は e2e/support/serve-prod.mjs（同じ値を持つ）
export const PROD_TARGETS = ['web', 'crazygames', 'itch', 'poki'] as const;
export type ProdTarget = (typeof PROD_TARGETS)[number];

/** itch.io のサブパス配信（html-classic.itch.zone/html/<番号>/）を模したパス。各ビルドはこの下の <target>/ に置く */
export const SUBPATH = '/html/123/';

/** ビルドの index.html の URL のパス（itch.io と同じく index.html を直接開く） */
export const indexPathOf = (t: ProdTarget): string => `${SUBPATH}${t}/index.html`;

/**
 * 各ビルドが読んでよい外部のオリジン（ポータルの SDK だけ。TS-007-04 の script と同じ）。
 * CI は外に出られないので、テストは page.route で空の応答を返す（BL-007_build-targets.md の前提）
 */
export const SDK_OF: Record<ProdTarget, string | null> = {
  web: null,
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  itch: null,
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
};
