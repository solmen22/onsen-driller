// CI の e2e ジョブ用: verify から受け取った dist/ に、E2E が配信するビルドがそろっているかを確かめる（DevOps。BL-095）
//
// そろっているべきもの: scripts/check-lib.mjs の E2E_JOB_TARGETS（e2e-web・e2e-crazygames と本番の 4 種）の
// <dist>/<名前>/index.html。1 つでも欠けていれば、欠けたものを全部並べて終了コード 1。
// e2e ジョブでは Playwright の導入（約 30 秒）の前に動かし、成果物の受け渡しの誤りを E2E の途中の失敗より先に、原因の分かる形で止める。
// 代わりの場所は探さない（BL-095 で pick-e2e-dist.mjs の PoC の dist/e2e への後戻りをやめた。main e8e55a6 の build:e2e は
// dist/e2e-web・dist/e2e-crazygames だけを作ることを確かめた）。
//
// 使い方: node scripts/check-e2e-dist.mjs [--dist <dir>]（既定 dist）。手元では npm run build:all・build:e2e の後に通る
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { E2E_JOB_TARGETS } from './check-lib.mjs';

const { values } = parseArgs({ options: { dist: { type: 'string' } } });
const dist = (values.dist ?? 'dist').replace(/[\\/]+$/, '');
const missing = E2E_JOB_TARGETS.filter((t) => !existsSync(join(dist, t, 'index.html')));
if (missing.length) {
  console.error(
    `check-e2e-dist: NG ${missing.map((t) => `${dist}/${t}/index.html`).join('・')} がない` +
      '（verify の build:all・build:e2e と、ci.yml の成果物 dist-e2e の path を確認）',
  );
  process.exit(1);
}
console.log(`check-e2e-dist: OK ${E2E_JOB_TARGETS.map((t) => `${dist}/${t}`).join('・')}`);
