// E2E 用のサーバー（BL-073 / TS-073-01）: 既にある e2e のビルドを `vite preview` で配信するだけ（ビルドはしない）。
// Playwright の webServer から起動し、テストの終了時に Playwright が止める。
// ビルドは別の手順で行う: ローカルは `npm run build:e2e`、CI は verify ジョブが作った dist/ を e2e ジョブが受け取る（ci.yml）。
//
// 配信するディレクトリ: 同じチェックアウトの vite.config.ts が mode から決める outDir をそのまま使う（名前の対応表をここに持たない）。
//   - PoC（main c6a1f60）の vite.config.ts: mode e2e → dist/e2e
//   - BL-007（feat/S1-core。tools/build/modes.ts）: mode e2e → dist/e2e-web、e2e-crazygames → dist/e2e-crazygames
//   build:e2e と同じ設定から出力先を読むので、どちらの版でも作ったビルドを配信する（2026-09-28 に S1-core 00d2cd4 の設定で確認）。
//   わざと代わりの場所は探さない: 古い dist/e2e が残っていても、今の版の出力先に index.html が無ければ止まる（古いビルドを試さない）。
//
// 環境変数
//   PW_MODE           配信するビルドの mode（既定 e2e。出力先は vite.config.ts の mode の outDir に従う。S2 から e2e-crazygames も）
//   PW_DIST           配信するディレクトリを直接指定する（PoC の sdk-live.spec.ts 用。mode の outDir より優先）
//   PW_HOST / PW_PORT 待ち受けのホストとポート（既定 127.0.0.1:4174）
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';

const mode = process.env.PW_MODE ?? 'e2e';
const host = process.env.PW_HOST ?? '127.0.0.1';
const port = Number(process.env.PW_PORT ?? 4174);
const dist = process.env.PW_DIST;

const server = await preview({
  mode,
  ...(dist ? { build: { outDir: dist } } : {}),
  preview: { host, port, strictPort: true, open: false },
  logLevel: 'info',
});

const outDir = dist ?? server.config.build.outDir;
if (!existsSync(resolve(server.config.root, outDir, 'index.html'))) {
  console.error(`[e2e] ${outDir}/index.html がありません。先に \`npm run build:e2e\` を実行してください（webServer はビルドしません）`);
  await server.close();
  process.exit(1);
}
console.log(`[e2e] mode=${mode} の ${outDir} を http://${host}:${port}/ で配信しています`);
server.printUrls();

const stop = () => {
  void server.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
