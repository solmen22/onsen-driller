# 素材台帳（gdd §14-3）

ビルドに含まれる画像・音声・フォントをすべて記録する。`npm run check:assets`（BL-008）はこの表と突き合わせる。

- 書式は DevOps の infra.md 付録 B-3（Q-15 の回答）。見出しの 1 列目が「素材名」の表を台帳として読む。
- 「ファイル名」の列には、ビルドに出るファイル名を Vite のハッシュなしで書く（`assets/atlas-hmrc6vr3.png` → `atlas.png`）。アトラスのように 1 つのファイルに複数の素材が入る場合は、各行に同じファイル名を書く。ファイルのない行（パレット・コードで生成する効果音）は「—」。
- 区分は「AI 生成」「コードで描画」「CC0」「自作」と、CEO 承認で追加した「フォント（OFL）」「コードで生成（効果音など）」。
- 画像生成 AI は使っていない（使うときは「ツール／モデル／プラン」「プロンプトの要旨」を必ず書く。有料なら事前にオーナー承認）。

| 素材名 | ファイル名 | 区分 | 入手元 | ライセンス | 改変の有無 | ツール／モデル／プラン | 生成日 | プロンプトの要旨 | 人の修正の有無 |
|---|---|---|---|---|---|---|---|---|---|
| アトラス（下の行の絵をまとめたもの） | `atlas.png` | コードで描画 | `scripts/build-art.mjs` が `assets-src/sprites/` の画素配列から生成 | 自作（本プロダクトの権利） | — | AI エージェント（Claude）が画素配列を記述 | 2026-09-28 | —（画像生成 AI は不使用） | なし |
| tile-topsoil・tile-clay・tile-sandstone・tile-tuff（16×16） | `atlas.png` | コードで描画 | `assets-src/sprites/tiles.ts` の画素配列 | 自作 | — | 同上 | 2026-09-28 | — | なし |
| tool-shovel・tool-pickaxe（24×24） | `atlas.png` | コードで描画 | `assets-src/sprites/objects.ts`（Grid の線・楕円＋画素） | 自作 | — | 同上 | 2026-09-28 | — | なし |
| guest-tanuki（24×24） | `atlas.png` | コードで描画 | 同上。他作品のキャラクターを参照していない | 自作 | — | 同上 | 2026-09-28 | — | なし |
| bath-tub（48×24） | `atlas.png` | コードで描画 | 同上 | 自作 | — | 同上 | 2026-09-28 | — | なし |
| パーティクル p-chip・p-steam・p-spark・p-coin（8×8） | `atlas.png` | コードで描画 | 同上 | 自作 | — | 同上 | 2026-09-28 | — | なし |
| パレット（32 色） | — | 自作 | `assets-src/palette.json` | 自作 | — | — | 2026-09-28 | — | — |
| DotGothic16 サブセット | `dotgothic16-subset.woff2` | フォント（OFL） | https://github.com/google/fonts/tree/main/ofl/dotgothic16 （原作 https://github.com/fontworks-fonts/DotGothic16） | SIL OFL 1.1（`LICENSES/OFL-DotGothic16.txt`） | 使用文字だけにサブセット（`scripts/subset-font.mjs`） | subset-font 2.9.0（harfbuzz） | 2026-09-28 取得 | — | なし |
| 効果音（打撃・破壊） | —（音声ファイルなし） | コードで生成（効果音など） | ZzFX のパラメータ（`src/audio/sfx.ts`） | ZzFX は MIT | — | — | 2026-09-28 | — | なし |
