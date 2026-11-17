import { nameKey } from '../text/fold';
import { houseNumberKey } from '../text/number';
import type { ParsedAddress } from '../text/types';
import { poiScored } from './places';
import { components, districtOf, emitStreet, matchDistricts, matchHoods, scored, type RegionContext, type Scored } from './resolve';

export const AUTOCOMPLETE_TEXT = 200;
const MIN_FRAGMENT = 2;
const NAMES_READ = 120;
const STREETS_KEPT = 8;
const NEARBY_FACTOR = 0.55;

export function prefixScore(fragment: string, key: string): number {
  if (key === fragment) return 1;
  return 0.6 + 0.35 * Math.min(1, fragment.length / key.length);
}

function fragmentOf(parsed: ParsedAddress): string {
  return nameKey(parsed.street?.key ?? parsed.neighbourhood ?? parsed.leftover.join(' '));
}

export async function autocompleteInRegion(ctx: RegionContext, parsed: ParsedAddress): Promise<Scored[]> {
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
    const hoods = parsed.street && parsed.neighbourhood ? matchHoods(ctx, parsed.neighbourhood, districts) : null;
    for (const [ref, value] of refs) {
      const street = rows.get(ref);
      if (street) await emitStreet(ctx, street, value, places.filter((p) => p.nameId === ref), hn, districts, hoods, out);
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

  const poiScores = new Map<number, number>();
  for (const hit of await ctx.region.prefixNames('poi', fragment, NAMES_READ)) {
    const value = prefixScore(fragment, hit.key);
    if (value > (poiScores.get(hit.ref) ?? 0)) poiScores.set(hit.ref, value);
  }
  const poiIds = [...poiScores.keys()].sort((a, b) => a - b).slice(0, NAMES_READ);
  for (const poi of await ctx.region.poisByIds(poiIds)) out.push(poiScored(ctx, poi, 0.9 * (poiScores.get(poi.id) as number) * factorOf(poi.districtId)));
  return out;
}
