import type { NeighbourhoodIndex, NeighbourhoodShard, NeighbourhoodSource } from '../../../src/core/address/neighbourhoods';

export const sampleShard: NeighbourhoodShard = {
  v: 1,
  plate: '34',
  districts: [
    { name: 'Kadıköy', groups: [['34710', ['Moda Mah', 'Hasanpaşa']], ['34720', ['Zeytinlik (Çınar Köyü)', 'ÇINARLIK Mahallesi']]] },
    { name: 'Üsküdar', groups: [['34660', ['Fener', 'Selamiali']], ['34720', ['Ortaköy Beldesi']]] },
  ],
};

export const sampleIndex: NeighbourhoodIndex = {
  v: 1,
  source: 'test fixture',
  count: 7,
  codes: { '34660': ['34/Üsküdar'], '34710': ['34/Kadıköy'], '34720': ['34/Kadıköy', '34/Üsküdar'] },
};

export function sampleSource(shards: Record<string, NeighbourhoodShard> = { '34': sampleShard }): NeighbourhoodSource & { loads: string[] } {
  const loads: string[] = [];
  return {
    index: sampleIndex,
    loads,
    async load(plate) {
      loads.push(plate);
      return shards[plate] ?? null;
    },
  };
}
