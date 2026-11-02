import type { Place } from '../../../src/core/address/types';
import { distanceM } from '../../../src/core/geo/distance';

export type GoldenEntry = { id: string; text: string; category: string; conflict?: boolean; expect: { osm: string; number?: string } };
export type ExpectedRow = { id: number; number: string; lng: number; lat: number };

const TWIN_M = 30;
const KIND: Record<string, number> = { n: 0, w: 1, r: 2 };

export const osmCode = (osm: string): number => Number(osm.slice(1)) * 4 + (KIND[osm[0] as string] as number);
const SKIPPED = new Set(['poi', 'hide', 'lang']);

export function isHit(place: Place, plate: string, rows: ExpectedRow[]): boolean {
  const [region, kind, id] = place.id.split(':');
  if (place.precision !== 'address' || region !== plate || kind !== 'a') return false;
  if (rows.some((r) => r.id === Number(id))) return true;
  return rows.some((r) => r.number === place.components.houseNumber && distanceM(place.coordinate, [r.lng, r.lat]) <= TWIN_M);
}

export function pickQueries(list: GoldenEntry[], count: number): GoldenEntry[] {
  const pool = list.filter((q) => !q.conflict && !SKIPPED.has(q.category));
  if (pool.length <= count) return pool;
  return Array.from({ length: count }, (_, i) => pool[Math.floor((i * pool.length) / count)] as GoldenEntry);
}

export function timingNote(times: number[]): { p50: number; p95: number; max: number } {
  if (times.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] as number };
}
