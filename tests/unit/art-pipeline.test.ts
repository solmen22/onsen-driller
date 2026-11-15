// BL-061: パレットとアトラスのパイプライン（npm run art。assets-src/pipeline.ts・scripts/build-art.mjs。gdd §14-1・§14-3）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SpriteDef } from '../../assets-src/lib.ts';
import { buildArt, PALETTE_GROUPS, paletteErrors, recolor, type PaletteFile } from '../../assets-src/pipeline.ts';
import { loadArtInput } from '../../assets-src/sources.ts';
import { terrainSwaps } from '../../assets-src/terrains.ts';
import { INITIAL_TERRAIN, TERRAIN_IDS } from '../../src/content/terrains.ts';

const root = new URL('../../', import.meta.url);
const palette = JSON.parse(readFileSync(new URL('assets-src/palette.json', root), 'utf8')) as PaletteFile;
const clone = (): PaletteFile => JSON.parse(JSON.stringify(palette)) as PaletteFile;

/** 2×1 の小さなスプライト */
const tiny = (id: string, a: string, b: string): SpriteDef => ({ id, w: 2, h: 1, key: { a, b }, rows: ['ab'] });

describe('パレット（32 色。土の暖色 12・湯の青緑 6・湯けむりの白 4・UI 用 10）', () => {
  it('assets-src/palette.json は検査を通り、4 つの組に 1 回ずつ入っている', () => {
    expect(paletteErrors(palette)).toEqual([]);
    expect(Object.keys(palette.colors)).toHaveLength(32);
    for (const [g, n] of Object.entries(PALETTE_GROUPS)) expect(palette.groups[g], g).toHaveLength(n);
    expect(PALETTE_GROUPS).toEqual({ soil: 12, water: 6, steam: 4, ui: 10 });
  });
  it('組の数の違い・2 つの組に入った色・どの組にもない色・パレットにない名前・同じ色の値は失敗', () => {
    let p = clone();
    p.groups.water = p.groups.water!.slice(1);
    expect(paletteErrors(p).join('\n')).toMatch(/組 'water' の色の数 5 ≠ 6[\s\S]*どの組にも入っていない/);
    p = clone();
    p.groups.ui = [...p.groups.ui!.slice(1), p.groups.soil![0]!];
    expect(paletteErrors(p).join('\n')).toMatch(/両方にある/);
    p = clone();
    p.groups.steam = [...p.groups.steam!.slice(1), 'nothere'];
    expect(paletteErrors(p).join('\n')).toMatch(/'nothere' がパレットにない/);
    p = clone();
    p.colors.extra = '#010203';
    expect(paletteErrors(p).join('\n')).toMatch(/色の数 33 ≠ 32/);
    p = clone();
    p.colors.ink = p.colors.steam!;
    expect(paletteErrors(p).join('\n')).toMatch(/と同じ/);
  });
});

describe('変換の検査', () => {
  const input = () => loadArtInput(clone());

  it('パレットにない色を使うスプライトは失敗し、生成物を作らない', () => {
    const base = input();
    const out = buildArt({ ...base, others: [...base.others, tiny('bad-color', 'ink', 'magenta')] });
    expect(out.errors).toEqual(["bad-color: パレットにない色 'magenta'"]);
    expect(out.png).toBeUndefined();
    expect(out.json).toBeUndefined();
  });
  it('地形の差し替えの元・先がパレットにないと失敗する', () => {
    const base = input();
    const out = buildArt({ ...base, terrains: { ...base.terrains, desert: { soil: 'magenta', nope: 'ink' } } });
    expect([...out.errors].sort()).toEqual(["地形 desert: 差し替えの元 'nope' がパレットにない", "地形 desert: 差し替えの先 'magenta' がパレットにない"].sort());
    expect(out.png).toBeUndefined();
  });
  it('差し替えは同時に当てる（連鎖しない）。ない色はそのまま、形も変えない', () => {
    const s: SpriteDef = { id: 'x', w: 3, h: 1, key: { a: 'soil', b: 'clay', c: 'ink' }, rows: ['ab.'] };
    const r = recolor(s, 'y', { soil: 'clay', clay: 'ochre' });
    expect(r).toEqual({ id: 'y', w: 3, h: 1, key: { a: 'clay', b: 'ochre', c: 'ink' }, rows: ['ab.'] });
    expect(s.key.a, '元は変えない').toBe('soil');
  });
});

describe('生成物（src/generated/atlas.png・atlas.json）', () => {
  const out = buildArt(loadArtInput(clone()));

  it('npm run art と同じ入力で作ったものが、コミットした生成物とバイト単位で一致する（生成し忘れ・手で直した生成物を見つける）', () => {
    expect(out.errors).toEqual([]);
    expect(out.json).toBe(readFileSync(new URL('src/generated/atlas.json', root), 'utf8'));
    expect(out.png?.equals(readFileSync(new URL('src/generated/atlas.png', root)))).toBe(true);
  });
  it('パレットの 32 色をすべて使い、アトラスは 1 枚', () => {
    expect(out.used.size).toBe(32);
    const meta = (JSON.parse(out.json ?? '{}') as { meta: { image: string } }).meta;
    expect(meta.image).toBe('atlas.png');
  });
  it('地形の色替えは、山あい以外の地形（TERRAIN_IDS と同じ）ごとに地層タイル 24 枚。形は同じで、色だけがパレットの中で変わる', () => {
    expect(Object.keys(terrainSwaps).sort()).toEqual(TERRAIN_IDS.filter((t) => t !== INITIAL_TERRAIN).sort());
    const byId = new Map(out.sprites.map((s) => [s.id, s]));
    const base = out.sprites.filter((s) => s.tile && /^tile-[a-z]+-\d$/.test(s.id));
    expect(base).toHaveLength(24);
    for (const t of Object.keys(terrainSwaps)) {
      let changed = 0;
      for (const s of base) {
        const v = byId.get(s.id.replace(/^tile-/, `tile-${t}-`));
        expect(v, `${t} ${s.id}`).toBeDefined();
        if (!v) continue;
        expect(v.rows, `${t} ${s.id}: 形は同じ`).toEqual(s.rows);
        expect(v.tile).toBe(true);
        for (const name of Object.values(v.key)) expect(palette.colors[name], name).toBeDefined();
        if (Object.keys(s.key).some((ch) => s.key[ch] !== v.key[ch])) changed++;
      }
      expect(changed, `${t}: どのタイルも色が変わる`).toBe(24);
    }
  });
});
