// 地層 6 帯（gdd §5-1。地形「山あい」）。帯の番号はコードとイベントでは 0 始まり（band 0 が帯 1）。
// 新しい帯に周回の中で初めて入ると 1.5 秒の幕間（params.interludeMs）。帯 4〜6（band 3〜5）の幕間の終わりは M2 の機会（Q-06）
import type { OreId } from './ores.ts';

export const STRATUM_IDS = ['topsoil', 'clay', 'sandstone', 'tuff', 'granite', 'basalt'] as const;
export type StratumId = (typeof STRATUM_IDS)[number];

export interface StratumDef {
  id: StratumId;
  /** 帯の始まりの深さ（m。この深さのブロックからこの帯） */
  start: number;
  /** 帯の 1 種目・2 種目の鉱石（content/ores.ts） */
  ores: readonly [OreId, OreId];
  /** i18n のキー（帯の名前。幕間のカード） */
  nameKey: `stratum.${StratumId}`;
}

const stratum = (id: StratumId, start: number, ores: readonly [OreId, OreId]): StratumDef => ({ id, start, ores, nameKey: `stratum.${id}` });

export const STRATA: readonly StratumDef[] = [
  stratum('topsoil', 0, ['quartz', 'amber']),
  stratum('clay', 30, ['copper', 'obsidian']),
  stratum('sandstone', 80, ['silver', 'ammonite']),
  stratum('tuff', 150, ['jade', 'sulfurCrystal']),
  stratum('granite', 250, ['gold', 'rockCrystal']),
  stratum('basalt', 400, ['ruby', 'lavaStone']),
];

/** M2（ミッドゲーム広告の機会）を出す最初の帯（0 始まり。帯 4 = 150m） */
export const M2_FIRST_BAND = 3;
