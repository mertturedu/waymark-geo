export type Point = [number, number];
export type Sample = { point: Point; heading: number; at: number };

const EARTH = 6371008.8;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (value: number): number => (value * 180) / Math.PI;

export function distance(a: Point, b: Point): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function heading(a: Point, b: Point): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function destination(from: Point, bearing: number, metres: number): Point {
  const d = metres / EARTH;
  const lat1 = rad(from[1]);
  const lng1 = rad(from[0]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad(bearing)));
  const lng2 = lng1 + Math.atan2(Math.sin(rad(bearing)) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lng2), deg(lat2)];
}

export const turnBetween = (from: number, to: number): number => ((((to - from) % 360) + 540) % 360) - 180;

export function easeBearing(current: number, target: number, maxTurn: number): number {
  const turn = turnBetween(current, target);
  const step = Math.max(-maxTurn, Math.min(maxTurn, turn));
  return (current + step + 360) % 360;
}

export function along(line: ReadonlyArray<Point>, stepM: number): Sample[] {
  const out: Sample[] = [];
  if (line.length < 2) return out;
  let travelled = 0;
  let carry = 0;
  out.push({ point: line[0]!, heading: heading(line[0]!, line[1]!), at: 0 });
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const length = distance(a, b);
    if (length === 0) continue;
    const bearing = heading(a, b);
    let offset = stepM - carry;
    while (offset <= length) {
      const ratio = offset / length;
      out.push({ point: [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio], heading: bearing, at: travelled + offset });
      offset += stepM;
    }
    carry = length - (offset - stepM);
    travelled += length;
  }
  const last = line[line.length - 1]!;
  const tail = out[out.length - 1]!;
  if (distance(tail.point, last) > 1) out.push({ point: last, heading: tail.heading, at: travelled });
  return out;
}

export function ring(center: Point, radiusM: number, count: number, start = 0): Point[] {
  return Array.from({ length: count }, (_, i) => destination(center, (start + (360 / count) * i) % 360, radiusM));
}

export const lineLength = (line: ReadonlyArray<Point>): number => line.slice(1).reduce((sum, point, i) => sum + distance(line[i]!, point), 0);

export function joinLegs(legs: ReadonlyArray<ReadonlyArray<Point>>): Point[] {
  const out: Point[] = [];
  for (const leg of legs) for (const point of leg) if (out.length === 0 || distance(out[out.length - 1]!, point) > 0.5) out.push(point);
  return out;
}
