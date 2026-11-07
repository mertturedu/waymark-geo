import type { LngLat } from '../geo/cells';
import type { Borders } from '../region/borders';
import { join } from './line';
import { UNREACHABLE } from './matrix';
import type { RoutePack } from './format';
import type { Planner } from './planner';
import type { Snap } from './snap';

export type ChainPlace = { region: string; planner: Planner; pack: RoutePack };

export type Crossing = { a: Snap; b: Snap };

export type ChainLeg = { region: string; durationDs: number; arcs: number[] };

export type ChainRoute = { durationDs: number; distanceM: number; line: number[]; regions: string[]; legs: ChainLeg[] };

const M_PER_DEGREE = 111_195;
const CELL_M = 400;
const WALK_M = 150;
const SPACING_M = 600;
const MAX_SAMPLES = 800;
const SAME_ROAD_M = 30;
const MAX_CROSSINGS = 80;
export const MAX_CHAIN = 8;
const BAND_M = 10_000;

const lngScale = (lat: number): number => Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);

function rings(borders: Borders, plate: string): LngLat[][] {
  return borders.provincePolygons(plate).flatMap((polygon) => polygon.map((ring) => ring as LngLat[]));
}

function* walk(ring: LngLat[], area: [number, number, number, number]): Generator<LngLat> {
  const [west, south, east, north] = area;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i] as LngLat;
    const b = ring[i + 1] as LngLat;
    if ((a[0] < west && b[0] < west) || (a[0] > east && b[0] > east) || (a[1] < south && b[1] < south) || (a[1] > north && b[1] > north)) continue;
    const length = Math.hypot((b[0] - a[0]) * M_PER_DEGREE * lngScale(a[1]), (b[1] - a[1]) * M_PER_DEGREE);
    const steps = Math.max(1, Math.ceil(length / WALK_M));
    for (let k = 0; k < steps; k++) yield [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
  }
}

export function borderSamples(borders: Borders, a: string, b: string): LngLat[] {
  const boundsA = borders.provinceBounds(a);
  const boundsB = borders.provinceBounds(b);
  if (!boundsA || !boundsB) return [];
  const lat0 = (boundsA[1] + boundsA[3]) / 2;
  const cellLat = CELL_M / M_PER_DEGREE;
  const cellLng = cellLat / lngScale(lat0);
  const key = (x: number, y: number): string => `${Math.floor(x / cellLng)},${Math.floor(y / cellLat)}`;
  const padLng = BAND_M / (M_PER_DEGREE * lngScale(lat0));
  const padLat = BAND_M / M_PER_DEGREE;
  const [west, south, east, north] = boundsA;
  const areaA: [number, number, number, number] = [west - padLng, south - padLat, east + padLng, north + padLat];
  const areaB: [number, number, number, number] = [boundsB[0] - padLng, boundsB[1] - padLat, boundsB[2] + padLng, boundsB[3] + padLat];
  if (areaA[2] < areaB[0] || areaA[0] > areaB[2] || areaA[3] < areaB[1] || areaA[1] > areaB[3]) return [];
  const grid = new Set<string>();
  for (const ring of rings(borders, b)) {
    for (const [x, y] of walk(ring, areaA)) {
      if (x < areaA[0] || x > areaA[2] || y < areaA[1] || y > areaA[3]) continue;
      grid.add(key(x, y));
    }
  }
  if (grid.size === 0) return [];
  const near = (x: number, y: number): boolean => {
    const cx = Math.floor(x / cellLng);
    const cy = Math.floor(y / cellLat);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (grid.has(`${cx + dx},${cy + dy}`)) return true;
    return false;
  };
  const out: LngLat[] = [];
  for (const ring of rings(borders, a)) {
    let last: LngLat | null = null;
    for (const point of walk(ring, areaB)) {
      if (!near(point[0], point[1])) continue;
      if (last !== null) {
        const dx = (point[0] - last[0]) * M_PER_DEGREE * lngScale(point[1]);
        const dy = (point[1] - last[1]) * M_PER_DEGREE;
        if (Math.hypot(dx, dy) < SPACING_M) continue;
      }
      last = point;
      out.push(point);
      if (out.length >= MAX_SAMPLES) return out;
    }
  }
  return out;
}

export function crossingsOf(from: ChainPlace, to: ChainPlace, samples: ReadonlyArray<LngLat>): Crossing[] {
  const seen = new Set<number>();
  const found: Crossing[] = [];
  for (const [lng, lat] of samples) {
    const first = from.planner.snap(lng, lat);
    if (!first.ok || seen.has(first.snap.edge)) continue;
    seen.add(first.snap.edge);
    const second = to.planner.snap(first.snap.point[0], first.snap.point[1]);
    if (!second.ok || second.snap.distanceM > SAME_ROAD_M) continue;
    found.push({ a: first.snap, b: second.snap });
  }
  if (found.length <= MAX_CROSSINGS) return found;
  const step = found.length / MAX_CROSSINGS;
  return Array.from({ length: MAX_CROSSINGS }, (_, i) => found[Math.floor(i * step)] as Crossing);
}

const centre = (borders: Borders, plate: string): LngLat | null => {
  const bounds = borders.provinceBounds(plate);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
};

const metres = (a: LngLat, b: LngLat): number => Math.hypot((a[0] - b[0]) * M_PER_DEGREE * lngScale((a[1] + b[1]) / 2), (a[1] - b[1]) * M_PER_DEGREE);

export function pickChain(borders: Borders, regions: ReadonlyArray<string>, start: string, end: string, adjacent: (a: string, b: string) => boolean): string[] | null {
  if (start === end) return [start];
  const cost = new Map<string, number>([[start, 0]]);
  const before = new Map<string, string>();
  const hops = new Map<string, number>([[start, 1]]);
  const open = new Set<string>([start]);
  const done = new Set<string>();
  const nodes = [...new Set([start, end, ...regions])];
  while (open.size > 0) {
    let u = '';
    let best = Infinity;
    for (const id of open) {
      const c = cost.get(id) as number;
      if (c < best) {
        best = c;
        u = id;
      }
    }
    open.delete(u);
    if (u === end) break;
    done.add(u);
    const here = centre(borders, u);
    if (!here || (hops.get(u) as number) >= MAX_CHAIN) continue;
    for (const v of nodes) {
      if (v === u || done.has(v)) continue;
      const there = centre(borders, v);
      if (!there || !adjacent(u, v)) continue;
      const next = best + metres(here, there);
      if (next < (cost.get(v) ?? Infinity)) {
        cost.set(v, next);
        before.set(v, u);
        hops.set(v, (hops.get(u) as number) + 1);
        open.add(v);
      }
    }
  }
  if (!before.has(end)) return null;
  const chain = [end];
  while (chain[0] !== start) chain.unshift(before.get(chain[0] as string) as string);
  return chain;
}

export async function solveChain(places: ReadonlyArray<ChainPlace>, from: Snap, to: Snap, crossings: ReadonlyArray<ReadonlyArray<Crossing>>, pause: () => Promise<void>): Promise<ChainRoute | null> {
  const last = places.length - 1;
  const ins = (i: number): Snap[] => (i === 0 ? [from] : (crossings[i - 1] as ReadonlyArray<Crossing>).map((c) => c.b));
  const outs = (i: number): Snap[] => (i === last ? [to] : (crossings[i] as ReadonlyArray<Crossing>).map((c) => c.a));
  let cost: number[] = [0];
  let length: number[] = [0];
  const pick: number[][] = [];
  for (let i = 0; i <= last; i++) {
    await pause();
    const starts = ins(i);
    const ends = outs(i);
    const table = (places[i] as ChainPlace).planner.matrix(starts, ends);
    const nextCost: number[] = Array.from({ length: ends.length }, () => Infinity);
    const nextLength: number[] = Array.from({ length: ends.length }, () => 0);
    const chosen: number[] = Array.from({ length: ends.length }, () => -1);
    for (let p = 0; p < starts.length; p++) {
      if (!Number.isFinite(cost[p])) continue;
      for (let j = 0; j < ends.length; j++) {
        const w = table.w[p * ends.length + j] as number;
        if (w === UNREACHABLE) continue;
        const total = (cost[p] as number) + w;
        if (total < (nextCost[j] as number)) {
          nextCost[j] = total;
          nextLength[j] = (length[p] as number) + (table.len[p * ends.length + j] as number);
          chosen[j] = p;
        }
      }
    }
    if (!nextCost.some(Number.isFinite)) return null;
    cost = nextCost;
    length = nextLength;
    pick.push(chosen);
  }
  const out: number[] = new Array<number>(places.length).fill(0);
  for (let i = last; i > 0; i--) out[i - 1] = (pick[i] as number[])[out[i] as number] as number;
  const lines: number[][] = [];
  const legs: ChainLeg[] = [];
  for (let i = 0; i <= last; i++) {
    await pause();
    const a = ins(i)[i === 0 ? 0 : (out[i - 1] as number)] as Snap;
    const b = outs(i)[out[i] as number] as Snap;
    const leg = (places[i] as ChainPlace).planner.route(a, b);
    if (leg === null) return null;
    lines.push(leg.line);
    legs.push({ region: (places[i] as ChainPlace).region, durationDs: leg.durationDs, arcs: leg.arcs });
  }
  return { durationDs: cost[0] as number, distanceM: length[0] as number, line: join(lines), regions: places.map((place) => place.region), legs };
}
