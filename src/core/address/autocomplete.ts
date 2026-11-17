import { nameKey } from '../text/fold';
import { houseNumberKey } from '../text/number';
import type { ParsedAddress } from '../text/types';
import { buildingPlace, BUILDING_NAME_SCORE, isTwin } from './building-names';
import { poiScored } from './places';
import { components, districtOf, emitStreet, matchDistricts, matchHoods, scored, type RegionContext, type Scored, type StreetPlace } from './resolve';
import { knownNumbers } from './typeahead';

export const AUTOCOMPLETE_TEXT = 200;
const MIN_FRAGMENT = 2;
const NAMES_READ = 120;
const BUILDING_NAME_FRAGMENT = 3;
const BUILDING_NAMES_READ = 40;
const STREETS_KEPT = 8;
const NEARBY_FACTOR = 0.55;
const HOOD_STREETS = 12;
const HOOD_STREET_BASE = 0.88;
const HOOD_STREET_STEP = 0.005;
const EXACT_HOOD = 0.98;
const NUMBER_STREETS = 2;
const NUMBER_LOCS = 3;
const NUMBER_KEPT = 6;
const NUMBER_NAME_MIN = 0.95;
const KNOWN_PREFIX_FACTOR = 0.97;
const HOOD_MISSING = 0.8;

export type AutocompleteStage = { deep: boolean; deadline: number | null };

export function prefixScore(fragment: string, key: string): number {
  if (key === fragment) return 1;
  return 0.6 + 0.35 * Math.min(1, fragment.length / key.length);
}

function fragmentOf(parsed: ParsedAddress): string {
  if (parsed.street) return nameKey(parsed.street.key);
  if (parsed.neighbourhood && parsed.leftover.length > 0) return nameKey(parsed.leftover.join(' '));
  return nameKey(parsed.neighbourhood ?? parsed.leftover.join(' '));
}

async function completeNumbers(ctx: RegionContext, street: { id: number; name: string; key: string; kind: string | null; number: number | null }, value: number, locs: StreetPlace[], digits: string, districts: Set<number> | null, hoods: Map<number, number> | null, out: Scored[]): Promise<void> {
  const ranked = locs.map((loc) => ({ loc, factor: (!districts || districts.has(loc.districtId) ? 1 : NEARBY_FACTOR) * (!hoods || (loc.hoodId !== null && hoods.has(loc.hoodId)) ? 1 : HOOD_MISSING) })).sort((a, b) => b.factor - a.factor).slice(0, NUMBER_LOCS);
  for (const { loc, factor } of ranked) {
    const rows = await ctx.region.neighbours(street.id, null, loc.districtId);
    for (const row of knownNumbers(rows, digits, loc.districtId, loc.hoodId, NUMBER_KEPT)) {
      out.push(scored(ctx, { id: `${ctx.region.id}:a:${row.id}`, components: components(ctx, loc.districtId, loc.hoodId, street, row.number, row.postcode), coordinate: [row.lng, row.lat], precision: 'address', approximate: false, source: 'osm', score: value * KNOWN_PREFIX_FACTOR * factor, area: `${loc.districtId}/${loc.hoodId ?? 0}` }));
    }
  }
}

export async function autocompleteInRegion(ctx: RegionContext, parsed: ParsedAddress, stage: AutocompleteStage = { deep: true, deadline: null }): Promise<Scored[]> {
  const out: Scored[] = [];
  const fragment = fragmentOf(parsed);
  if (fragment.length < MIN_FRAGMENT) return out;
  const hn = parsed.houseNumber ? houseNumberKey(parsed.houseNumber) : null;
  const districts = matchDistricts(ctx, parsed);
  const factorOf = (districtId: number): number => (!districts || districts.has(districtId) ? 1 : NEARBY_FACTOR);

  const streets = new Map<number, number>();
  for (const hit of await ctx.region.prefixNames('street', fragment, NAMES_READ)) {
    const value = prefixScore(fragment, hit.key);
    if (value > (streets.get(hit.ref) ?? 0)) streets.set(hit.ref, value);
  }
  const refs = [...streets].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, STREETS_KEPT);
  if (refs.length > 0) {
    const ids = refs.map((r) => r[0]);
    const rows = new Map((await ctx.region.streetsByIds(ids)).map((r) => [r.id, r]));
    const places = await ctx.region.hoodsOfStreet(ids);
    const hoods = parsed.neighbourhood && fragment !== nameKey(parsed.neighbourhood) ? matchHoods(ctx, parsed.neighbourhood, districts) : null;
    const digits = hn !== null && /^[0-9]+$/.test(hn.key) ? hn.key : null;
    for (const [index, [ref, value]] of refs.entries()) {
      const street = rows.get(ref);
      if (!street) continue;
      const locs = places.filter((p) => p.nameId === ref);
      await emitStreet(ctx, street, value, locs, hn, districts, hoods, out);
      if (digits !== null && index < NUMBER_STREETS && value >= NUMBER_NAME_MIN) await completeNumbers(ctx, street, value, locs, digits, districts, hoods, out);
    }
  }
  if (!parsed.street && parsed.neighbourhood && parsed.leftover.length === 0 && ctx.region.streetsOfHood) {
    const exact = [...matchHoods(ctx, parsed.neighbourhood, districts)].filter(([, score]) => score >= EXACT_HOOD).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const hood = exact ? ctx.region.hoods.find((h) => h.id === exact[0]) : undefined;
    if (hood) {
      const listed = await ctx.region.streetsOfHood(hood.id, HOOD_STREETS);
      const rows = new Map((await ctx.region.streetsByIds(listed.map((l) => l.streetId))).map((r) => [r.id, r]));
      for (const [index, l] of listed.entries()) {
        const street = rows.get(l.streetId);
        if (street) await emitStreet(ctx, street, HOOD_STREET_BASE - HOOD_STREET_STEP * index, [{ districtId: hood.districtId, hoodId: hood.id }], null, districts, null, out);
      }
    }
  }
  if (parsed.street || hn) return out;

  for (const hood of ctx.region.hoods) {
    if (districts && districts.size > 0 && !districts.has(hood.districtId)) continue;
    if (!hood.key.startsWith(fragment) && !hood.key.replace(/ /g, '').startsWith(fragment.replace(/ /g, ''))) continue;
    out.push(scored(ctx, { id: `${ctx.region.id}:h:${hood.id}`, components: components(ctx, hood.districtId, hood.id), coordinate: hood.center ?? districtOf(ctx, hood.districtId).center, precision: 'neighbourhood', approximate: true, source: 'derived', score: 0.9 * prefixScore(fragment, hood.key), area: `${hood.districtId}/${hood.id}` }));
  }
  if (!parsed.district) {
    for (const d of ctx.region.districts) {
      if (d.key.startsWith(fragment)) out.push(scored(ctx, { id: `${ctx.region.id}:d:${d.id}`, components: components(ctx, d.id, null), coordinate: d.center, precision: 'district', approximate: true, source: 'derived', score: 0.95 * prefixScore(fragment, d.key), area: `${d.id}/0` }));
    }
  }

  if (!stage.deep || (stage.deadline !== null && Date.now() > stage.deadline)) return out;
  const poiScores = new Map<number, number>();
  for (const hit of await ctx.region.prefixNames('poi', fragment, NAMES_READ)) {
    const value = prefixScore(fragment, hit.key);
    if (value > (poiScores.get(hit.ref) ?? 0)) poiScores.set(hit.ref, value);
  }
  const poiIds = [...poiScores.keys()].sort((a, b) => a - b).slice(0, NAMES_READ);
  for (const poi of await ctx.region.poisByIds(poiIds)) out.push(poiScored(ctx, poi, 0.9 * (poiScores.get(poi.id) as number) * factorOf(poi.districtId)));
  if (ctx.buildings2 && fragment.length >= BUILDING_NAME_FRAGMENT) {
    const polygons = await ctx.region.districtPolygons();
    for (const { key, building } of await ctx.buildings2.named(fragment, BUILDING_NAMES_READ)) {
      if (isTwin(out, key, building)) continue;
      const place = await buildingPlace(ctx, polygons, building, key, BUILDING_NAME_SCORE * prefixScore(fragment, key), districts);
      if (place) out.push(place);
    }
  }
  return out;
}
