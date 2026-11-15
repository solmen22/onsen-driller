// アトラスに入れる素材の一覧（BL-061）。scripts/build-art.mjs と tests/unit/art-pipeline.test.ts が同じ入力から作る
import type { ArtInput, PaletteFile } from './pipeline.ts';
import { objects } from './sprites/objects.ts';
import { props } from './sprites/props.ts';
import { strataTiles } from './sprites/strata.ts';
import { terrainSwaps } from './terrains.ts';

/**
 * 地層タイルは 6 帯 × 4 種の変化形（strata.ts が tiles.ts の手で打ったタイルから作る）と、その地形の色替え。
 * tiles.ts のタイル自体はアトラスに入れない
 */
export function loadArtInput(palette: PaletteFile): ArtInput {
  return { palette, strata: strataTiles, others: [...objects, ...props], terrains: terrainSwaps };
}
