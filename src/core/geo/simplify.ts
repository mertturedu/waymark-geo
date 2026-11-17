import type { LngLat } from './cells';

export type Bbox = [number, number, number, number];

const M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

export function bboxOf(parts: ReadonlyArray<ReadonlyArray<LngLat>>): Bbox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const part of parts) {
    for (const [lng, lat] of part) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return west > east ? null : [west, south, east, north];
}

export const inBbox = (box: Bbox, point: LngLat): boolean => point[0] >= box[0] && point[0] <= box[2] && point[1] >= box[1] && point[1] <= box[3];

export function simplifyLine(line: ReadonlyArray<LngLat>, toleranceM: number): LngLat[] {
  if (line.length <= 2) return line.map((p) => [p[0], p[1]] as LngLat);
  const scale = Math.cos((line[0]![1] as number) * RAD) * M_PER_DEGREE;
  const x = (p: LngLat): number => p[0] * scale;
  const y = (p: LngLat): number => p[1] * M_PER_DEGREE;
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = true;
  keep[line.length - 1] = true;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    const ax = x(line[from] as LngLat);
    const ay = y(line[from] as LngLat);
    const dx = x(line[to] as LngLat) - ax;
    const dy = y(line[to] as LngLat) - ay;
    const squared = dx * dx + dy * dy;
    let far = -1;
    let farM = toleranceM;
    for (let i = from + 1; i < to; i++) {
      const px = x(line[i] as LngLat) - ax;
      const py = y(line[i] as LngLat) - ay;
      const t = squared === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / squared));
      const away = Math.hypot(px - dx * t, py - dy * t);
      if (away > farM) {
        farM = away;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([from, far], [far, to]);
    }
  }
  return line.filter((_, i) => keep[i]).map((p) => [p[0], p[1]] as LngLat);
}

export const pointCount = (parts: ReadonlyArray<ReadonlyArray<LngLat>>): number => parts.reduce((total, part) => total + part.length, 0);

export function simplifyWithin(parts: ReadonlyArray<ReadonlyArray<LngLat>>, toleranceM: number, maxPoints: number): LngLat[][] {
  let tolerance = toleranceM;
  let out = parts.map((part) => simplifyLine(part, tolerance));
  while (pointCount(out) > maxPoints && tolerance < 100_000) {
    tolerance *= 2;
    out = parts.map((part) => simplifyLine(part, tolerance));
  }
  return out.filter((part) => part.length >= 2);
}

export function simplifyRing(ring: ReadonlyArray<LngLat>, toleranceM: number): LngLat[] {
  if (ring.length < 5) return ring.map((p) => [p[0], p[1]] as LngLat);
  const closed = ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
  const open = closed ? ring.slice(0, -1) : ring;
  let far = 1;
  let farM = -1;
  for (let i = 1; i < open.length; i++) {
    const away = Math.hypot(open[i]![0] - open[0]![0], open[i]![1] - open[0]![1]);
    if (away > farM) {
      farM = away;
      far = i;
    }
  }
  const first = simplifyLine(open.slice(0, far + 1), toleranceM);
  const second = simplifyLine([...open.slice(far), open[0] as LngLat], toleranceM);
  const out = [...first, ...second.slice(1)];
  return out.length >= 4 ? out : ring.map((p) => [p[0], p[1]] as LngLat);
}

export function simplifyPolygons(polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<LngLat>>>, toleranceM: number, maxPoints: number): LngLat[][][] {
  let tolerance = toleranceM;
  let out = polygons.map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance)));
  while (pointCount(out.flat()) > maxPoints && tolerance < 100_000) {
    tolerance *= 2;
    out = polygons.map((polygon) => polygon.map((ring) => simplifyRing(ring, tolerance)));
  }
  return out;
}
