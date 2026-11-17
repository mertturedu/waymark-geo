import { editDistance } from '../../src/core/address/names';
import { ringAround } from '../../src/core/geo/distance';
import { pointInRings, type Point, type Polygon } from '../../src/core/region/geom';
import { nameKey } from '../../src/core/text/fold';
import { cleanNeighbourhoodName } from './address-pack';
import { districtSidKey, osmSid, unitSid } from './sid';

export const OFFICIAL_DASK = 1;
export const OFFICIAL_TN = 2;

export const SOURCE_SETTLEMENT = 3;
export const SOURCE_EVIDENCE = 4;
export const SOURCE_OFFICIAL = 5;
export const SOURCE_OSM_ONLY = 6;

export const MIN_EXTENT_RADIUS_M = 120;
export const EXTENT_BUFFER_M = 40;
export const MAX_HULL_POINTS = 64;
const GRID_DEGREES = 0.02;
const VILLAGE_KINDS = new Set(['village', 'hamlet', 'town', 'city', 'suburb', 'neighbourhood', 'quarter']);
const OSM_ONLY_KINDS = new Set(['village', 'town', 'city']);

export type OfficialUnits = Record<string, Record<string, [string, number][]>>;
export type Seed = { id: string; kind: string; name: string; lon: number; lat: number };
export type DistrictInput = { id: string; name: string; rings: Polygon[] };
export type HoodInput = { id: string; district: string; name: string; rings: Polygon[] | null };

export type NationalUnit = {
  sid: string;
  district: string;
  name: string;
  source: number;
  official: number;
  center: Point | null;
  rings: Polygon[] | null;
  seed: string | null;
};
export type HoodMark = { hood: string; sid: string; official: number };
export type NationalRows = { units: NationalUnit[]; marks: HoodMark[]; stats: NationalStats };
export type NationalStats = {
  officialUnits: number;
  matchedHoods: number;
  fromSettlement: number;
  officialOnly: number;
  osmOnly: number;
  withExtent: number;
  unmatchedDistricts: string[];
};

const VILLAGE_TAIL = /\s*\((.*)\)\s*$/;

export function officialName(raw: string): string | null {
  const text = raw.trim();
  const inner = VILLAGE_TAIL.exec(text)?.[1]?.trim();
  const base = inner && /kendisi/i.test(text) ? inner : text.replace(VILLAGE_TAIL, '').trim();
  const clean = cleanNeighbourhoodName(base.replace(/\s+(Köyü|Köy)$/i, '').trim());
  if (clean === '' || /^(köyün\s+)?kendisi$/i.test(clean)) return null;
  return clean;
}

export const unitKeyOf = (name: string): string => nameKey(cleanNeighbourhoodName(name.replace(/\s+(Köyü|Köy)$/i, '')));

function closest(key: string, keys: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = 2;
  let tie = false;
  for (const other of keys) {
    if (other === key) return other;
    if (key.length < 5 || other.length < 5) continue;
    const d = editDistance(key, other, 1);
    if (d > 1) continue;
    if (d < bestDistance) {
      best = other;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance && best !== other) tie = true;
  }
  return tie ? null : best;
}

const boxOf = (rings: Polygon[]): [number, number, number, number] => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const polygon of rings) for (const [x, y] of polygon[0] ?? []) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

const inBox = (p: Point, b: [number, number, number, number]): boolean => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

const M_PER_DEGREE = 111_320;
const metresBetween = (a: Point, b: Point): number => {
  const dx = (a[0] - b[0]) * M_PER_DEGREE * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = (a[1] - b[1]) * M_PER_DEGREE;
  return Math.hypot(dx, dy);
};

export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]): Point[] => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as Point, out[out.length - 1] as Point, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function grownHull(points: Point[], seed: Point, bufferM = EXTENT_BUFFER_M, minRadiusM = MIN_EXTENT_RADIUS_M): Polygon[] {
  const base = [...points, ...ringAround(seed, minRadiusM).slice(0, -1)];
  const hull = convexHull(base);
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  const grown = hull.map((p): Point => {
    const away = metresBetween(p, [cx, cy]) || 1;
    const k = (away + bufferM) / away;
    return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k];
  });
  const step = Math.max(1, Math.ceil(grown.length / MAX_HULL_POINTS));
  const ring = grown.filter((_, i) => i % step === 0);
  return [[[...ring, ring[0] as Point]]];
}

type Cell = string;
const cellOfPoint = (p: Point): Cell => `${Math.floor(p[0] / GRID_DEGREES)}:${Math.floor(p[1] / GRID_DEGREES)}`;

export const SEED_REACH_M = 2500;

function nearestSeedGrid(seeds: { id: string; at: Point }[], reachM: number): Map<Cell, { id: string; at: Point }[]> {
  const grid = new Map<Cell, { id: string; at: Point }[]>();
  const spread = Math.ceil(reachM / (M_PER_DEGREE * GRID_DEGREES)) + 1;
  for (const seed of seeds) {
    const cx = Math.floor(seed.at[0] / GRID_DEGREES);
    const cy = Math.floor(seed.at[1] / GRID_DEGREES);
    for (let dx = -spread; dx <= spread; dx++) for (let dy = -spread; dy <= spread; dy++) {
      const key = `${cx + dx}:${cy + dy}`;
      const list = grid.get(key);
      if (list) list.push(seed);
      else grid.set(key, [seed]);
    }
  }
  return grid;
}

export function assignNearest(seeds: { id: string; at: Point }[], buildings: Iterable<Point>, taken: (p: Point) => boolean = () => false, reachM = SEED_REACH_M): Map<string, Point[]> {
  const grid = nearestSeedGrid(seeds, reachM);
  const out = new Map<string, Point[]>();
  for (const b of buildings) {
    if (taken(b)) continue;
    let best: string | null = null;
    let bestM = reachM;
    for (const seed of grid.get(cellOfPoint(b)) ?? []) {
      const d = metresBetween(b, seed.at);
      if (d < bestM) {
        bestM = d;
        best = seed.id;
      }
    }
    if (best === null) continue;
    const list = out.get(best);
    if (list) list.push(b);
    else out.set(best, [b]);
  }
  return out;
}

const districtKey = districtSidKey;

function pairDistricts(districts: DistrictInput[], official: string[]): { pairs: Map<string, string>; unmatched: string[] } {
  const pairs = new Map<string, string>();
  const freeOfficial = new Map(official.map((name) => [districtKey(name), name]));
  const freeDistricts: DistrictInput[] = [];
  for (const district of districts) {
    const key = districtKey(district.name);
    const hit = freeOfficial.get(key) ?? (() => {
      const near = closest(key, freeOfficial.keys());
      return near === null ? undefined : freeOfficial.get(near);
    })();
    if (hit !== undefined) {
      pairs.set(district.id, hit);
      freeOfficial.delete(districtKey(hit));
    } else freeDistricts.push(district);
  }
  const left = [...freeOfficial.values()];
  if (freeDistricts.length === 1 && left.length === 1) {
    pairs.set((freeDistricts[0] as DistrictInput).id, left[0] as string);
    return { pairs, unmatched: [] };
  }
  return { pairs, unmatched: left };
}

export function reconcilePlate(input: {
  plate: string;
  districts: DistrictInput[];
  hoods: HoodInput[];
  official: Record<string, [string, number][]>;
  seeds: Seed[];
  buildings?: Iterable<Point>;
}): NationalRows {
  const { plate } = input;
  const units: NationalUnit[] = [];
  const marks: HoodMark[] = [];
  const stats: NationalStats = { officialUnits: 0, matchedHoods: 0, fromSettlement: 0, officialOnly: 0, osmOnly: 0, withExtent: 0, unmatchedDistricts: [] };
  const { pairs, unmatched } = pairDistricts(input.districts, Object.keys(input.official));
  stats.unmatchedDistricts = unmatched;
  const hoodBoxes = input.hoods.filter((h) => h.rings && h.rings.length > 0).map((h) => ({ rings: h.rings as Polygon[], box: boxOf(h.rings as Polygon[]) }));
  const insidePolygon = (p: Point): boolean => hoodBoxes.some((h) => inBox(p, h.box) && pointInRings(p, h.rings));
  const seedDerived: { unit: NationalUnit; at: Point }[] = [];

  for (const district of input.districts) {
    const dKey = districtKey(district.name);
    const officialList = (pairs.has(district.id) ? input.official[pairs.get(district.id) as string] : undefined) ?? [];
    const hoods = input.hoods.filter((h) => h.district === district.id);
    const hoodKeys = new Map<string, HoodInput>();
    for (const hood of hoods) {
      const key = unitKeyOf(hood.name);
      if (key !== '' && !hoodKeys.has(key)) hoodKeys.set(key, hood);
    }
    const flags = new Map<string, { name: string; flags: number }>();
    for (const [raw, f] of officialList) {
      const name = officialName(raw);
      if (name === null) continue;
      const key = unitKeyOf(name);
      if (key === '') continue;
      const entry = flags.get(key) ?? { name, flags: 0 };
      entry.flags |= f;
      flags.set(key, entry);
    }
    stats.officialUnits += flags.size;

    const markOf = new Map<string, HoodMark>();
    const claimed = new Set<string>();
    for (const [key, entry] of flags) {
      const hit = closest(key, hoodKeys.keys());
      if (hit === null) continue;
      const hood = hoodKeys.get(hit) as HoodInput;
      const mark = markOf.get(hood.id) ?? { hood: hood.id, sid: osmSid(plate, hood.id), official: 0 };
      mark.official |= entry.flags;
      markOf.set(hood.id, mark);
      claimed.add(key);
    }
    stats.matchedHoods += claimed.size;
    for (const hood of hoods) if (!markOf.has(hood.id)) markOf.set(hood.id, { hood: hood.id, sid: osmSid(plate, hood.id), official: 0 });
    marks.push(...markOf.values());

    const seeds = input.seeds
      .filter((s) => VILLAGE_KINDS.has(s.kind) || s.kind === 'locality')
      .filter((s) => inBox([s.lon, s.lat], boxOf(district.rings)) && pointInRings([s.lon, s.lat], district.rings));
    const seedByKey = new Map<string, Seed>();
    for (const seed of seeds) {
      const key = unitKeyOf(seed.name);
      if (key === '') continue;
      const old = seedByKey.get(key);
      if (!old || (VILLAGE_KINDS.has(seed.kind) && !VILLAGE_KINDS.has(old.kind))) seedByKey.set(key, seed);
    }

    const made = new Set<string>();
    const add = (unit: NationalUnit): void => {
      const key = unitKeyOf(unit.name);
      if (made.has(key)) return;
      made.add(key);
      units.push(unit);
      if (unit.seed !== null && unit.center !== null) seedDerived.push({ unit, at: unit.center });
    };
    for (const [key, entry] of flags) {
      if (claimed.has(key)) continue;
      const seedKey = closest(key, seedByKey.keys());
      const seed = seedKey === null ? null : (seedByKey.get(seedKey) as Seed);
      if (seed && !hoodKeys.has(seedKey as string)) {
        stats.fromSettlement += 1;
        add({ sid: unitSid(plate, dKey, key), district: district.id, name: entry.name, source: SOURCE_SETTLEMENT, official: entry.flags, center: [seed.lon, seed.lat], rings: null, seed: seed.id });
        if (seedKey !== null) seedByKey.delete(seedKey);
      } else {
        stats.officialOnly += 1;
        add({ sid: unitSid(plate, dKey, key), district: district.id, name: entry.name, source: SOURCE_OFFICIAL, official: entry.flags, center: null, rings: null, seed: null });
      }
    }
    for (const [key, seed] of seedByKey) {
      if (hoodKeys.has(key) || closest(key, hoodKeys.keys()) !== null || flags.has(key)) continue;
      if (!OSM_ONLY_KINDS.has(seed.kind)) continue;
      stats.osmOnly += 1;
      add({ sid: unitSid(plate, dKey, key), district: district.id, name: seed.name, source: SOURCE_OSM_ONLY, official: 0, center: [seed.lon, seed.lat], rings: null, seed: seed.id });
    }
  }

  if (seedDerived.length > 0) {
    const assigned = assignNearest(seedDerived.map(({ unit, at }) => ({ id: unit.sid, at })), input.buildings ?? [], insidePolygon);
    for (const { unit, at } of seedDerived) {
      unit.rings = grownHull(assigned.get(unit.sid) ?? [], at);
      stats.withExtent += 1;
    }
  }
  return { units, marks, stats };
}
