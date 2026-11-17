import type { LngLat } from '../geo/cells';
import { provinceIds, provinceName } from '../text/admin';
import type { StreetRange } from './buildings2';
import type { Region } from './pack';

export type AdminQuery = { province?: string; district?: string; hood?: string; street?: string; limit?: number };
export type AdminLevel = 'country' | 'province' | 'district' | 'hood' | 'street';
export type AdminItem = { id: string; name: string; center?: LngLat; installed?: boolean; source?: number; doors?: number };
export type StreetDoor = { number: string; point: LngLat };
export type AdminResult = { level: AdminLevel; items: AdminItem[]; ranges?: StreetRange[]; doors?: StreetDoor[] };

export const ADMIN_LIMIT = 500;
export const ADMIN_DOOR_LIMIT = 500;

export type AdminContext = {
  installed: string[];
  regionOf(plate: string): Promise<{ region: Region; ranges?(chain: number): Promise<StreetRange[]> } | null>;
};

const plateOf = (value: string): string | null => /^[A-Z]?(\d{2})/.exec(value)?.[1] ?? null;

export function countryLevel(installed: string[]): AdminResult {
  const have = new Set(installed);
  return { level: 'country', items: provinceIds().map((plate) => ({ id: plate, name: provinceName(plate) ?? plate, installed: have.has(plate) })) };
}

export async function adminLookup(context: AdminContext, query: AdminQuery): Promise<AdminResult | null> {
  const limit = Math.max(1, Math.min(ADMIN_LIMIT, Math.floor(query.limit ?? ADMIN_LIMIT)));
  if (query.street) {
    const plate = plateOf(query.street);
    const entry = plate ? await context.regionOf(plate) : null;
    const found = entry ? await entry.region.idOfSid(query.street) : null;
    if (!entry || !found || found.type !== 's') return null;
    const doors = (await entry.region.db.all<{ number: string; lon: number; lat: number }>('SELECT number, lon, lat FROM address WHERE street_id = ? ORDER BY num, suffix, id LIMIT ?', [found.id, ADMIN_DOOR_LIMIT])).map((r) => ({ number: r.number, point: [r.lon / 1e6, r.lat / 1e6] as LngLat }));
    const ranges = entry.ranges ? await entry.ranges(found.id) : [];
    return { level: 'street', items: [], doors, ranges };
  }
  if (query.hood) {
    const plate = plateOf(query.hood);
    const entry = plate ? await context.regionOf(plate) : null;
    const found = entry ? await entry.region.idOfSid(query.hood) : null;
    if (!entry || !found || found.type !== 'h' || !entry.region.streetsOfHood) return null;
    const rows = await entry.region.streetsOfHood(found.id, limit);
    const names = new Map((await entry.region.streetsByIds(rows.map((r) => r.streetId))).map((s) => [s.id, s.name]));
    const sids = await entry.region.sidsOf('s', rows.map((r) => r.streetId));
    return { level: 'hood', items: rows.flatMap((r) => (sids.has(r.streetId) ? [{ id: sids.get(r.streetId) as string, name: names.get(r.streetId) ?? '', doors: r.doors }] : [])) };
  }
  if (query.district) {
    const plate = plateOf(query.district);
    const entry = plate ? await context.regionOf(plate) : null;
    const found = entry ? await entry.region.idOfSid(query.district) : null;
    if (!entry || !found || found.type !== 'd') return null;
    const hoods = entry.region.hoods.filter((h) => h.districtId === found.id).slice(0, limit);
    const sids = await entry.region.sidsOf('h', hoods.map((h) => h.id));
    return { level: 'district', items: hoods.flatMap((h) => (sids.has(h.id) ? [{ id: sids.get(h.id) as string, name: h.name, ...(h.center ? { center: h.center } : {}), source: h.source }] : [])) };
  }
  if (query.province) {
    if (!/^\d{2}$/.test(query.province)) return null;
    const entry = await context.regionOf(query.province);
    if (!entry) return null;
    const sids = await entry.region.sidsOf('d', entry.region.districts.map((d) => d.id));
    return { level: 'province', items: entry.region.districts.flatMap((d) => (sids.has(d.id) ? [{ id: sids.get(d.id) as string, name: d.name, center: d.center }] : [])) };
  }
  return countryLevel(context.installed);
}
