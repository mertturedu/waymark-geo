import { nameKey } from '../text/fold';
import type { ParsedAddress } from '../text/types';
import { cachedStreetKey } from './key-cache';
import { nameScore } from './names';
import type { PoiRow } from './pack';
import type { Components, PlaceDetails } from './types';
import { components, hoodOf, matchDistricts, scored, type RegionContext, type Scored } from './resolve';
import { synonymVariants } from './synonyms';

const MIN_PLACE = 0.7;
const PLACES_READ = 200;
const PLACES_KEPT = 8;
const CANDIDATES = 80;
const PLACE_CAP = 0.9;
const DISTRICT_MISMATCH = 0.55;

const UNSURE = 0.5;
const UNSURE_FACTOR = 0.9;

export function poiScored(ctx: RegionContext, poi: PoiRow, score: number): Scored {
  const info = poi.info;
  const base = components(ctx, poi.districtId, poi.hoodId, undefined, info?.number ?? undefined, info?.postcode);
  const door: Components = { ...base, ...(info?.street ? { street: info.street } : {}), poiName: poi.name };
  const details: PlaceDetails = { ...(info?.category ? { category: info.category } : {}), ...(info?.brand ? { brand: info.brand } : {}) };
  const made = scored(ctx, {
    id: `${ctx.region.id}:o:${poi.id}`,
    components: door,
    coordinate: [poi.lng, poi.lat],
    precision: 'poi',
    approximate: false,
    source: 'osm',
    score: info && info.confidence < UNSURE ? score * UNSURE_FACTOR : score,
    area: `${poi.districtId}/${hoodOf(ctx, poi.hoodId)?.id ?? 0}`,
  });
  return Object.keys(details).length > 0 ? { ...made, place: { ...made.place, details } } : made;
}

function dedupe(key: string): string {
  return [...new Set(key.split(' '))].join(' ');
}

function stripWords(key: string, words: string[][]): string {
  const tokens = key.split(' ');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = words.find((w) => w.length > 0 && w.every((t, j) => tokens[i + j] === t));
    if (hit) i += hit.length;
    else kept.push(tokens[i++] as string);
  }
  return kept.join(' ');
}

export async function placesInRegion(ctx: RegionContext, parsed: ParsedAddress): Promise<Scored[]> {
  const full = nameKey(parsed.input);
  if (full === '') return [];
  const areaWords = [...ctx.region.districts.map((d) => d.key), nameKey(ctx.provinceName)].map((k) => k.split(' '));
  const province = [nameKey(ctx.provinceName).split(' ')];
  const forms = [dedupe(full), dedupe(stripWords(full, province)), dedupe(stripWords(full, areaWords))];
  const queries = [...new Set(forms.filter((q) => q !== ''))].flatMap((q) => synonymVariants(q));
  const asked = [...new Set(queries)].map((q) => cachedStreetKey(q));

  const best = new Map<number, number>();
  for (const query of asked) {
    for (const c of await ctx.region.streetCandidates(query.key, 'poi', CANDIDATES)) {
      const value = Math.max(nameScore(query, cachedStreetKey(c.key)).score, nameScore(query, cachedStreetKey(stripWords(c.key, areaWords))).score);
      if (value > (best.get(c.ref) ?? 0)) best.set(c.ref, value);
    }
  }
  const refs = [...best].filter((r) => r[1] >= MIN_PLACE).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, PLACES_READ);
  if (refs.length === 0) return [];
  let districts = matchDistricts(ctx, parsed);
  if (districts && districts.size === 0) districts = matchDistricts(ctx, { ...parsed, district: null });
  const rows = await ctx.region.poisByIds(refs.map((r) => r[0]));
  const out: Scored[] = [];
  for (const poi of rows) {
    const factor = !districts || districts.has(poi.districtId) ? 1 : DISTRICT_MISMATCH;
    out.push(poiScored(ctx, poi, PLACE_CAP * (best.get(poi.id) as number) * factor));
  }
  return out.sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1)).slice(0, PLACES_KEPT);
}
