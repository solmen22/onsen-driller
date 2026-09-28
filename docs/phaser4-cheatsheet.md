# Phaser 4 早見表（onsen-driller で使う範囲）

- 対象: `phaser@4.2.1`（package.json で固定）。PoC（2026-09-28）で動作を確認したものだけを載せる。
- 目的: AI エージェントが Phaser 3 の書き方を混ぜないようにする（arch §14・§26）。
- 迷ったら `node_modules/phaser/types/phaser.d.ts` を grep して、v4 の型で確かめる。

## 使ってよいもの（確認済み）

| 用途 | v4 の書き方 | 備考 |
|---|---|---|
| import | `import Phaser from 'phaser'` | exports は `dist/phaser.esm.js`。gzip 約 360KB（本件のバンドル） |
| Game の作成 | `new Phaser.Game({ type: Phaser.AUTO, parent, pixelArt: true, roundPixels: true, scale: { mode: Phaser.Scale.RESIZE, width, height }, audio: { noAudio: true }, input: { keyboard: false, mouse: false, touch: false, gamepad: false }, banner: false, scene: [new MineScene(bridge)] })` | 入力は DOM、音は ZzFX（arch §7）。シーンはインスタンスで渡してよい |
| 準備完了 | `game.events.once(Phaser.Core.Events.READY, fn)` | |
| アトラス | `this.load.atlas('atlas', pngUrl, jsonObject)` | JSON はオブジェクトのまま渡せる。PNG は `import url from '…png?url'` |
| 画像 | `this.add.image(x, y, 'atlas', frame).setOrigin(…).setDepth(…)`、`setFrame(name)` | |
| 色 | `obj.setTint(0xrrggbb)`。塗りつぶしは `obj.setTint(c).setTintMode(Phaser.TintModes.FILL)` | **v3 の `setTintFill()` は使わない**（v4 では色とモードが別） |
| 矩形 | `this.add.rectangle(x, y, w, h, color)` | |
| テキスト | `this.add.text(x, y, s, { fontFamily, fontSize, color, stroke, strokeThickness }).setResolution(4)` | 数字のポップだけに使う。UI の文字は DOM |
| パーティクル | `const e = this.add.particles(x, y, 'atlas', { frame, lifespan, speed, angle, gravityY, emitting: false, maxAliveParticles })` → `e.explode(n, x, y)` | 戻り値は ParticleEmitter（v3.60 以降と同じ形）。`setParticleTint(c)`、`getAliveParticleCount()`、`emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(…), quantity }` |
| トゥイーン | `this.tweens.add({ targets, y, angle, duration, ease: 'Quad.easeIn', onComplete })` | |
| カメラ | `this.cameras.main.setZoom(z)`、`centerOn(x, y)`、`shake(ms, intensity)` | ズームは整数（×2〜×4）にする |
| 大きさの変更 | `this.scale.on(Phaser.Scale.Events.RESIZE, fn)`、`this.scale.gameSize` | RESIZE モードで親要素に合わせる |
| 描画の後 | `this.game.events.on(Phaser.Core.Events.POST_RENDER, fn)` | タップの反応時間の計測に使った |
| WebGL の喪失 | `renderer.on(Phaser.Renderer.Events.LOSE_WEBGL, fn)`、`RESTORE_WEBGL` | `renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer` で確かめてから。アトラスは自動で戻る（PoC で確認）。動的テクスチャを作ったら RESTORE で描き直す |
| 画面の取得 | `game.renderer.snapshot((img) => …)` | テスト用 |
| 更新 | `override update(time: number, delta: number): void` | TS の `noImplicitOverride` のため `override` を付ける |

## 使わないもの・注意

| もの | 理由 |
|---|---|
| Phaser の入力（`this.input`）・音（`this.sound`） | 入力は DOM のポインタ、音は ZzFX（arch §7・§14） |
| `preFX`・`postFX`・パイプライン | v4 で「filters」に作り直されている。使うときは型定義と公式の説明を先に確認し、この表に足す |
| `setTintFill()` | v4 では非推奨。上の書き方にする |
| `resolution`（Game の設定） | 使わない。DPR が高い端末でも、`pixelArt: true`＋CSS の `image-rendering: pixelated`＋整数ズームで、くっきり出る（PoC の DPR 3 のスクリーンショットで確認） |
| Arcade Physics・Matter | 不要（バンドルも増える） |
