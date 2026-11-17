import type { RoadClass } from '../../src/core/route/speeds';
import type { RoadWay } from './route-graph';

export const CELL_BITS = 15;
const LON_STEP = 360 / 2 ** CELL_BITS;
const LAT_STEP = 180 / 2 ** CELL_BITS;
const ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const KM_PER_DEGREE = 111.195;

const GROUPS = 8;
const LINK = 5;
const STREET = 6;
const SERVICE = 7;
const ROAD_GROUP: Partial<Record<RoadClass, number>> = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  motorway_link: LINK, trunk_link: LINK, primary_link: LINK, secondary_link: LINK, tertiary_link: LINK,
  unclassified: STREET, residential: STREET, living_street: STREET, service: SERVICE,
};
const PLACE_GROUPS = ['food', 'shop', 'public'];
const ONEWAY = GROUPS;
const JUNCTIONS = GROUPS + 1;
const MAIN_JUNCTIONS = GROUPS + 2;
const PLACES = GROUPS + 3;
export const CELL_VALUES = PLACES + PLACE_GROUPS.length + 1;
export const RINGS = [0, 1, 3, 8];
const PER_RING = GROUPS + 3 + 3 + PLACE_GROUPS.length + 2;
export const FEATURE_COUNT = RINGS.length * PER_RING;

export type CellGrid = Map<number, Float64Array>;

export const cellKey = (i: number, j: number): number => i * 2 ** CELL_BITS + j;
export const cellAt = (lon: number, lat: number): [number, number] => [Math.floor((lon + 180) / LON_STEP), Math.floor((lat + 90) / LAT_STEP)];
export const cellCentre = (i: number, j: number): [number, number] => [(i + 0.5) * LON_STEP - 180, (j + 0.5) * LAT_STEP - 90];

export function cellOfGeohash(cell: string): [number, number] {
  let i = 0;
  let j = 0;
  let even = true;
  for (const ch of cell) {
    const value = ALPHABET.indexOf(ch);
    for (let bit = 4; bit >= 0; bit--) {
      const side = (value >> bit) & 1;
      if (even) i = i * 2 + side;
      else j = j * 2 + side;
      even = !even;
    }
  }
  return [i, j];
}

export function geohashOfCell(i: number, j: number): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (let bit = CELL_BITS - 1; bit >= 0; bit--) {
    for (const side of [(i >> bit) & 1, (j >> bit) & 1]) {
      value = value * 2 + side;
      bits += 1;
      if (bits === 5) {
        out += ALPHABET[value];
        value = 0;
        bits = 0;
      }
    }
  }
  return out;
}

const slot = (grid: CellGrid, lon: number, lat: number): Float64Array => {
  const [i, j] = cellAt(lon, lat);
  const key = cellKey(i, j);
  const known = grid.get(key);
  if (known) return known;
  const made = new Float64Array(CELL_VALUES);
  grid.set(key, made);
  return made;
};

export function addRoads(grid: CellGrid, ways: ReadonlyArray<RoadWay>): void {
  const uses = new Map<number, number>();
  const where = new Map<number, [number, number]>();
  const best = new Map<number, number>();
  for (const way of ways) {
    const group = ROAD_GROUP[way.cls];
    if (way.ferry || group === undefined) continue;
    for (let k = 1; k < way.coords.length; k++) {
      const a = way.coords[k - 1] as [number, number];
      const b = way.coords[k] as [number, number];
      const km = Math.hypot((b[0] - a[0]) * KM_PER_DEGREE * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), (b[1] - a[1]) * KM_PER_DEGREE);
      const values = slot(grid, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      values[group] = (values[group] as number) + km;
      if (way.oneway !== '' && group <= LINK) values[ONEWAY] = (values[ONEWAY] as number) + km;
    }
    way.nodes.forEach((node, k) => {
      uses.set(node, (uses.get(node) ?? 0) + 1);
      where.set(node, way.coords[k] as [number, number]);
      best.set(node, Math.min(best.get(node) ?? GROUPS, group));
    });
  }
  for (const [node, count] of uses) {
    if (count < 2) continue;
    const at = where.get(node) as [number, number];
    const values = slot(grid, at[0], at[1]);
    values[JUNCTIONS] = (values[JUNCTIONS] as number) + 1;
    if ((best.get(node) as number) <= LINK) values[MAIN_JUNCTIONS] = (values[MAIN_JUNCTIONS] as number) + 1;
  }
}

export function addPlace(grid: CellGrid, lon: number, lat: number, group: string): void {
  const values = slot(grid, lon, lat);
  const index = PLACE_GROUPS.indexOf(group);
  const at = PLACES + (index < 0 ? PLACE_GROUPS.length : index);
  values[at] = (values[at] as number) + 1;
}

export function featuresOf(grid: CellGrid, i: number, j: number): Float64Array {
  const out = new Float64Array(FEATURE_COUNT);
  const sum = new Float64Array(CELL_VALUES);
  RINGS.forEach((reach, ring) => {
    sum.fill(0);
    for (let di = -reach; di <= reach; di++) {
      for (let dj = -reach; dj <= reach; dj++) {
        const values = grid.get(cellKey(i + di, j + dj));
        if (values) for (let k = 0; k < CELL_VALUES; k++) sum[k] = (sum[k] as number) + (values[k] as number);
      }
    }
    let at = ring * PER_RING;
    let main = 0;
    let total = 0;
    let places = 0;
    for (let k = 0; k < GROUPS; k++) {
      out[at++] = Math.log1p(sum[k] as number);
      total += sum[k] as number;
      if (k <= LINK) main += sum[k] as number;
    }
    out[at++] = Math.log1p(main);
    out[at++] = Math.log1p(total);
    out[at++] = main / (total + 1e-6);
    out[at++] = Math.log1p(sum[ONEWAY] as number);
    out[at++] = Math.log1p(sum[JUNCTIONS] as number);
    out[at++] = Math.log1p(sum[MAIN_JUNCTIONS] as number);
    for (let k = PLACES; k < CELL_VALUES; k++) {
      out[at++] = Math.log1p(sum[k] as number);
      places += sum[k] as number;
    }
    out[at++] = Math.log1p(places);
  });
  return out;
}

export const hasMainRoad = (values: Float64Array): boolean => {
  for (let k = 0; k <= LINK; k++) if ((values[k] as number) > 0) return true;
  return false;
};
