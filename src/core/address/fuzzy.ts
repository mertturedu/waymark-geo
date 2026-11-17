import type { Region } from './pack';
import { editDistance } from './names';

type Entry = { ref: number; key: string; compact: string };

const MAX_DISTANCE = 2;
const MIN_LENGTH = 4;
const cache = new WeakMap<Region, Map<number, Entry[]>>();
const everything = new WeakMap<Region, Promise<Map<number, Entry[]>>>();

const entryOf = (hit: { ref: number; key: string }): Entry => ({ ref: hit.ref, key: hit.key, compact: hit.key.replace(/ /g, '') });

async function allByLength(region: Region): Promise<Map<number, Entry[]>> {
  const known = everything.get(region);
  if (known) return known;
  const built = (async () => {
    const byLength = new Map<number, Entry[]>();
    for (const hit of await region.allNames('street')) {
      const entry = entryOf(hit);
      const list = byLength.get(entry.compact.length);
      if (list) list.push(entry);
      else byLength.set(entry.compact.length, [entry]);
    }
    return byLength;
  })();
  everything.set(region, built);
  return built;
}

async function lengthsOf(region: Region, wanted: number[]): Promise<Map<number, Entry[]>> {
  if (!region.namesByLength) return allByLength(region);
  let loaded = cache.get(region);
  if (!loaded) {
    loaded = new Map();
    cache.set(region, loaded);
  }
  const missing = wanted.filter((length) => !loaded.has(length));
  if (missing.length > 0) {
    for (const length of missing) loaded.set(length, []);
    for (const hit of await region.namesByLength('street', missing)) loaded.get(hit.key.replace(/ /g, '').length)?.push(entryOf(hit));
  }
  return loaded;
}

export async function fuzzyStreetNames(region: Region, compact: string): Promise<{ ref: number; key: string }[]> {
  if (compact.length < MIN_LENGTH) return [];
  const lengths: number[] = [];
  for (let length = compact.length - MAX_DISTANCE; length <= compact.length + MAX_DISTANCE; length++) lengths.push(length);
  const byLength = await lengthsOf(region, lengths);
  const first = compact.charAt(0);
  const last = compact.charAt(compact.length - 1);
  const found: { ref: number; key: string }[] = [];
  for (const length of lengths) {
    for (const entry of byLength.get(length) ?? []) {
      if (entry.compact.charAt(0) !== first && entry.compact.charAt(entry.compact.length - 1) !== last) continue;
      if (editDistance(compact, entry.compact, MAX_DISTANCE) <= MAX_DISTANCE) found.push({ ref: entry.ref, key: entry.key });
    }
  }
  return found;
}
