import type { Search } from '../../src/core/address/search';
import type { Components, Place, StructuredQuery } from '../../src/core/address/types';
import type { LngLat } from '../../src/core/geo/cells';
import { provinceName } from '../../src/core/text/admin';
import { nameKey } from '../../src/core/text/fold';
import { houseNumberKey } from '../../src/core/text/number';
import { streetKey } from '../../src/core/text/street';
import type { DeliveryRecord } from '../real/records';

export type Canonical = { records: DeliveryRecord[]; resolved: number; renamed: number; unresolved: number; unknownStreets: Set<string> };

export const streetId = (district: string, street: string): string => `${nameKey(district)}|${nameKey(street)}`;

const KEEP: readonly Place['precision'][] = ['address', 'interpolated', 'street'];

type Names = { district: string; neighbourhood?: string; street?: string };

function pick(candidates: Place[], record: DeliveryRecord): Place | undefined {
  const sameDistrict = candidates.filter((p) => KEEP.includes(p.precision) && nameKey(p.components.district ?? '') === nameKey(record.district));
  const hood = record.neighbourhood ? nameKey(record.neighbourhood) : null;
  return (hood ? sameDistrict.find((p) => nameKey(p.components.neighbourhood ?? '') === hood) : undefined) ?? sameDistrict[0];
}

export async function canonicalize(records: readonly DeliveryRecord[], search: Search): Promise<Canonical> {
  const cache = new Map<string, Names | null>();
  const out: DeliveryRecord[] = [];
  let resolved = 0;
  let renamed = 0;
  let unresolved = 0;
  const unknownStreets = new Set<string>();
  for (const record of records) {
    const triple = `${record.region}|${nameKey(record.district)}|${nameKey(record.neighbourhood ?? '')}|${nameKey(record.street ?? '')}`;
    let names = cache.get(triple);
    if (names === undefined) {
      const query: StructuredQuery = { province: provinceName(record.region) ?? record.region, district: record.district, ...(record.neighbourhood ? { neighbourhood: record.neighbourhood } : {}), ...(record.street ? { street: record.street } : {}), houseNumber: record.houseNumber };
      const result = await search.resolve(query, { limit: 10 });
      const candidates = result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : [];
      const place = pick(candidates, record);
      const native = place ? (place.local ?? place.components) : null;
      names = place && native?.district && (record.street ? native.street : true) ? { district: native.district, ...(native.neighbourhood ? { neighbourhood: native.neighbourhood } : {}), ...(native.street ? { street: native.street } : {}) } : null;
      cache.set(triple, names);
    }
    if (!names) {
      unresolved++;
      if (record.street) unknownStreets.add(streetId(record.district, record.street));
      out.push(record);
      continue;
    }
    resolved++;
    const next: DeliveryRecord = { ...record, district: names.district, ...(names.neighbourhood ? { neighbourhood: names.neighbourhood } : {}), ...(names.street ? { street: names.street } : {}) };
    if (next.district !== record.district || next.neighbourhood !== record.neighbourhood || next.street !== record.street) renamed++;
    out.push(next);
  }
  return { records: out, resolved, renamed, unresolved, unknownStreets };
}

export const OSM_DOOR_PRECISION = 'address';

function sameDoor(found: Components, probe: Components): boolean {
  const number = houseNumberKey(probe.houseNumber ?? '');
  if (!number || houseNumberKey(found.houseNumber ?? '')?.key !== number.key) return false;
  return probe.street ? streetKey(found.street ?? '').key === streetKey(probe.street).key : true;
}

export function osmPointOf(search: Search, region: string): (probe: Components) => Promise<LngLat | null> {
  return async (probe) => {
    if (!probe.district || !probe.houseNumber) return null;
    const result = await search.resolve({ province: provinceName(region) ?? region, district: probe.district, ...(probe.neighbourhood ? { neighbourhood: probe.neighbourhood } : {}), ...(probe.street ? { street: probe.street } : {}), houseNumber: probe.houseNumber }, { limit: 5 });
    const place = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    return place && place.precision === OSM_DOOR_PRECISION && place.source === 'osm' && sameDoor(place.components, probe) ? place.coordinate : null;
  };
}
