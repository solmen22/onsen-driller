// 本番の 4 ビルドの配信（BL-097。TS-007-03・09・13・TS-071-03 の実行時の部分。BL-007_build-targets.md）
//
// itch.io のサブパス配信（https://html-classic.itch.zone/html/<番号>/index.html）を模して、
//   http://<host>:<port>/html/123/<target>/…  →  dist/<target>/…（target は web・crazygames・itch・poki）
// で配信する。ビルドはしない（先に `npm run build:all`。CI は verify ジョブの dist/ を e2e ジョブが受け取る〔BL-095〕）。
// サブパスの外（/assets/… などの絶対パス）への要求は 404 にする（相対パスでないビルドを見つけるため）。
//
// e2e のビルドの配信（serve.mjs の vite preview）と別にしたのは、
//   - 本番のビルドは mode ごとに outDir が違い、4 つを同時に 1 つのサーバーで出したい
//   - ビルドがまだ無いときも（PR の e2e ジョブに本番のビルドが渡される前〔BL-095〕）サーバーは起動し、
//     prod-builds のテストだけが「dist/<target> がありません」で失敗するようにしたい（ほかのプロジェクトを巻き込まない）
// ため。Playwright の webServer の準備の確認は GET /__health（常に 200）で行う。
//
// 環境変数
//   PW_HOST / PW_PROD_PORT  待ち受けのホストとポート（既定 127.0.0.1:4175。4174 は e2e のビルド、4173 は preview:web）
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

// e2e/support/prod.ts の PROD_TARGETS・SUBPATH と同じ値（このファイルはサーバーなので spec から import しない）
const PROD_TARGETS = ['web', 'crazygames', 'itch', 'poki'];
const SUBPATH = '/html/123/';

const host = process.env.PW_HOST ?? '127.0.0.1';
const port = Number(process.env.PW_PROD_PORT ?? 4175);
const distRoot = resolve(import.meta.dirname, '..', '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

/** URL のパス → 配信するファイル（無ければ null と理由） */
function fileFor(pathname) {
  if (!pathname.startsWith(SUBPATH)) return { file: null, why: `サブパス ${SUBPATH} の外` };
  const rest = pathname.slice(SUBPATH.length);
  const slash = rest.indexOf('/');
  const target = slash < 0 ? rest : rest.slice(0, slash);
  if (!PROD_TARGETS.includes(target)) return { file: null, why: `知らないビルド: ${target}` };
  const base = resolve(distRoot, target);
  if (!existsSync(resolve(base, 'index.html'))) return { file: null, why: `dist/${target}/index.html がありません（先に npm run build:all）` };
  let sub = slash < 0 ? '' : rest.slice(slash + 1);
  if (sub === '' || sub.endsWith('/')) sub += 'index.html';
  const file = resolve(base, sub);
  if (file !== base && !file.startsWith(base + sep)) return { file: null, why: 'ビルドの外' };
  if (!existsSync(file) || !statSync(file).isFile()) return { file: null, why: `ファイルがない: dist/${target}/${sub}` };
  return { file, why: '' };
}

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${host}`).pathname);
  } catch {
    res.writeHead(400).end('bad url');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  if (pathname === '/__health') {
    const built = PROD_TARGETS.filter((t) => existsSync(resolve(distRoot, t, 'index.html')));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, built }));
    return;
  }
  const { file, why } = fileFor(pathname);
  if (!file) {
    console.log(`[e2e:prod] 404 ${pathname}（${why}）`);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(why);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  const built = PROD_TARGETS.filter((t) => existsSync(resolve(distRoot, t, 'index.html')));
  console.log(`[e2e:prod] 本番のビルドを http://${host}:${port}${SUBPATH}<target>/ で配信しています（あるもの: ${built.join('・') || 'なし'}）`);
});

const stop = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
