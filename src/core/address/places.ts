import type { LngLat } from '../geo/cells';
import { nameKey } from '../text/fold';
import type { ParsedAddress } from '../text/types';
import { categoryOf } from './categories';
import { cachedStreetKey } from './key-cache';
import { nameScore } from './names';
import { boxAround } from './nearby';
import type { PoiRow } from './pack';
import type { Components, PlaceDetails } from './types';
import { components, hoodOf, matchDistricts, matchHoods, scored, type RegionContext, type Scored } from './resolve';
import { synonymVariants } from './synonyms';

const MIN_PLACE = 0.7;
const PLACES_READ = 200;
const PLACES_KEPT = 8;
const CANDIDATES = 80;
const PLACE_CAP = 0.9;
const DISTRICT_MISMATCH = 0.55;
const HOOD_MISMATCH = 0.8;
const HOOD_WORDS = [['mah'], ['mahallesi'], ['mahalle'], ['mh']];
const EXACT_NAME = 0.95;
const SYNONYMS_SKIP = 0.92;

const PREFIX_MIN = 0.9;
const PREFIX_CUTS = 3;
const PREFIX_CANDIDATES = 800;
const PREFIX_MIN_WORDS = 3;
const STREET_CONFIRMED = 0.97;
const STREET_MATCH = 0.85;

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

export function dedupe(key: string): string {
  return [...new Set(key.split(' '))].join(' ');
}

export function stripWords(key: string, words: string[][]): string {
  const tokens = key.split(' ');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = words.find((w) => w.length > 0 && w.every((t, j) => tokens[i + j] === t));
    if (hit) i += hit.length;
    else kept.push(tokens[i++] as string);
  }
  return kept.join(' ');
}

const BROWSE_SCORE = 0.86;
export const MODEL_KIND_FACTOR = 0.95;
const BROWSE_READ = 60;
const BROWSE_RADIUS_M = 3000;

async function browseCategory(ctx: RegionContext, parsed: ParsedAddress, full: string, near: LngLat | undefined): Promise<Scored[]> {
  const ask = categoryOf(full);
  if (!ask) return [];
  const areaWords = [...ctx.region.districts.map((d) => d.key), nameKey(ctx.provinceName)].map((k) => k.split(' '));
  if (stripWords(ask.rest, areaWords) !== '') return [];
  const districts = matchDistricts(ctx, parsed);
  let rows: PoiRow[] = [];
  if (districts && districts.size > 0) rows = await ctx.region.poisInDistricts(ask.kinds, [...districts], BROWSE_READ);
  else if (near && Number.isFinite(near[0]) && Number.isFinite(near[1])) rows = await ctx.region.poisInBox(ask.kinds, boxAround(near, BROWSE_RADIUS_M), BROWSE_READ);
  return rows.map((poi) => poiScored(ctx, poi, BROWSE_SCORE * (0.9 + 0.1 * (poi.info?.confidence ?? 0.5)) * (poi.info?.model ? MODEL_KIND_FACTOR : 1)));
}

export async function placesInRegion(ctx: RegionContext, parsed: ParsedAddress, near?: LngLat): Promise<Scored[]> {
  const full = nameKey(parsed.input);
  if (full === '') return [];
  const browsed = await browseCategory(ctx, parsed, full, near);
  if (browsed.length === 0) return placesByName(ctx, parsed, full, true);
  const byName = await placesByName(ctx, parsed, full, false);
  const seen = new Set(byName.map((s) => s.place.id));
  return [...byName, ...browsed.filter((s) => !seen.has(s.place.id))].sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1)).slice(0, PLACES_KEPT);
}

async function placesByName(ctx: RegionContext, parsed: ParsedAddress, full: string, synonyms: boolean): Promise<Scored[]> {
  const areaWords = [...ctx.region.districts.map((d) => d.key), nameKey(ctx.provinceName)].map((k) => k.split(' '));
  const province = [nameKey(ctx.provinceName).split(' ')];
  const hoodWords = parsed.neighbourhood ? [nameKey(parsed.neighbourhood).split(' '), ...HOOD_WORDS] : [];
  const forms = [dedupe(full), dedupe(stripWords(full, province)), dedupe(stripWords(full, areaWords)), ...(hoodWords.length > 0 ? [dedupe(stripWords(stripWords(full, areaWords), hoodWords))] : [])];
  const plain = [...new Set(forms.filter((q) => q !== ''))];
  const best = new Map<number, number>();
  const collect = async (queries: string[]): Promise<void> => {
    for (const query of [...new Set(queries)].map((q) => cachedStreetKey(q))) {
      for (const c of await ctx.region.streetCandidates(query.key, 'poi', CANDIDATES)) {
        const value = Math.max(nameScore(query, cachedStreetKey(c.key)).score, nameScore(query, cachedStreetKey(stripWords(c.key, areaWords))).score);
        if (value > (best.get(c.ref) ?? 0)) best.set(c.ref, value);
      }
    }
  };
  await collect(plain);
  if (synonyms && ![...best.values()].some((v) => v >= SYNONYMS_SKIP)) await collect(plain.flatMap((q) => synonymVariants(q)));
  const refs = [...best].filter((r) => r[1] >= MIN_PLACE).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, PLACES_READ);
  const withStreet = parsed.street === null ? [] : await placesOnStreet(ctx, parsed, dedupe(stripWords(full, areaWords)));
  if (refs.length === 0) return withStreet;
  let districts = matchDistricts(ctx, parsed);
  if (districts && districts.size === 0) districts = matchDistricts(ctx, { ...parsed, district: null });
  const rows = await ctx.region.poisByIds(refs.map((r) => r[0]));
  const out: Scored[] = [];
  const whole = cachedStreetKey(dedupe(full));
  const hoods = parsed.neighbourhood ? matchHoods(ctx, parsed.neighbourhood, districts) : null;
  for (const poi of rows) {
    const spelled = nameScore(whole, cachedStreetKey(nameKey(poi.name))).score >= EXACT_NAME;
    const hoodFactor = hoods && hoods.size > 0 && poi.hoodId !== null && !hoods.has(poi.hoodId) ? HOOD_MISMATCH : 1;
    const factor = (!districts || districts.has(poi.districtId) || spelled ? 1 : DISTRICT_MISMATCH) * hoodFactor;
    out.push(poiScored(ctx, poi, PLACE_CAP * (best.get(poi.id) as number) * factor));
  }
  const seen = new Set(out.map((s) => s.place.id));
  out.push(...withStreet.filter((s) => !seen.has(s.place.id)));
  return out.sort((a, b) => b.score - a.score || (a.place.id < b.place.id ? -1 : 1)).slice(0, PLACES_KEPT);
}

export async function placesOnWrittenStreet(ctx: RegionContext, parsed: ParsedAddress): Promise<Scored[]> {
  const full = nameKey(parsed.input);
  const areaWords = [...ctx.region.districts.map((d) => d.key), nameKey(ctx.provinceName)].map((k) => k.split(' '));
  return full === '' ? [] : placesOnStreet(ctx, parsed, dedupe(stripWords(full, areaWords)));
}

async function placesOnStreet(ctx: RegionContext, parsed: ParsedAddress, stripped: string): Promise<Scored[]> {
  const tokens = stripped.split(' ').filter((t) => t !== '');
  if (tokens.length < PREFIX_MIN_WORDS) return [];
  const found = new Map<number, { value: number; rest: string }>();
  for (let cut = 1; cut <= Math.min(PREFIX_CUTS, tokens.length - 1); cut++) {
    const query = cachedStreetKey(tokens.slice(0, tokens.length - cut).join(' '));
    const rest = tokens.slice(tokens.length - cut).join(' ');
    for (const c of await ctx.region.streetCandidates(query.key, 'poi', PREFIX_CANDIDATES)) {
      const value = nameScore(query, cachedStreetKey(c.key)).score;
      if (value >= PREFIX_MIN && value > (found.get(c.ref)?.value ?? 0)) found.set(c.ref, { value, rest });
    }
  }
  if (found.size === 0) return [];
  let districts = matchDistricts(ctx, parsed);
  if (districts && districts.size === 0) districts = matchDistricts(ctx, { ...parsed, district: null });
  const out: Scored[] = [];
  for (const poi of await ctx.region.poisByIds([...found.keys()].slice(0, PREFIX_CANDIDATES))) {
    const street = poi.info?.street;
    const hit = found.get(poi.id);
    if (!street || !hit || (districts && !districts.has(poi.districtId))) continue;
    if (nameScore(cachedStreetKey(hit.rest), cachedStreetKey(nameKey(street))).score < STREET_MATCH) continue;
    out.push(poiScored(ctx, poi, PLACE_CAP * hit.value * STREET_CONFIRMED));
  }
  return out;
}
