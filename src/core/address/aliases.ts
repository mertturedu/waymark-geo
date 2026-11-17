import aliases from '../text/data/admin-aliases.json';
import type { Region } from './pack';

const cache = new WeakMap<Region, Map<string, number[]>>();

const hoodData = aliases.hood as Record<string, Record<string, Record<string, string[]>>>;

export function hoodAliases(region: Region): Map<string, number[]> {
  const known = cache.get(region);
  if (known) return known;
  const index = new Map<string, number[]>();
  const plate = hoodData[region.id] ?? {};
  const districtKey = new Map(region.districts.map((d) => [d.id, d.key]));
  for (const hood of region.hoods) {
    const names = plate[districtKey.get(hood.districtId) ?? '']?.[hood.key] ?? [];
    for (const alias of names) {
      const list = index.get(alias);
      if (list) list.push(hood.id);
      else index.set(alias, [hood.id]);
    }
  }
  cache.set(region, index);
  return index;
}

let byAlias: Map<string, string[]> | null = null;

export function formerHoodPlates(key: string): string[] {
  if (!byAlias) {
    byAlias = new Map();
    for (const [plate, districts] of Object.entries(hoodData)) {
      for (const hoods of Object.values(districts)) {
        for (const list of Object.values(hoods)) {
          for (const alias of list) {
            const plates = byAlias.get(alias);
            if (!plates) byAlias.set(alias, [plate]);
            else if (!plates.includes(plate)) plates.push(plate);
          }
        }
      }
    }
  }
  return byAlias.get(key) ?? byAlias.get(key.replace(/ /g, '')) ?? [];
}
