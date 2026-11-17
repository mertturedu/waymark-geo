import { distanceM } from '../geo/distance';
import type { Polygon } from '../region/geom';
import type { BuildingInfo } from './buildings2';
import { nameKey } from '../text/fold';
import type { ParsedAddress } from '../text/types';
import { cachedStreetKey } from './key-cache';
import { nameScore } from './names';
import { dedupe, stripWords } from './places';
import { components, matchDistricts, scored, type RegionContext, type Scored } from './resolve';
import { firstContaining } from './reverse';

export const BUILDING_NAME_SCORE = 0.88;
export const BUILDING_NAME_MIN = 0.85;
export const BUILDING_NAME_KEPT = 5;
const DISTRICT_MISMATCH = 0.55;
const SAME_PLACE_M = 150;
const MIN_QUERY = 3;
const TYPO_PREFIX = 3;
const TYPO_PREFIX_MIN = 5;

function stripTrailing(key: string, words: string[][]): string {
  let tokens = key.split(' ');
  for (let again = true; again; ) {
    again = false;
    for (const w of words) {
      if (w.length > 0 && w.length < tokens.length && w.every((t, i) => tokens[tokens.length - w.length + i] === t)) {
        tokens = tokens.slice(0, tokens.length - w.length);
        again = true;
      }
    }
  }
  return tokens.join(' ');
}

export const isTwin = (known: readonly Scored[], key: string, building: BuildingInfo): boolean =>
  known.some((s) => s.place.precision === 'poi' && nameKey(s.place.components.poiName ?? '') === key && distanceM(s.place.coordinate, building.center) <= SAME_PLACE_M);

export async function buildingPlace(ctx: RegionContext, polygons: Map<number, Polygon[]>, building: BuildingInfo, key: string, score: number, districts: Set<number> | null): Promise<Scored | null> {
  const districtId = firstContaining(polygons, building.center);
  if (districtId === null) return null;
  const hoodId = firstContaining(await ctx.region.hoodPolygons(districtId), building.center);
  const street = building.chain === null ? undefined : (await ctx.region.streetsByIds([building.chain]))[0];
  const factor = !districts || districts.size === 0 || districts.has(districtId) ? 1 : DISTRICT_MISMATCH;
  return scored(ctx, {
    id: `${ctx.region.id}:b:${building.id}`,
    components: { ...components(ctx, districtId, hoodId, street), poiName: building.name ?? key },
    coordinate: building.center,
    precision: 'poi',
    approximate: false,
    source: 'osm',
    score: score * factor,
    area: `${districtId}/${hoodId ?? 0}`,
  });
}

export async function buildingsByName(ctx: RegionContext, parsed: ParsedAddress, known: readonly Scored[] = []): Promise<Scored[]> {
  const reader = ctx.buildings2;
  if (!reader) return [];
  const areaWords = [...ctx.region.districts.map((d) => d.key), nameKey(ctx.provinceName)].map((k) => k.split(' '));
  const full = nameKey(parsed.input);
  const wanted = [...new Set([dedupe(stripWords(full, areaWords)), dedupe(stripTrailing(full, areaWords))])].filter((w) => w.length >= MIN_QUERY);
  if (wanted.length === 0) return [];
  const best = new Map<number, { key: string; building: BuildingInfo; value: number }>();
  for (const text of wanted) {
    const query = cachedStreetKey(text);
    const first = text.split(' ')[0] as string;
    const scan = async (prefix: string): Promise<void> => {
      for (const c of await reader.named(prefix)) {
        const value = nameScore(query, cachedStreetKey(c.key)).score;
        if (value >= BUILDING_NAME_MIN && value > (best.get(c.building.id)?.value ?? 0)) best.set(c.building.id, { ...c, value });
      }
    };
    const before = best.size;
    await scan(first);
    if (best.size === before && first.length >= TYPO_PREFIX_MIN) await scan(first.slice(0, TYPO_PREFIX));
  }
  const found = [...best.values()].sort((a, b) => b.value - a.value || a.building.id - b.building.id).slice(0, BUILDING_NAME_KEPT);
  if (found.length === 0) return [];
  const districts = matchDistricts(ctx, parsed);
  const polygons = await ctx.region.districtPolygons();
  const out: Scored[] = [];
  for (const { key, building, value } of found) {
    if (isTwin(known, key, building)) continue;
    const place = await buildingPlace(ctx, polygons, building, key, BUILDING_NAME_SCORE * value, districts);
    if (place) out.push(place);
  }
  return out;
}
