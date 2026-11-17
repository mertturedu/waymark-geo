import type { Search } from '../../src/core/address/search';
import type { LngLat } from '../../src/core/geo/cells';
import { nameKey } from '../../src/core/text/fold';
import type { DeliveryRecord } from '../real/records';

export type HoodSuggestion = { region: string; district: string; written: string; found: string; count: number };

export const MIN_HOOD_RECORDS = 3;
const MAX_GPS_ACCURACY_M = 30;
const HOOD_WORDS = new Set(['mah', 'mh', 'mahalle', 'mahallesi']);

const hoodKey = (name: string): string => nameKey(name).split(' ').filter((w) => !HOOD_WORDS.has(w)).join(' ');

const pointOf = (record: DeliveryRecord): LngLat | null => {
  if (record.stop) return [record.stop.lng, record.stop.lat];
  if (record.pin) return [record.pin.lng, record.pin.lat];
  if (record.gps && record.gps.accuracyM <= MAX_GPS_ACCURACY_M) return [record.gps.lng, record.gps.lat];
  return null;
};

export async function hoodSuggestions(records: readonly DeliveryRecord[], search: Search, minCount = MIN_HOOD_RECORDS): Promise<HoodSuggestion[]> {
  const tally = new Map<string, HoodSuggestion>();
  for (const record of records) {
    const point = pointOf(record);
    if (!record.neighbourhood || !point) continue;
    const place = await search.reverse(point);
    const found = place?.local?.neighbourhood ?? place?.components.neighbourhood;
    if (!found || hoodKey(found) === hoodKey(record.neighbourhood)) continue;
    const key = `${record.region}|${nameKey(record.district)}|${hoodKey(record.neighbourhood)}|${hoodKey(found)}`;
    const known = tally.get(key);
    if (known) known.count++;
    else tally.set(key, { region: record.region, district: record.district, written: record.neighbourhood, found, count: 1 });
  }
  return [...tally.values()].filter((s) => s.count >= minCount).sort((a, b) => b.count - a.count || (a.written < b.written ? -1 : 1));
}
