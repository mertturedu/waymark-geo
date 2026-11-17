import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { wayPoint } from '../learned/way';
import type { ParsedAddress } from '../text/types';
import { nameKey } from '../text/fold';
import { streetKey } from '../text/street';
import { formatLabel } from './label';
import { matchDistricts, type RegionContext, type Scored } from './resolve';
import type { Components } from './types';
import type { StreetHint } from '../learned/types';

export const LEARNED_STREET_SCORE = 0.95;
export const LEARNED_STREET_CONFIDENCE = 0.6;
const FOUND: readonly string[] = ['address', 'interpolated', 'street'];
const HOOD_REACH_M = 3000;
const DOOR_RADIUS_M = 250;
const PROVINCE_CANDIDATES = 5;

function hoodAnchor(own: readonly Scored[], hood: string | null): LngLat | null {
  if (!hood) return null;
  const wanted = nameKey(hood);
  const found = own.find((s) => {
    const name = nameKey(s.place.components.neighbourhood ?? '');
    return s.place.precision === 'neighbourhood' && name !== '' && (name.includes(wanted) || wanted.includes(name));
  });
  return found ? found.place.coordinate : null;
}

function districtNames(ctx: RegionContext | undefined, parsed: ParsedAddress): { key: string; name: string }[] {
  const typed = parsed.district ? { key: nameKey(parsed.district.name), name: parsed.district.name } : null;
  const ids = ctx?.region?.districts && ctx.official ? matchDistricts(ctx, parsed) : null;
  const found = ids ? ctx!.region.districts.filter((d) => ids.has(d.id)).map((d) => ({ key: d.key, name: d.name })) : [];
  return typed && !found.some((d) => d.key === typed.key) ? [...found, typed] : found.length > 0 ? found : typed ? [typed] : [];
}

export function needsLearnedStreet(own: readonly Scored[], parsed: ParsedAddress, ctx?: RegionContext): boolean {
  if (!parsed.street || !parsed.district) return false;
  const districts = new Set(districtNames(ctx, parsed).map((d) => d.key));
  const wanted = parsed.street.key;
  return !own.some((s) => FOUND.includes(s.place.precision) && districts.has(nameKey(s.place.components.district ?? '')) && streetKey(s.place.components.street ?? '').key === wanted);
}

function placeOf(ctx: RegionContext, hint: StreetHint, districtName: string, parsed: ParsedAddress, known: { key: string }, score: number): Scored {
  const components: Components = { province: ctx.provinceName, district: districtName, street: hint.name, ...(parsed.houseNumber ? { houseNumber: parsed.houseNumber } : {}) };
  const number = parsed.houseNumber ? Number.parseInt(parsed.houseNumber, 10) : Number.NaN;
  const door = hint.way && Number.isFinite(number) ? wayPoint(hint.way, number) : null;
  return {
    score,
    area: 'learned-street',
    place: { id: `${ctx.region.id}:l:${hint.district}:${known.key}`, label: formatLabel(components, ctx.language), components, coordinate: door ?? hint.point, precision: door ? 'interpolated' : 'street', approximate: true, source: 'learned', confidence: LEARNED_STREET_CONFIDENCE, region: ctx.region.id, radiusM: door ? Math.min(hint.radiusM, DOOR_RADIUS_M) : hint.radiusM },
  };
}

const keys = new WeakMap<StreetHint, ReturnType<typeof streetKey>>();
function keyOf(hint: StreetHint): ReturnType<typeof streetKey> {
  let key = keys.get(hint);
  if (!key) {
    key = streetKey(hint.name);
    keys.set(hint, key);
  }
  return key;
}

const sameKind = (known: { kind: string | null }, wanted: { kind: string | null }): boolean => known.kind === null || wanted.kind === null || known.kind === wanted.kind;

export async function learnedStreet(ctx: RegionContext, parsed: ParsedAddress, own: readonly Scored[] = []): Promise<Scored | null> {
  if (!parsed.street || !parsed.district) return null;
  const anchor = hoodAnchor(own, parsed.neighbourhood);
  const wanted = parsed.street;
  for (const { key: district, name } of districtNames(ctx, parsed)) for (const layer of ctx.layers) {
    for (const hint of (await layer.hints?.(ctx.region.id, district)) ?? []) {
      const known = keyOf(hint);
      if (known.key !== wanted.key || !sameKind(known, wanted)) continue;
      if (anchor && distanceM(anchor, hint.point) > hint.radiusM + HOOD_REACH_M) continue;
      return placeOf(ctx, hint, name, parsed, known, LEARNED_STREET_SCORE);
    }
  }
  return null;
}

export function needsProvinceStreet(own: readonly Scored[], parsed: ParsedAddress): boolean {
  if (!parsed.street || parsed.district) return false;
  const wanted = parsed.street.key;
  return !own.some((s) => FOUND.includes(s.place.precision) && streetKey(s.place.components.street ?? '').key === wanted);
}

export async function learnedStreetsInProvince(ctx: RegionContext, parsed: ParsedAddress): Promise<Scored[]> {
  if (!parsed.street || parsed.district) return [];
  const wanted = parsed.street;
  const found: { hint: StreetHint; name: string; known: { key: string } }[] = [];
  for (const d of ctx.region.districts ?? []) for (const layer of ctx.layers) {
    for (const hint of (await layer.hints?.(ctx.region.id, d.key)) ?? []) {
      const known = keyOf(hint);
      if (known.key === wanted.key && sameKind(known, wanted)) found.push({ hint, name: d.name, known });
    }
  }
  found.sort((a, b) => b.hint.sources - a.hint.sources);
  return found.slice(0, PROVINCE_CANDIDATES).map((f) => placeOf(ctx, f.hint, f.name, parsed, f.known, found.length === 1 ? LEARNED_STREET_SCORE : LEARNED_STREET_SCORE - 0.05));
}
