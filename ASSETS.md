# 素材台帳（gdd §14-3）

ビルドに含まれる画像・音声・フォントをすべて記録する。`check:assets`（E12）はこの表と突き合わせる。

| 素材 | 区分 | 入手元・作り方 | ライセンス | 改変 | ツール・モデル | 作成日 | 備考 |
|---|---|---|---|---|---|---|---|
| tile-topsoil・tile-clay・tile-sandstone・tile-tuff（16×16） | コードで描画 | `assets-src/sprites/tiles.ts` の画素配列を `scripts/build-art.mjs` で PNG 化 | 自作（本プロダクトの権利） | — | AI エージェント（Claude）が画素配列を記述 | 2026-09-28 | PoC 版。帯ごとに 4 種へ増やす（E12） |
| tool-shovel・tool-pickaxe（24×24） | コードで描画 | `assets-src/sprites/objects.ts`（Grid の線・楕円＋画素） | 自作 | — | 同上 | 2026-09-28 | |
| guest-tanuki（24×24） | コードで描画 | 同上 | 自作 | — | 同上 | 2026-09-28 | 他作品のキャラクターを参照していない |
| bath-tub（48×24） | コードで描画 | 同上 | 自作 | — | 同上 | 2026-09-28 | |
| p-chip・p-steam・p-spark・p-coin | コードで描画 | 同上 | 自作 | — | 同上 | 2026-09-28 | パーティクル |
| パレット（32 色） | 自作 | `assets-src/palette.json` | 自作 | — | — | 2026-09-28 | |
| DotGothic16 | フォント（OFL） | https://github.com/google/fonts/tree/main/ofl/dotgothic16 （原作 https://github.com/fontworks-fonts/DotGothic16） | SIL OFL 1.1（`LICENSES/OFL-DotGothic16.txt`） | 使用文字だけにサブセット（`scripts/subset-font.mjs`） | subset-font 2.9.0（harfbuzz） | 2026-09-28 取得 | 元の TTF はリポジトリに入れない（.gitignore） |
| 効果音（打撃・破壊） | コードで生成 | ZzFX のパラメータ（`src/audio/sfx.ts`） | ZzFX は MIT | — | — | 2026-09-28 | 音声ファイルなし |
