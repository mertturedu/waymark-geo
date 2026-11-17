import { edgeDistanceM, type Buildings2 } from '../../src/core/address/buildings2';
import type { Search } from '../../src/core/address/search';
import type { Place, StructuredQuery } from '../../src/core/address/types';
import type { LngLat } from '../../src/core/geo/cells';
import { sideOfLine } from '../../src/core/address/reverse-street';
import { projectOnLine } from '../../src/core/geo/distance';
import { deliveryStop, ENTRANCE_REACH_M, type OnSide } from '../../src/core/learned/stops';
import { provinceName } from '../../src/core/text/admin';
import { nameKey } from '../../src/core/text/fold';
import type { DeliveryRecord } from '../real/records';

export type WithStops = { records: DeliveryRecord[]; withStop: number; noStop: number; entrances: number };

const REFERENCE_PRECISION: readonly string[] = ['address', 'interpolated'];
const SIDE_REACH_M = 60;

async function streetSide(search: Search, place: Place): Promise<{ onSide?: OnSide }> {
  const chain = (await search.arrival(place)).chain ?? [];
  let line: readonly LngLat[] | null = null;
  let best = Infinity;
  for (const candidate of chain) {
    if (candidate.length < 2) continue;
    const away = projectOnLine(place.coordinate, candidate as LngLat[]).distanceM;
    if (away < best) {
      best = away;
      line = candidate;
    }
  }
  return line && best <= SIDE_REACH_M ? { onSide: { line, side: sideOfLine(place.coordinate, line as LngLat[]) } } : {};
}

export async function attachStops(records: readonly DeliveryRecord[], search: Search, buildings?: Buildings2): Promise<WithStops> {
  const references = new Map<string, { point: LngLat; onSide?: OnSide } | null>();
  const out: DeliveryRecord[] = [];
  let withStop = 0;
  let noStop = 0;
  let entrances = 0;
  for (const record of records) {
    if (!record.trace) {
      out.push(record);
      continue;
    }
    const { trace, ...rest } = record;
    const key = `${record.region}|${nameKey(record.district)}|${nameKey(record.neighbourhood ?? '')}|${nameKey(record.street ?? '')}|${record.houseNumber}`;
    let place = references.get(key);
    if (place === undefined) {
      const query: StructuredQuery = { province: provinceName(record.region) ?? record.region, district: record.district, ...(record.neighbourhood ? { neighbourhood: record.neighbourhood } : {}), ...(record.street ? { street: record.street } : {}), houseNumber: record.houseNumber };
      const result = await search.resolve(query, { limit: 5 });
      const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      place = best && REFERENCE_PRECISION.includes(best.precision) ? { point: best.coordinate, ...(await streetSide(search, best)) } : null;
      references.set(key, place);
    }
    const intended: LngLat[] = [...(record.pin ? [[record.pin.lng, record.pin.lat] as LngLat] : []), ...(place ? [place.point] : [])];
    const stop = deliveryStop(trace, intended, record.gps, place?.onSide);
    if (!stop) {
      noStop++;
      out.push(rest);
      continue;
    }
    withStop++;
    let entrance = record.entrance;
    if (!entrance && buildings) {
      const building = (await buildings.near(stop.point, ENTRANCE_REACH_M, 1))[0]?.building;
      if (building && edgeDistanceM(stop.point, building.ring) <= ENTRANCE_REACH_M) {
        entrance = { lng: stop.point[0], lat: stop.point[1] };
        entrances++;
      }
    }
    out.push({ ...rest, stop: { lng: stop.point[0], lat: stop.point[1] }, ...(entrance ? { entrance } : {}) });
  }
  return { records: out, withStop, noStop, entrances };
}
