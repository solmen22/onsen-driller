// 地形ごとの地層の配色（gdd §5-8・§14-1。BL-061）。同じパレットの中の色の差し替え（元の名前 → 新しい名前）で、
// 山あいの地層タイル（strata.ts）から作る。差し替えは同時に当てる（連鎖しない）。ここにない色はそのまま。
// 地形の id は src/content/terrains.ts の TERRAIN_IDS と同じ（山あい mountain は元の色なので書かない）。
// 地形の配色を画面に出す（周回の地形でタイルを選ぶ）のは BL-040。ここでは素材を作るところまで
import type { Swap } from './pipeline.ts';

/** 火山のふもと: 焦げた暗い土と灰（地層が硬い。gdd §5-8 の「背景は赤い空と噴煙」に合わせて暗く赤く寄せる） */
const volcano: Swap = {
  // 表土: 1 段暗く
  soilMid: 'soilDark',
  soil: 'soilMid',
  soilLight: 'soil',
  sand: 'clayDark',
  // 粘土: 赤を深く
  clay: 'clayDark',
  clayLight: 'clay',
  clayDark: 'soilDark',
  // 砂岩: 黄土を焦がす
  ochre: 'ochreDark',
  ochreLight: 'ochre',
  ochreDark: 'soilMid',
  // 凝灰岩: 灰色に
  tuff: 'tuffDark',
  tuffLight: 'tuff',
  tuffDark: 'metalDark',
  // 花崗岩・玄武岩: 灰を暗く（赤い筋はそのまま）
  steamDark: 'metal',
  steamMid: 'steamDark',
  metal: 'metalDark',
  metalDark: 'ink',
};

/** 海辺: 砂まじりの明るい土（地層が柔らかい） */
const seaside: Swap = {
  // 表土: 砂に寄せて 1 段明るく
  soilDark: 'soilMid',
  soilMid: 'soil',
  soil: 'soilLight',
  soilLight: 'sand',
  sand: 'ochreLight',
  // 粘土: 明るい赤茶
  clayDark: 'clay',
  clay: 'clayLight',
  clayLight: 'sand',
  // 砂岩: 白っぽい黄土
  ochreDark: 'ochre',
  ochre: 'ochreLight',
  ochreLight: 'cream',
  // 凝灰岩: 明るい灰緑
  tuffDark: 'tuff',
  tuff: 'tuffLight',
  tuffLight: 'steamDark',
  // 花崗岩・玄武岩: 灰を明るく
  steamDark: 'steamMid',
  steamMid: 'steam',
  metalDark: 'metal',
  metal: 'metalLight',
};

export const terrainSwaps: Readonly<Record<string, Swap>> = { volcano, seaside };
