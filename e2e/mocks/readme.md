# ポータル SDK のモック（e2e/mocks/）

BL-072（QA テスト戦略 §4-2、arch §4・§12-3）。置き場所は `e2e/mocks/`（確認事項 Q-28 の決定。arch §4 と QA §4-2 のとおり）。

| ファイル | SDK | 使う場所 |
|---|---|---|
| `crazygames.ts` | CrazyGames HTML5 SDK v3 | L2: `createCrazyMock()` を関数として注入（`tests/integration/crazygames-contract.test.ts`・`platform.test.ts`）／L3: `crazyMockScript()` を `page.route` で SDK の script の代わりに返す（`e2e/support/crazygames.ts` の `bootCrazyGames`） |
| `poki.ts` | Poki HTML5 SDK v2 | L2 の契約テストだけ（E2E と広げ方は S4 の BL-060） |

- `tests/mocks/sdk.ts` は S1 からの名前で残した再 export（BL-057 のブランチが import している。BL-057 のマージの後に消す）。
- モックそのものの自己テストは `tests/unit/sdk-mock.test.ts`（TS-072-01。設定が効かないモックでは契約テストが偽の緑になるため）。

## 決まりごと

1. **SDK の仕様（arch §12-3）が変わったら、アダプタ（`src/platform/*.ts`）とモックを同じ PR で直す**（BL-072 の受け入れ基準。コードレビューの確認項目）。モックは `CrazySdk`・`PokiSdk` の型を満たすので、アダプタが新しい API を使うとモックの型エラーで気づく（TS-072-02）。
2. `createCrazyMock` の中身は**外の変数・import した値を使わない**。L3 では関数の文字列（`toString`）をページで動かすため。型だけは使ってよい（変換で消える）。`tests/unit/sdk-mock.test.ts` が別の実行環境（`node:vm`）で script を動かして確かめる。
3. L3 では `sdk.crazygames.com` をオリジンの許可リストに**足さない**。モックが応答を返した URL だけを共通の検査で許す（`harness.mockedUrls`）。差し替えを忘れると、SDK の要求は中止されて TS-COM-01 で落ちる（本物の SDK に黙って通信しない。TS-072-04）。
4. モックで再現する振る舞い（`CrazyMockConfig`）: init の成功・失敗・返らない・遅延、`environment` の 3 種、`game` の呼び出しの記録（`log`＝S1 の形、`calls`＝data なども含むすべて）、`muteAudio` の変更、`requestAd` の最後まで再生・`adError` 4 種（＋未知のコード）・始まった後の失敗・コールバックが来ない、`hasAdblock`、data モジュールの上限（UTF-8 のバイト数の合計。既定 1,000,000。例外か黙って捨てる）・キーのないときの `null`／`undefined`・読めない、`user.systemInfo.locale`。本物の SDK の上限を超えたときの振る舞い（例外か）は未確認なので、両方を用意した。
