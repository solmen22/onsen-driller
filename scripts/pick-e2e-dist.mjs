// CI の e2e ジョブ用: e2e の web 版のビルドの場所を選んで、標準出力に 1 行で出す（DevOps。2026-09-28 CEO 依頼）
//
// mode e2e の出力先は版によって違う:
//   - PoC（main）の vite.config.ts: dist/e2e
//   - BL-007（feat/S1-core。tools/build/modes.ts）から: dist/e2e-web
// index.html がある dist/e2e-web を先に選び、なければ dist/e2e を選ぶ。どちらもなければ終了コード 1。
// CI の e2e ジョブは verify で作ったばかりの dist/ を受け取るので、古い出力が残っていることはない
// （手元で両方の版をビルドした dist/ では、古い dist/e2e-web を選びうる。手元では PW_DIST を直接指定する）。
//
// 使い方: node scripts/pick-e2e-dist.mjs [--dist <dir>]（既定 dist。出力は "<dir>/e2e-web" か "<dir>/e2e"）
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const E2E_WEB_DIRS = ['e2e-web', 'e2e']; // 先にあるほうを優先する

const { values } = parseArgs({ options: { dist: { type: 'string' } } });
const dist = (values.dist ?? 'dist').replace(/[\\/]+$/, '');
const hit = E2E_WEB_DIRS.find((d) => existsSync(join(dist, d, 'index.html')));
if (!hit) {
  console.error(
    `pick-e2e-dist: ${E2E_WEB_DIRS.map((d) => `${dist}/${d}/index.html`).join(' にも ')} にもない（verify の build:e2e と、dist-e2e の成果物の受け渡しを確認）`,
  );
  process.exit(1);
}
console.log(`${dist}/${hit}`);
