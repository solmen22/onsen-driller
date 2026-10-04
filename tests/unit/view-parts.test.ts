// BL-036: 描画の小さな部品（Phaser に依存しない）: TilePool・crackStage・PopupQueue・toolTexture・地層の見た目
// （TS-036-01・04・05・06・07。Q-19）
import { describe, expect, it } from 'vitest';
import atlas from '../../src/generated/atlas.json';
import { ORE_IDS } from '../../src/content/ores.ts';
import { STRATA } from '../../src/content/strata.ts';
import { TOOLS } from '../../src/content/tools.ts';
import { CrackTracker, crackFrame, crackStage } from '../../src/view/cracks.ts';
import { tileGridSize } from '../../src/view/layout.ts';
import { mergeBreaks, POPUP_MAX, PopupQueue, popupText, type BreakPop } from '../../src/view/popups.ts';
import { decoAt, DECO_PERCENT, glintAlpha, nextSpringHint, ORE_TINT, tileFrame, tileVariant } from '../../src/view/strata-look.ts';
import { TilePool, type PooledSprite } from '../../src/view/tile-pool.ts';
import { applyToolTexture, TOOL_FRAMES, toolTexture } from '../../src/view/tools.ts';

const frames = new Set(Object.keys((atlas as { frames: Record<string, unknown> }).frames));

class FakeSprite implements PooledSprite {
  static made = 0;
  static destroyed = 0;
  visible = false;
  x = 0;
  y = 0;
  frame = '';
  tint = 0xffffff;
  constructor() {
    FakeSprite.made++;
  }
  setVisible(v: boolean): this {
    this.visible = v;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  setFrame(f: string): this {
    this.frame = f;
    return this;
  }
  setTint(c: number): this {
    this.tint = c;
    return this;
  }
  destroy(): void {
    FakeSprite.destroyed++;
  }
}

describe('TS-036-01 TilePool: スプライトの数は画面の大きさだけで決まり、深さで増えない', () => {
  it('0m〜300m 相当までカメラを 1m ずつ動かしても数が一定。画面の高さを変えたときだけ変わる', () => {
    FakeSprite.made = 0;
    const pool = new TilePool(() => new FakeSprite());
    const g = tileGridSize(1280 / 4 / 1.72, (720 * 0.75) / 4); // 横 1280×720 のステージ（幅 58%）・×4
    pool.resize(g.cols, g.rows);
    const n = pool.size;
    expect(n).toBe(g.cols * g.rows);
    expect(g.rows).toBeGreaterThanOrEqual(10);
    expect(g.rows).toBeLessThanOrEqual(15);
    for (let row = 0; row <= 300; row++) {
      pool.layout(row - 1, -3, 16, -8, (r, c) => (r < 0 ? null : { frame: `tile-${r % 3}-${c & 1}` }));
      expect(pool.size).toBe(n);
    }
    expect(FakeSprite.made).toBe(n);
    const g2 = tileGridSize(200, 300);
    pool.resize(g2.cols, g2.rows);
    expect(pool.size).toBe(g2.cols * g2.rows);
  });
  it('マスの位置・見た目・隠す（null）を付け替える', () => {
    const made: FakeSprite[] = [];
    const pool = new TilePool(() => {
      const s = new FakeSprite();
      made.push(s);
      return s;
    });
    pool.resize(2, 2);
    pool.layout(-1, -1, 16, -8, (r, c) => (r < 0 ? null : { frame: `f${r}${c}`, tint: 0x123456 }));
    expect(made.map((s) => [s.visible, s.frame, s.x, s.y])).toEqual([
      [false, '', 0, 0],
      [false, '', 0, 0],
      [true, 'f0-1', -24, 0],
      [true, 'f00', -8, 0],
    ]);
    expect(made[2]?.tint).toBe(0x123456);
    pool.destroy();
    expect(pool.size).toBe(0);
  });
});

describe('TS-036-04 crackStage（0.25・0.5・0.75 で段が上がる。同じブロックの間は下げない。Q-19）', () => {
  it('閾値の直前・ちょうど', () => {
    const cases: [number, number][] = [
      [0, 0],
      [-1, 0],
      [Number.NaN, 0],
      [0.0001, 1],
      [0.2499, 1],
      [0.25, 2],
      [0.4999, 2],
      [0.5, 3],
      [0.7499, 3],
      [0.75, 4],
      [0.9999, 4],
    ];
    for (const [r, want] of cases) expect(crackStage(r), String(r)).toBe(want);
    expect([0, 1, 2, 3, 4].map(crackFrame)).toEqual([null, 'crack-1', 'crack-2', 'crack-3', 'crack-4']);
    for (let s = 1; s <= 4; s++) expect(frames.has(`crack-${s}`)).toBe(true);
  });
  it('同じ深さの間は段を下げず（HP が増えて割合が下がっても）、次のブロックで 0 に戻る', () => {
    const c = new CrackTracker();
    expect(c.update(5, 0.6)).toBe(3);
    expect(c.update(5, 0.3)).toBe(3);
    expect(c.update(5, 0.8)).toBe(4);
    expect(c.update(6, 0)).toBe(0);
  });
});

describe('TS-036-05・06 PopupQueue（同時 20 まで。21 個目は最も古いものを使い回す。1 フレームに 4 個以上はまとめる）', () => {
  const pop = (depth: number, coins = '1e0', ore: string | null = null): BreakPop => ({ depth, coins, ore, count: 1 });
  it('BlockBroken 1 つでポップが 1 つ加わり、文字は「+コイン」（鉱石は名前つき）', () => {
    const q = new PopupQueue<BreakPop>();
    q.add(pop(3, '1.25e1'), 0);
    expect(q.active).toBe(1);
    expect(popupText(pop(3, '1.25e1'), null)).toBe('+12.5'); // BL-011: 毎秒の量と同じ形（100 未満は小数 2 桁まで切り捨て。四捨五入しない）
    expect(popupText(pop(3, '9.6e1', 'quartz'), '石英')).toBe('石英 +96');
    expect(popupText(pop(3, '9.6e1', 'quartz'), 'Quartz')).toBe('Quartz +96');
    expect(popupText(pop(0, '5e-1'), null)).toBe('+0.5');
  });
  it('1 秒に 100 個（1 フレームに 1 個ずつ）でも同時に 20 以下、古いものから使い回す', () => {
    const q = new PopupQueue<BreakPop>(POPUP_MAX, 700);
    let maxActive = 0;
    for (let i = 0; i < 100; i++) {
      const now = i * 10;
      q.expire(now);
      const r = q.add(pop(i), now);
      if (i >= 20 && i < 70) expect(r.recycled).toBe(true);
      maxActive = Math.max(maxActive, q.active);
    }
    expect(maxActive).toBe(20);
    // 最新の 20 個が残っている
    const depths = Array.from({ length: 20 }, (_, i) => q.slot(i)?.item.depth).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(depths).toEqual(Array.from({ length: 20 }, (_, i) => 80 + i));
  });
  it('1 フレームに 4 個以上はまとめて 1 つ（合計のコイン・×個数）、3 個ならそのまま 3 つ', () => {
    const q = new PopupQueue<BreakPop>();
    expect(q.addFrame([pop(1), pop(2), pop(3)], 0, mergeBreaks)).toHaveLength(3);
    const merged = q.addFrame([pop(4, '1e0'), pop(5, '2e0', 'amber'), pop(6, '3e0'), pop(7, '4e0')], 0, mergeBreaks);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.item).toEqual({ depth: 7, coins: '1e1', ore: null, count: 4 });
    expect(popupText(merged[0]!.item, null)).toBe('+10 ×4');
  });
  it('寿命（700ms）で消える', () => {
    const q = new PopupQueue<BreakPop>(20, 700);
    q.add(pop(1), 0);
    expect(q.expire(699)).toEqual([]);
    expect(q.expire(700)).toEqual([0]);
    expect(q.active).toBe(0);
  });
  it('TS-011-14 ポップの数は HUD と同じ表記の関数（言語と数値表記の設定に従う。BL-011・Q-32 ⑥）', () => {
    const p = (coins: string) => pop(3, coins);
    expect(popupText(p('1.2345e4'), null, 'ja', 'auto')).toBe('+1.23万');
    expect(popupText(p('1.2345e4'), null, 'en', 'auto')).toBe('+12.3K');
    expect(popupText(p('1.2345e4'), null, 'en', 'exp')).toBe('+1.23e4');
    expect(popupText(p('9.96e0'), null, 'ja', 'auto')).toBe('+9.96');
    expect(popupText(p('5.2e-1'), null, 'en', 'auto')).toBe('+0.52');
    expect(popupText(p('0'), null, 'en', 'auto')).toBe('+0');
    expect(popupText(p('1.5e30'), 'Quartz', 'en', 'auto')).toBe('Quartz +1.5No');
    expect(popupText(p('1.5e30'), '石英', 'ja', 'auto')).toBe('石英 +150穣');
    expect(popupText({ depth: 3, coins: '1.2345e4', ore: null, count: 5 }, null, 'ja', 'auto')).toBe('+1.23万 ×5');
  });
});

describe('TS-036-07 toolTexture と ToolEvolved', () => {
  it('道具 0〜7 で段ごとに違うテクスチャのキー。すべてアトラスにある。範囲外は端に丸める', () => {
    const keys = TOOLS.map((_, i) => toolTexture(i));
    expect(keys).toEqual([...TOOL_FRAMES]);
    expect(new Set(keys).size).toBe(8);
    for (const k of keys) expect(frames.has(k), k).toBe(true);
    expect([toolTexture(-1), toolTexture(99), toolTexture(Number.NaN)]).toEqual(['tool-shovel', 'tool-legenddrill', 'tool-shovel']);
  });
  it('ToolEvolved{tool:1} でスプライトのキーが差し替わる（同じなら何もしない）', () => {
    const sprite = {
      frame: { name: 'tool-shovel' },
      setFrame(f: string) {
        this.frame.name = f;
      },
    };
    expect(applyToolTexture(sprite, 1)).toBe(true);
    expect(sprite.frame.name).toBe('tool-pickaxe');
    expect(applyToolTexture(sprite, 1)).toBe(false);
  });
});

describe('地層の見た目（帯ごとの 4 種の変化形・飾り・鉱石の色・源泉の気配。PoC-5 の CEO レビュー）', () => {
  it('6 帯 × 4 種のタイルがすべてアトラスにあり、変化形はマスごとに決まって 4 種とも出る', () => {
    for (let b = 0; b < STRATA.length; b++) for (let v = 0; v < 4; v++) expect(frames.has(tileFrame(b, v)), tileFrame(b, v)).toBe(true);
    const seen = new Set<number>();
    for (let r = 0; r < 50; r++) for (let c = -6; c <= 6; c++) seen.add(tileVariant(123, r, c));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(tileVariant(123, 7, 2)).toBe(tileVariant(123, 7, 2));
  });
  it('飾りは縦穴には置かず、約 9% のマス。どれもアトラスにある', () => {
    let n = 0;
    let total = 0;
    for (let b = 0; b < STRATA.length; b++)
      for (let r = 0; r < 400; r++)
        for (let c = -8; c <= 8; c++) {
          const d = decoAt(7, r, c, b);
          if (c === 0) expect(d).toBeNull();
          else {
            total++;
            if (d) {
              n++;
              expect(frames.has(d), d).toBe(true);
            }
          }
        }
    expect(n / total).toBeGreaterThan((DECO_PERCENT - 2) / 100);
    expect(n / total).toBeLessThan((DECO_PERCENT + 2) / 100);
  });
  it('鉱石 12 種に色、きらめきと源泉の気配の絵がある。次の源泉は未発見のいちばん浅いもの', () => {
    expect(Object.keys(ORE_TINT).sort()).toEqual([...ORE_IDS].sort());
    expect(frames.has('ore-gem') && frames.has('spring-hint')).toBe(true);
    expect(nextSpringHint(() => false)).toEqual({ id: 'simple', depth: 30 });
    expect(nextSpringHint((id) => id === 'simple')).toEqual({ id: 'co2', depth: 80 });
    expect(nextSpringHint(() => true)).toBeNull();
    for (let t = 0; t < 5000; t += 37) {
      const a = glintAlpha(t, 3);
      expect(a).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(a).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
