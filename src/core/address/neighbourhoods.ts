import { findDistrict, provinceByPlate } from '../text/admin';
import { nameKey } from '../text/fold';
import type { ParsedAddress } from '../text/types';
import { editDistance } from './names';

export const NEIGHBOURHOOD_PACK_VERSION = 1;
export const NEIGHBOURHOOD_CACHE = 6;
const SUGGEST_MIN = 4;
const SUGGEST_SHORT = 7;
const SUGGEST_LIMIT = 5;
const SUFFIX = new Set(['mahallesi', 'mahalle', 'mah', 'mh', 'koyu', 'koy', 'beldesi']);

export type NeighbourhoodIndex = { v: 1; source: string; count: number; codes: Record<string, string[]> };
export type NeighbourhoodShard = { v: 1; plate: string; districts: { name: string; groups: [string, string[]][] }[] };
export type NeighbourhoodSource = { index: NeighbourhoodIndex; load(plate: string): Promise<NeighbourhoodShard | null> };
export type Neighbourhood = { name: string; postcode: string; key: string; compact: string; village: string | null };
export type PostcodeCheck = { typed: string; expected: string[] };

export type Neighbourhoods = {
  areasOf(postcode: string): { plate: string; district: string }[];
  list(plate: string, district?: string): Promise<Neighbourhood[]>;
  find(plate: string, district: string | undefined, text: string): Promise<Neighbourhood[]>;
  suggest(plate: string, district: string | undefined, text: string, limit?: number): Promise<string[]>;
  postcodeOf(plate: string, district: string | undefined, text: string): Promise<string | null>;
  fillArea(parsed: ParsedAddress): ParsedAddress;
  checkPostcode(parsed: ParsedAddress, plate: string, district?: string): Promise<PostcodeCheck | null>;
  clear(): void;
};

export function hoodKey(text: string): string {
  const base = text.replace(/\([^)]*\)/g, ' ');
  const words = nameKey(base).split(' ').filter((w) => w !== '');
  while (words.length > 1 && SUFFIX.has(words[words.length - 1] as string)) words.pop();
  return words.join(' ');
}

export function splitHoodName(raw: string): { name: string; village: string | null } {
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 0 || close < open) return { name: raw.trim(), village: null };
  const village = raw.slice(open + 1, close).trim();
  return { name: raw.slice(0, open).trim(), village: village === '' ? null : village };
}

type Area = { name: string; hoods: Neighbourhood[]; byKey: Map<string, Neighbourhood[]> };

const push = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const loose = (key: string): string => key.split(' ').join('');

function buildAreas(shard: NeighbourhoodShard): Map<string, Area> {
  const areas = new Map<string, Area>();
  for (const district of shard.districts) {
    const hoods: Neighbourhood[] = [];
    const byKey = new Map<string, Neighbourhood[]>();
    for (const [postcode, names] of district.groups) {
      for (const raw of names) {
        const { name, village } = splitHoodName(raw);
        const key = hoodKey(name);
        if (key === '') continue;
        const hood: Neighbourhood = { name, postcode, key, compact: loose(key), village };
        hoods.push(hood);
        push(byKey, key, hood);
        if (hood.compact !== key) push(byKey, hood.compact, hood);
      }
    }
    areas.set(nameKey(district.name), { name: district.name, hoods, byKey });
  }
  return areas;
}

export function createNeighbourhoods(source: NeighbourhoodSource): Neighbourhoods {
  const cache = new Map<string, Map<string, Area>>();
  const pending = new Map<string, Promise<Map<string, Area> | null>>();

  const shardOf = async (plate: string): Promise<Map<string, Area> | null> => {
    const hit = cache.get(plate);
    if (hit) {
      cache.delete(plate);
      cache.set(plate, hit);
      return hit;
    }
    let loading = pending.get(plate);
    if (!loading) {
      loading = source.load(plate).then((shard) => (shard && shard.v === NEIGHBOURHOOD_PACK_VERSION ? buildAreas(shard) : null)).catch(() => null);
      pending.set(plate, loading);
    }
    const areas = await loading;
    pending.delete(plate);
    if (areas) {
      cache.set(plate, areas);
      while (cache.size > NEIGHBOURHOOD_CACHE) cache.delete(cache.keys().next().value as string);
    }
    return areas;
  };

  const scoped = async (plate: string, district: string | undefined): Promise<Area[]> => {
    const areas = await shardOf(plate);
    if (!areas) return [];
    if (district === undefined || district === '') return [...areas.values()];
    const area = areas.get(nameKey(district));
    return area ? [area] : [];
  };

  const find = async (plate: string, district: string | undefined, text: string): Promise<Neighbourhood[]> => {
    const key = hoodKey(text);
    if (key === '') return [];
    const found: Neighbourhood[] = [];
    for (const area of await scoped(plate, district)) found.push(...(area.byKey.get(key) ?? area.byKey.get(loose(key)) ?? []));
    return found;
  };

  const suggest = async (plate: string, district: string | undefined, text: string, limit = SUGGEST_LIMIT): Promise<string[]> => {
    const key = hoodKey(text);
    const compact = loose(key);
    if (compact.length < SUGGEST_MIN) return [];
    const allowed = compact.length <= SUGGEST_SHORT ? 1 : 2;
    const ranked: { name: string; distance: number }[] = [];
    for (const area of await scoped(plate, district)) {
      if (area.byKey.has(key) || area.byKey.has(compact)) return [];
      for (const hood of area.hoods) {
        const distance = editDistance(compact, hood.compact, allowed);
        if (distance > 0 && distance <= allowed) ranked.push({ name: hood.name, distance });
      }
    }
    ranked.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'tr'));
    return [...new Set(ranked.map((r) => r.name))].slice(0, Math.max(1, limit));
  };

  const areasOf = (postcode: string): { plate: string; district: string }[] =>
    (source.index.codes[postcode] ?? []).flatMap((entry) => {
      const at = entry.indexOf('/');
      return at > 0 ? [{ plate: entry.slice(0, at), district: entry.slice(at + 1) }] : [];
    });

  return {
    areasOf,
    list: async (plate, district) => (await scoped(plate, district)).flatMap((area) => area.hoods),
    find,
    suggest,
    async postcodeOf(plate, district, text) {
      const codes = new Set((await find(plate, district, text)).map((hood) => hood.postcode));
      return codes.size === 1 ? ([...codes][0] as string) : null;
    },
    fillArea(parsed) {
      if (parsed.postcode === null || (parsed.province !== null && parsed.district !== null)) return parsed;
      const areas = areasOf(parsed.postcode);
      const plates = new Set(areas.map((a) => a.plate));
      if (plates.size !== 1) return parsed;
      const plate = [...plates][0] as string;
      const province = parsed.province ?? provinceByPlate(plate);
      if (province === null || province.id !== plate) return parsed;
      const districts = parsed.district === null && areas.length === 1 ? findDistrict((areas[0] as { district: string }).district, plate) : [];
      const district = parsed.district ?? (districts.length === 1 ? (districts[0] as NonNullable<ParsedAddress['district']>) : null);
      return { ...parsed, province, district };
    },
    async checkPostcode(parsed, plate, district) {
      if (parsed.postcode === null || parsed.neighbourhood === null) return null;
      const hoods = await find(plate, district, parsed.neighbourhood);
      if (hoods.length === 0) return null;
      const expected = [...new Set(hoods.map((hood) => hood.postcode))];
      return expected.includes(parsed.postcode) ? null : { typed: parsed.postcode, expected: expected.slice(0, SUGGEST_LIMIT) };
    },
    clear() {
      cache.clear();
      pending.clear();
    },
  };
}
