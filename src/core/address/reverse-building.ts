import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { edgeDistanceM, pointInRing, type BuildingInfo } from './buildings2';
import type { AddressRow } from './pack';

export const REVERSE_REACH_M = 25;
export const REVERSE_MAX_REACH_M = 60;
export const OWN_DOOR_M = 3;
const BEHIND_PENALTY_M = 15;
const LOW_ACCURACY_M = 50;

export const reachFor = (accuracyM: number | undefined): number => (accuracyM !== undefined && Number.isFinite(accuracyM) && accuracyM > REVERSE_REACH_M ? Math.min(accuracyM, REVERSE_MAX_REACH_M) : REVERSE_REACH_M);
export const lowAccuracy = (accuracyM: number | undefined): boolean => accuracyM !== undefined && Number.isFinite(accuracyM) && accuracyM > LOW_ACCURACY_M;

export function bearingDeg(from: LngLat, to: LngLat): number {
  const k = Math.cos((from[1] * Math.PI) / 180);
  const east = (to[0] - from[0]) * k;
  const north = to[1] - from[1];
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

const angleBetween = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function chooseBuilding(point: LngLat, inside: BuildingInfo | null, near: { building: BuildingInfo; distanceM: number }[], heading?: number): BuildingInfo | null {
  if (inside) return inside;
  const valid = heading !== undefined && Number.isFinite(heading);
  let best: BuildingInfo | null = null;
  let bestCost = Infinity;
  for (const n of near) {
    const ahead = valid ? angleBetween(heading as number, bearingDeg(point, n.building.center)) <= 90 : true;
    const cost = n.distanceM + (ahead ? 0 : BEHIND_PENALTY_M);
    if (cost < bestCost || (cost === bestCost && best !== null && n.building.id < best.id)) {
      bestCost = cost;
      best = n.building;
    }
  }
  return best;
}

export function ownedDoor(rows: AddressRow[], building: BuildingInfo, point: LngLat): AddressRow | null {
  let best: { row: AddressRow; gap: number } | null = null;
  for (const row of rows) {
    const at: LngLat = [row.lng, row.lat];
    const gap = building.ring.length > 2 ? (pointInRing(at, building.ring) ? 0 : edgeDistanceM(at, building.ring)) : distanceM(at, building.center);
    if (gap > OWN_DOOR_M) continue;
    const away = distanceM(at, point);
    if (best === null || away < best.gap || (away === best.gap && row.id < best.row.id)) best = { row, gap: away };
  }
  return best?.row ?? null;
}
