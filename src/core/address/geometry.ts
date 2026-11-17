import type { LngLat } from '../geo/cells';
import { bboxOf, pointCount, simplifyLine, simplifyPolygons, type Bbox } from '../geo/simplify';
import { nameKey } from '../text/fold';
import type { Region } from './pack';
import type { Place, PlaceGeometry } from './types';

export const STREET_TOLERANCE_M = 2;
export const AREA_TOLERANCE_M = 10;
export const MAX_STREET_POINTS = 1500;
export const MAX_AREA_POINTS = 1500;
const SAME_NAME_LIMIT = 80;

export type PlaceShape = { geometry: PlaceGeometry | null; bbox: Bbox | null };

function districtIdOf(region: Region, place: Place, hoodId: number | null): number | null {
  const hood = hoodId === null ? undefined : region.hoods.find((h) => h.id === hoodId);
  if (hood) return hood.districtId;
  const name = place.local?.district ?? place.components.district;
  if (!name) return null;
  const key = nameKey(name);
  return region.districts.find((d) => d.key === key)?.id ?? null;
}

async function streetShape(region: Region, place: Place, ref: number, hoodId: number | null): Promise<PlaceShape | null> {
  const row = (await region.streetsByIds([ref]))[0];
  if (!row) return null;
  const same = (await region.streetCandidates(row.key, 'street', SAME_NAME_LIMIT)).filter((c) => c.nameId !== ref && c.key === row.key).map((c) => c.nameId);
  const others = same.length === 0 ? [] : (await region.streetsByIds(same)).filter((r) => r.kind === row.kind).map((r) => r.id);
  const districtId = districtIdOf(region, place, hoodId);
  const all = [];
  for (const id of [ref, ...others]) all.push(...(await region.partsOf(id)));
  const inDistrict = districtId === null ? all : all.filter((p) => p.districtId === districtId);
  const parts = inDistrict.length > 0 ? inDistrict : all;
  const lines: LngLat[][] = [];
  const local = new Set<number>();
  for (const part of parts) {
    for (const line of part.lines) {
      if (line.length < 2) continue;
      if (hoodId !== null && part.hoodId === hoodId) local.add(lines.length);
      lines.push(line);
    }
  }
  if (lines.length === 0) return null;
  const bbox = bboxOf(lines);
  let tolerance = STREET_TOLERANCE_M;
  let simplified = lines.map((l) => simplifyLine(l, tolerance));
  while (pointCount(simplified) > MAX_STREET_POINTS && tolerance < 100_000) {
    tolerance *= 2;
    simplified = lines.map((l) => simplifyLine(l, tolerance));
  }
  const remap = new Map<number, number>();
  const kept: LngLat[][] = [];
  simplified.forEach((line, i) => {
    if (line.length < 2) return;
    remap.set(i, kept.length);
    kept.push(line);
  });
  const ids = [ref, ...others];
  const range = (await region.db.all<{ lo: number | null; hi: number | null }>(`SELECT MIN(num) AS lo, MAX(num) AS hi FROM address WHERE street_id IN (${ids.map(() => '?').join(', ')})${districtId === null ? '' : ' AND district_id = ?'}`, [...ids, ...(districtId === null ? [] : [districtId])]))[0];
  const numbers: [number, number] | null = range && range.lo !== null && range.hi !== null && range.lo > 0 ? [range.lo, range.hi] : null;
  return { geometry: { kind: 'street', lines: kept, local: [...local].flatMap((i) => (remap.has(i) ? [remap.get(i) as number] : [])), numbers, parts: parts.length, points: pointCount(kept) }, bbox };
}

async function areaShape(region: Region, level: 'neighbourhood' | 'district', id: number): Promise<PlaceShape | null> {
  let polygons: LngLat[][][] | undefined;
  if (level === 'district') polygons = (await region.districtPolygons()).get(id) as LngLat[][][] | undefined;
  else {
    const hood = region.hoods.find((h) => h.id === id);
    polygons = hood ? ((await region.hoodPolygons(hood.districtId)).get(id) as LngLat[][][] | undefined) : undefined;
  }
  if (!polygons || polygons.length === 0) return null;
  const simplified = simplifyPolygons(polygons, AREA_TOLERANCE_M, MAX_AREA_POINTS);
  return { geometry: { kind: 'area', level, polygons: simplified, points: pointCount(simplified.flat()) }, bbox: bboxOf(polygons.flat()) };
}

export async function shapeOf(region: Region, place: Place, provinceBounds: (plate: string) => Bbox | null): Promise<PlaceShape | null> {
  const [plate, tag, first, second] = place.id.split(':');
  if (plate !== region.id || !tag) return null;
  const ref = Number(first);
  if (place.precision === 'street' && tag === 's' && Number.isInteger(ref)) return streetShape(region, place, ref, Number(second) > 0 ? Number(second) : null);
  if (place.precision === 'neighbourhood' && tag === 'h' && Number.isInteger(ref)) return areaShape(region, 'neighbourhood', ref);
  if (place.precision === 'district' && tag === 'd' && Number.isInteger(ref)) return areaShape(region, 'district', ref);
  if (place.precision === 'province') {
    const bbox = provinceBounds(region.id);
    return bbox ? { geometry: null, bbox } : null;
  }
  return null;
}
