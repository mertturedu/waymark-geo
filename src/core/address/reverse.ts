import type { LngLat } from '../geo/cells';
import { cellsAround } from '../geo/cells';
import { distanceM, projectOnLine, ringAround } from '../geo/distance';
import type { Borders } from '../region/borders';
import { pointInRings, type Polygon } from '../region/geom';
import { provinceName } from '../text/admin';
import type { Lang } from '../text/types';
import type { Buildings2, BuildingInfo } from './buildings2';
import { formatLabel } from './label';
import { localizeComponents } from './localize';
import type { Region } from './pack';
import type { Components, Place } from './types';
import { chooseBuilding, lowAccuracy, ownedDoor, reachFor } from './reverse-building';
import { aroundOnLine, estimateOnStreet, nearestLine, sideOfLine, voteStreet, DOOR_REACH_M } from './reverse-street';

export const ADDRESS_RADIUS_M = 50;
export const STREET_RADIUS_M = 100;
const BORDER_RING_M = 150;
const TIE_M = 1e-6;

export type ReverseExtras = { readers?: Map<string, Buildings2>; heading?: number; accuracyM?: number; hide?: ReadonlySet<number> };

const AROUND_BUILDINGS = 40;
const AROUND_SEARCH_M = 90;
const NEAR_BUILDINGS = 12;
const SITE_M = 300;
const ESTIMATE_CONFIDENCE = 0.7;

export type Reversed = { plate: string; districtId: number | null; hoodId: number | null; addressId: number | null; streetId: number | null; place: Place };


export function firstContaining(polygons: Map<number, Polygon[]>, point: LngLat): number | null {
  for (const [id, rings] of [...polygons].sort((x, y) => x[0] - y[0])) if (pointInRings(point, rings)) return id;
  return null;
}

type Hit = { d: number; plate: string; key: number };

const beats = (a: Hit, b: Hit | null): boolean => b === null || (Math.abs(a.d - b.d) <= TIE_M ? (a.plate === b.plate ? a.key < b.key : a.plate < b.plate) : a.d < b.d);

export async function reverseDetailed(regions: Region[], borders: Borders, point: LngLat, language: Lang = 'tr', extras: ReverseExtras = {}): Promise<Reversed | null> {
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

  for (const region of here) {
    const reader = extras.readers?.get(region.id);
    const built = reader ? await reverseByBuilding(region, reader, point, extras, name, make) : null;
    if (built) return built;
  }

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

export async function reversePoint(regions: Region[], borders: Borders, point: LngLat, language: Lang = 'tr', extras: ReverseExtras = {}): Promise<Place | null> {
  return (await reverseDetailed(regions, borders, point, language, extras))?.place ?? null;
}

type Namer = (region: Region, districtId: number | null, hoodId: number | null) => Components;
type Maker = (region: Region, id: string, precision: Place['precision'], components: Components, source: Place['source']) => Place;

async function roadOnly(region: Region, point: LngLat): Promise<BuildingInfo | null> {
  let best: { d: number; nameId: number } | null = null;
  for (const part of await region.partsInCells(cellsAround(point, STREET_RADIUS_M))) {
    const found = nearestLine(point, part.lines);
    if (found && found.distanceM <= STREET_RADIUS_M && (best === null || found.distanceM < best.d || (found.distanceM === best.d && part.nameId < best.nameId))) best = { d: found.distanceM, nameId: part.nameId };
  }
  if (!best) return null;
  return { id: -1, gid: '', center: point, areaM2: 0, levels: 0, levelsSource: 'region', heightM: null, name: null, chain: best.nameId, part: null, side: null, distanceM: null, along: null, sequence: null, secondChain: null, thirdChain: null, ring: [] };
}

async function reverseByBuilding(region: Region, reader: Buildings2, point: LngLat, extras: ReverseExtras, name: Namer, make: Maker): Promise<Reversed | null> {
  const inside = await reader.at(point, 0.5);
  const near = inside ? [] : await reader.near(point, reachFor(extras.accuracyM), NEAR_BUILDINGS);
  const found = chooseBuilding(point, inside, near, extras.heading);
  const building = found ?? (await roadOnly(region, point));
  if (!building) return null;
  const hidden = extras.hide ?? new Set<number>();
  const rows = (await region.addressesInCells(cellsAround(building.center, DOOR_REACH_M))).filter((r) => !hidden.has(r.id));
  const owned = ownedDoor(rows, building, point);
  const notes: string[] = [];
  if (lowAccuracy(extras.accuracyM)) notes.push('low_accuracy');
  const streetId = owned ? owned.streetId : voteStreet(building.center, rows.map((r) => ({ streetId: r.streetId, point: [r.lng, r.lat] as LngLat })), [building.chain, building.secondChain, building.thirdChain]);
  const street = streetId === null ? undefined : (await region.streetsByIds([streetId]))[0];
  const parts = streetId === null ? [] : await region.partsOf(streetId);
  let nearestPart: (typeof parts)[number] | null = null;
  let line: LngLat[] | null = null;
  let gap = Infinity;
  for (const part of parts) {
    const found = nearestLine(building.center, part.lines);
    if (found && found.distanceM < gap) {
      gap = found.distanceM;
      nearestPart = part;
      line = found.line;
    }
  }
  const districtId = owned?.districtId ?? nearestPart?.districtId ?? null;
  const hoodId = owned?.hoodId ?? nearestPart?.hoodId ?? null;
  const components = name(region, districtId, hoodId);
  if (street) components.street = street.name;
  let precision: Place['precision'] = street ? 'street' : 'neighbourhood';
  let source: Place['source'] = 'derived';
  let confidence = 1;
  let numberRange: [number, number] | undefined;
  let side: 'left' | 'right' | undefined;
  let around: Place['around'];
  let addressId: number | null = null;
  let estimate: ReturnType<typeof estimateOnStreet> = null;
  if (owned) {
    components.houseNumber = owned.number;
    if (owned.postcode) components.postcode = owned.postcode;
    precision = 'address';
    source = 'osm';
    addressId = owned.id;
  } else if (streetId !== null && districtId !== null && line) {
    const doors = (await region.neighbours(streetId, null, districtId)).filter((r) => r.num !== null && !hidden.has(r.id)).map((r) => ({ number: r.num as number, point: [r.lng, r.lat] as LngLat }));
    estimate = estimateOnStreet(building.center, line, doors);
    if (estimate) {
      components.houseNumber = String(estimate.number);
      precision = 'interpolated';
      source = 'interpolated';
      confidence = ESTIMATE_CONFIDENCE;
      numberRange = [estimate.low, estimate.high];
      side = estimate.side;
      notes.push('number_estimated');
    } else notes.push('side_only');
  }
  if (line) {
    side ??= sideOfLine(building.center, line);
    const neighbours = (await reader.near(building.center, AROUND_SEARCH_M, AROUND_BUILDINGS)).map((n) => ({ id: n.building.id, center: n.building.center }));
    around = aroundOnLine(building, neighbours, line, estimate);
  }
  const site = found ? ((await reader.settlements(building.center, SITE_M, 1))[0]?.settlement.name ?? null) : null;
  const entrances = found ? (await reader.entrances(building.id)).map((e) => ({ kind: e.kind, ref: e.ref, flats: e.flats, point: e.point })) : [];
  const base = make(region, found ? `${region.id}:b:${building.id}` : `${region.id}:r:${streetId ?? 0}:${hoodId ?? 0}`, precision, components, source);
  const place: Place = {
    ...base,
    approximate: precision !== 'address',
    confidence,
    ...(notes.length > 0 ? { notes } : {}),
    ...(side ? { side } : {}),
    ...(numberRange ? { numberRange } : {}),
    ...(around && around.length > 0 ? { around } : {}),
    ...(found ? { building: { id: building.id, levels: building.levels, levelsSource: building.levelsSource, areaM2: building.areaM2, entrances, site } } : {}),
  };
  return { plate: region.id, districtId, hoodId, addressId, streetId, place };
}
