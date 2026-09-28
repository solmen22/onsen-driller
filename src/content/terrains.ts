// 地形 3 種の ID（gdd §5-8）。中身（源泉の深さ・倍率・配色）は S3 の BL-024 で足す
export const TERRAIN_IDS = ['mountain', 'volcano', 'seaside'] as const;
export type TerrainId = (typeof TERRAIN_IDS)[number];
export const INITIAL_TERRAIN: TerrainId = 'mountain';
