import type { LngLat } from '../geo/cells';
import { cellsAround } from '../geo/cells';
import { distanceM, projectOnLine, ringAround } from '../geo/distance';
import type { Borders } from '../region/borders';
import { pointInRings, type Polygon } from '../region/geom';
import { provinceName } from '../text/admin';
import type { Lang } from '../text/types';
import { formatLabel } from './label';
import { localizeComponents } from './localize';
import type { Region } from './pack';
import type { Components, Place } from './types';

export const ADDRESS_RADIUS_M = 50;
export const STREET_RADIUS_M = 100;
const BORDER_RING_M = 150;
const TIE_M = 1e-6;

export type Reversed = { plate: string; districtId: number | null; hoodId: number | null; addressId: number | null; streetId: number | null; place: Place };


export function firstContaining(polygons: Map<number, Polygon[]>, point: LngLat): number | null {
  for (const [id, rings] of [...polygons].sort((x, y) => x[0] - y[0])) if (pointInRings(point, rings)) return id;
  return null;
}

type Hit = { d: number; plate: string; key: number };

const beats = (a: Hit, b: Hit | null): boolean => b === null || (Math.abs(a.d - b.d) <= TIE_M ? (a.plate === b.plate ? a.key < b.key : a.plate < b.plate) : a.d < b.d);

export async function reverseDetailed(regions: Region[], borders: Borders, point: LngLat, language: Lang = 'tr'): Promise<Reversed | null> {
  const plates = new Set<string>();
  for (const p of [point, ...ringAround(point, BORDER_RING_M)]) {
    const plate = borders.provinceAt(p[0], p[1]);
    if (plate) plates.add(plate);
  }
  const here = regions.filter((r) => plates.has(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (here.length === 0) return null;
  const name = (region: Region, districtId: number | null, hoodId: number | null): Components => {
    const out: Components = { province: provinceName(region.id) ?? region.id };
    const district = region.districts.find((d) => d.id === districtId);
    if (district) out.district = district.name;
    const hood = region.hoods.find((h) => h.id === hoodId);
    if (hood) out.neighbourhood = hood.name;
    return out;
  };
  const make = (region: Region, id: string, precision: Place['precision'], components: Components, source: Place['source']): Place => {
    const shown = localizeComponents({ language, region }, components);
    return { id, label: formatLabel(shown, language), components: shown, ...(shown === components ? {} : { local: components }), coordinate: point, precision, approximate: true, source, confidence: 1, region: region.id };
  };

  let door: (Hit & { region: Region; row: Awaited<ReturnType<Region['addressesInCells']>>[number] }) | null = null;
  for (const region of here) {
    for (const row of await region.addressesInCells(cellsAround(point, ADDRESS_RADIUS_M))) {
      const hit = { d: distanceM(point, [row.lng, row.lat]), plate: region.id, key: row.id };
      if (hit.d <= ADDRESS_RADIUS_M && beats(hit, door)) door = { ...hit, region, row };
    }
  }
  if (door) {
    const { region, row } = door;
    const street = row.streetId === null ? undefined : (await region.streetsByIds([row.streetId]))[0];
    const components = name(region, row.districtId, row.hoodId);
    if (street) components.street = street.name;
    components.houseNumber = row.number;
    if (row.postcode) components.postcode = row.postcode;
    return { plate: region.id, districtId: row.districtId, hoodId: row.hoodId, addressId: row.id, streetId: row.streetId, place: make(region, `${region.id}:a:${row.id}`, 'address', components, 'osm') };
  }

  let road: (Hit & { region: Region; part: Awaited<ReturnType<Region['partsInCells']>>[number] }) | null = null;
  for (const region of here) {
    for (const part of await region.partsInCells(cellsAround(point, STREET_RADIUS_M))) {
      const d = Math.min(...part.lines.filter((l) => l.length > 0).map((l) => projectOnLine(point, l).distanceM));
      const hit = { d, plate: region.id, key: part.id };
      if (d <= STREET_RADIUS_M && beats(hit, road)) road = { ...hit, region, part };
    }
  }
  if (road) {
    const { region, part } = road;
    const street = (await region.streetsByIds([part.nameId]))[0];
    const components = name(region, part.districtId, part.hoodId);
    if (street) components.street = street.name;
    return { plate: region.id, districtId: part.districtId, hoodId: part.hoodId, addressId: null, streetId: part.nameId, place: make(region, `${region.id}:s:${part.nameId}:${part.hoodId ?? 0}`, 'street', components, 'derived') };
  }

  for (const region of here) {
    const districtId = firstContaining(await region.districtPolygons(), point);
    if (districtId === null) continue;
    const hoodId = firstContaining(await region.hoodPolygons(districtId), point);
    if (hoodId !== null) return { plate: region.id, districtId, hoodId, addressId: null, streetId: null, place: make(region, `${region.id}:h:${hoodId}`, 'neighbourhood', name(region, districtId, hoodId), 'derived') };
    return { plate: region.id, districtId, hoodId: null, addressId: null, streetId: null, place: make(region, `${region.id}:d:${districtId}`, 'district', name(region, districtId, null), 'derived') };
  }
  const plate = borders.provinceAt(point[0], point[1]);
  const region = here.find((r) => r.id === plate);
  if (!region) return null;
  return { plate: region.id, districtId: null, hoodId: null, addressId: null, streetId: null, place: make(region, `${region.id}:p:0`, 'province', name(region, null, null), 'derived') };
}

export async function reversePoint(regions: Region[], borders: Borders, point: LngLat, language: Lang = 'tr'): Promise<Place | null> {
  return (await reverseDetailed(regions, borders, point, language))?.place ?? null;
}
