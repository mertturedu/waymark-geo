import { cellOf, cellsAround, type LngLat } from '../../src/core/geo/cells';
import { distanceM } from '../../src/core/geo/distance';

export type Building = { id: string; lng: number; lat: number; area: number };
export type BuildingIndex = { around(point: LngLat, radiusM: number): Building[] };

export { CLAIM_M } from '../../src/core/address/buildings';
export const CENTROID_M = 3;
export const CENTROID_MIN = 0.5;
const ROW = 65536;

export function indexBuildings(list: Building[]): BuildingIndex {
  const cells = new Map<number, Building[]>();
  for (const item of list) {
    const key = cellOf(item.lng, item.lat);
    const bucket = cells.get(key);
    if (bucket) bucket.push(item);
    else cells.set(key, [item]);
  }
  return {
    around(point, radiusM) {
      return cellsAround(point, radiusM).flatMap((cell) => cells.get(cell) ?? []).filter((item) => distanceM(point, [item.lng, item.lat]) <= radiusM);
    },
  };
}

export function centroidRatio(points: LngLat[], index: BuildingIndex): number {
  if (points.length === 0) return 0;
  return points.filter((p) => index.around(p, CENTROID_M).length > 0).length / points.length;
}

export const qualifies = (ratio: number): boolean => ratio >= CENTROID_MIN;

export function nearStreet(building: Building, streetCells: ReadonlySet<number>): boolean {
  const cell = cellOf(building.lng, building.lat);
  for (const dy of [-ROW, 0, ROW]) for (const dx of [-1, 0, 1]) if (streetCells.has(cell + dy + dx)) return true;
  return false;
}

export function sampleDoors(doors: { point: LngLat }[]): LngLat[] {
  return doors.filter((_, i) => i % 37 === 0).slice(0, 4000).map((d) => d.point);
}
