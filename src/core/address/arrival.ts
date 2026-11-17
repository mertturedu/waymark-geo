import type { LngLat } from '../geo/cells';
import { cellsAround } from '../geo/cells';
import type { Arrival } from '../route/arrival';
import { CHAIN_REACH_M } from '../route/snap';
import { nameKey } from '../text/fold';
import { sameStreet, streetKey } from '../text/street';
import type { EntranceInfo } from './buildings2';
import type { NamedPart, Region } from './pack';
import type { Place } from './types';
import { nearestLine } from './reverse-street';
import { pickEntrance } from './unit';

export const CHAIN_LINE_REACH_M = CHAIN_REACH_M + 50;

export const entranceOf = (place: Place): LngLat | undefined => place.unit?.entrance?.point ?? place.entrance;

function homeStreets(region: Region, place: Place, parts: NamedPart[]): Set<number> {
  const all = new Set(parts.map((part) => part.nameId));
  const hood = nameKey(place.local?.neighbourhood ?? place.components.neighbourhood ?? '');
  const district = nameKey(place.local?.district ?? place.components.district ?? '');
  const hoods = hood === '' ? [] : region.hoods.filter((h) => h.key === hood && (district === '' || region.districts.some((d) => d.id === h.districtId && d.key === district))).map((h) => h.id);
  const inHood = new Set(parts.filter((part) => part.hoodId !== null && hoods.includes(part.hoodId)).map((part) => part.nameId));
  if (inHood.size > 0) return inHood;
  const districts = district === '' ? [] : region.districts.filter((d) => d.key === district).map((d) => d.id);
  const inDistrict = new Set(parts.filter((part) => districts.includes(part.districtId)).map((part) => part.nameId));
  return inDistrict.size > 0 ? inDistrict : all;
}

const sameKind = (a: string, b: string): boolean => {
  const left = streetKey(a).kind;
  const right = streetKey(b).kind;
  return !left || !right || left === right;
};

export async function chainLines(region: Region, place: Place, aim: LngLat): Promise<LngLat[][]> {
  const street = place.local?.street ?? place.components.street;
  if (!street) return [];
  const parts = await region.partsInCells(cellsAround(aim, CHAIN_LINE_REACH_M));
  if (parts.length === 0) return [];
  const ids = [...new Set(parts.map((p) => p.nameId))];
  const names = new Map((await region.streetsByIds(ids)).map((row) => [row.id, row.name]));
  const same = parts.filter((part) => {
    const name = names.get(part.nameId);
    if (name === undefined || !sameStreet(name, street) || !sameKind(name, street)) return false;
    const near = nearestLine(aim, part.lines);
    return near !== null && near.distanceM <= CHAIN_LINE_REACH_M;
  });
  const wanted = streetKey(street).key;
  const exact = same.filter((part) => streetKey(names.get(part.nameId) as string).key === wanted);
  const pool = exact.length > 0 ? exact : same;
  const home = homeStreets(region, place, pool);
  return pool.filter((part) => home.has(part.nameId)).flatMap((part) => part.lines);
}

export function chooseEntrance(list: EntranceInfo[], door: number | null, chain: LngLat[][]): EntranceInfo | null {
  if (list.length === 0) return null;
  const written = pickEntrance(list, door);
  if (written) return written;
  const main = list.filter((e) => e.kind === 'main' || e.kind === 'yes');
  const pool = main.length > 0 ? main : list;
  if (pool.length === 1) return pool[0] as EntranceInfo;
  if (chain.length === 0) return null;
  const away = (e: EntranceInfo): number => nearestLine(e.point, chain)?.distanceM ?? Infinity;
  return [...pool].sort((a, b) => away(a) - away(b) || a.id - b.id)[0] as EntranceInfo;
}

export type EntranceFinder = (chain: LngLat[][]) => Promise<{ point: LngLat; ref?: string | null } | null>;

export async function arrivalOf(region: Region | null, place: Place, find?: EntranceFinder): Promise<Arrival> {
  const known = entranceOf(place);
  const chain = region ? await chainLines(region, place, known ?? place.coordinate) : [];
  const found = known || !find ? null : await find(chain);
  const entrance = known ?? found?.point;
  const ref = known ? place.unit?.entrance?.ref : found?.ref;
  return { door: place.coordinate, ...(entrance ? { entrance } : {}), ...(ref ? { entranceRef: ref } : {}), ...(chain.length > 0 ? { chain } : {}) };
}
