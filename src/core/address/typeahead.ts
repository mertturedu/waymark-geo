import { nameKey } from '../text/fold';
import type { Lang } from '../text/types';
import type { Buildings2 } from './buildings2';
import type { AddressRow, NameHit, Region } from './pack';
import type { Place, UnitHint } from './types';
import { SITE_RADIUS_M, unitsPerFloor } from './unit';

const MAX_KEY = 64;
const MEMO_LIMIT = 200;
const BLOCKS_READ = 60;

export type TypeSession = {
  prefix: Map<string, { prefix: string; hits: NameHit[]; limited: boolean; limit: number }>;
  memo: Map<string, unknown>;
  regions: Map<string, Region>;
};

export const createTypeSession = (): TypeSession => ({ prefix: new Map(), memo: new Map(), regions: new Map() });

function memoOf<T>(session: TypeSession, key: string, make: () => Promise<T>): Promise<T> {
  const known = session.memo.get(key);
  if (known) return known as Promise<T>;
  if (session.memo.size >= MEMO_LIMIT) session.memo.clear();
  const made = make();
  session.memo.set(key, made);
  return made;
}

export function sessionRegion(region: Region, session: TypeSession): Region {
  const known = session.regions.get(region.id);
  if (known && known.db === region.db) return known;
  const wrapped: Region = {
    ...region,
    async prefixNames(kind, prefix, limit) {
      const key = `${region.id}:${kind}`;
      const from = prefix.slice(0, MAX_KEY);
      const old = session.prefix.get(key);
      const size = limit ?? 0;
      if (old && !old.limited && from.startsWith(old.prefix) && size <= old.limit) return old.hits.filter((h) => h.key >= from && h.key < `${from}￿`).slice(0, size);
      const hits = await region.prefixNames(kind, prefix, limit);
      session.prefix.set(key, { prefix: from, hits, limited: hits.length >= size, limit: size });
      return hits;
    },
    streetsByIds: (ids) => memoOf(session, `${region.id}:s:${ids.join(',')}`, () => region.streetsByIds(ids)),
    hoodsOfStreet: (ids) => memoOf(session, `${region.id}:h:${ids.join(',')}`, () => region.hoodsOfStreet(ids)),
    poisByIds: (ids) => memoOf(session, `${region.id}:p:${ids.join(',')}`, () => region.poisByIds(ids)),
    ...(region.streetsOfHood ? { streetsOfHood: (hoodId: number, limit: number) => memoOf(session, `${region.id}:o:${hoodId}:${limit}`, () => (region.streetsOfHood as NonNullable<Region['streetsOfHood']>)(hoodId, limit)) } : {}),
  };
  session.regions.set(region.id, wrapped);
  return wrapped;
}

export function knownNumbers(rows: AddressRow[], digits: string, districtId: number, hoodId: number | null, limit: number): AddressRow[] {
  const typed = Number(digits);
  return rows
    .filter((r) => r.num !== null && r.suffix === '' && r.districtId === districtId && r.hoodId === hoodId && String(r.num).startsWith(digits))
    .sort((a, b) => Math.abs((a.num as number) - typed) - Math.abs((b.num as number) - typed) || (a.num as number) - (b.num as number) || a.id - b.id)
    .slice(0, limit);
}

export function completionOf(place: Place): string | null {
  const c = place.components;
  if (place.precision === 'poi') return c.poiName ? `${c.poiName} ` : null;
  if ((place.precision === 'address' || place.precision === 'interpolated') && c.street) return `${c.street}${c.houseNumber ? ` No:${c.houseNumber}` : ''} `;
  if (place.precision === 'street' && c.street) return `${c.street} `;
  if (place.precision === 'neighbourhood' && c.neighbourhood) return `${c.neighbourhood} Mah. `;
  if (place.precision === 'district' && c.district) return `${c.district} `;
  if (place.precision === 'province' && c.province) return `${c.province} `;
  return null;
}

export async function unitHintFor(reader: Buildings2, coordinate: [number, number]): Promise<UnitHint | null> {
  const base = await reader.at(coordinate, 10);
  if (!base) return null;
  const around = await reader.near(coordinate, SITE_RADIUS_M, BLOCKS_READ);
  const blocks = new Set<string>();
  for (const { building } of [{ building: base }, ...around]) {
    const name = building.name;
    if (name === null || !/blok|block/i.test(name)) continue;
    const label = name.replace(/\s*(blok|block)\s*/gi, ' ').trim();
    if (label !== '') blocks.add(label);
  }
  return { blocks: [...blocks].sort(), floors: base.levels, flats: base.levels * unitsPerFloor(base.areaM2), floorsSource: base.levelsSource };
}

export function recentsAsPlaces(places: Place[], text: string, limit: number, language: Lang): Place[] {
  void language;
  const query = nameKey(text);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const place of places) {
    if (seen.has(place.id)) continue;
    const key = nameKey(place.label);
    if (query !== '' && !` ${key}`.includes(` ${query}`)) continue;
    seen.add(place.id);
    out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}
