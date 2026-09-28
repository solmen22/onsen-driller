// 鉱石 12 種（gdd §5-1。帯ごとに 2 種）。種類は「帯の 1 種目が 70%、2 種目が 30%」を別のハッシュで決める（Q-07）。
// 価値は S1 ではどちらも ×8（params.block.oreMult）。希少度（weight）は図鑑と効果音の音程にだけ使う。
// 名前は i18n のキー（ore.<id>）。文章は i18n/*.json に置く

export const ORE_IDS = [
  'quartz',
  'amber',
  'copper',
  'obsidian',
  'silver',
  'ammonite',
  'jade',
  'sulfurCrystal',
  'gold',
  'rockCrystal',
  'ruby',
  'lavaStone',
] as const;
export type OreId = (typeof ORE_IDS)[number];

export interface OreDef {
  id: OreId;
  /** 出る帯（0 始まり。content/strata.ts の添字） */
  band: number;
  /** 帯の中での割合（1 種目 0.7・2 種目 0.3） */
  weight: number;
  /** i18n のキー */
  nameKey: `ore.${OreId}`;
}

const ore = (id: OreId, band: number, weight: number): OreDef => ({ id, band, weight, nameKey: `ore.${id}` });

export const ORES: readonly OreDef[] = [
  ore('quartz', 0, 0.7),
  ore('amber', 0, 0.3),
  ore('copper', 1, 0.7),
  ore('obsidian', 1, 0.3),
  ore('silver', 2, 0.7),
  ore('ammonite', 2, 0.3),
  ore('jade', 3, 0.7),
  ore('sulfurCrystal', 3, 0.3),
  ore('gold', 4, 0.7),
  ore('rockCrystal', 4, 0.3),
  ore('ruby', 5, 0.7),
  ore('lavaStone', 5, 0.3),
];

export const ORE_BY_ID: Readonly<Record<OreId, OreDef>> = Object.fromEntries(ORES.map((o) => [o.id, o])) as Record<OreId, OreDef>;
