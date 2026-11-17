import type { LngLat } from './cells';

const M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const dy = (b[1] - a[1]) * M_PER_DEGREE;
  const dx = (b[0] - a[0]) * M_PER_DEGREE * Math.cos(((a[1] + b[1]) / 2) * RAD);
  return Math.hypot(dx, dy);
}

export function lineLengthM(line: LngLat[]): number {
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) total += distanceM(line[i] as LngLat, line[i + 1] as LngLat);
  return total;
}

const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function pointAlong(line: LngLat[], alongM: number): LngLat {
  if (line.length === 0) throw new Error('empty line');
  if (alongM <= 0 || line.length === 1) return [line[0]![0], line[0]![1]];
  let walked = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as LngLat;
    const b = line[i + 1] as LngLat;
    const length = distanceM(a, b);
    if (alongM <= walked + length && length > 0) return lerp(a, b, (alongM - walked) / length);
    walked += length;
  }
  const last = line[line.length - 1] as LngLat;
  return [last[0], last[1]];
}

export function projectOnLine(point: LngLat, line: LngLat[]): { point: LngLat; distanceM: number; alongM: number } {
  if (line.length === 0) throw new Error('empty line');
  const scale = Math.cos(point[1] * RAD);
  const local = (p: LngLat): [number, number] => [(p[0] - point[0]) * scale * M_PER_DEGREE, (p[1] - point[1]) * M_PER_DEGREE];
  let best = { point: [line[0]![0], line[0]![1]] as LngLat, distanceM: Infinity, alongM: 0 };
  let walked = 0;
  for (let i = 0; i < line.length; i++) {
    const a = line[i] as LngLat;
    const b = (line[i + 1] ?? a) as LngLat;
    const [ax, ay] = local(a);
    const [bx, by] = local(b);
    const dx = bx - ax;
    const dy = by - ay;
    const squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / squared));
    const foot: LngLat = t <= 0 ? [a[0], a[1]] : t >= 1 ? [b[0], b[1]] : lerp(a, b, t);
    const away = Math.hypot(ax + dx * t, ay + dy * t);
    const segment = distanceM(a, b);
    if (away < best.distanceM) best = { point: foot, distanceM: away, alongM: walked + segment * t };
    walked += segment;
  }
  return best;
}

export function ringAround(center: LngLat, radiusM: number): LngLat[] {
  const dLat = radiusM / M_PER_DEGREE;
  const dLon = radiusM / (M_PER_DEGREE * Math.cos(center[1] * RAD));
  const steps = [-1, 0, 1];
  return steps.flatMap((x) => steps.map((y) => [center[0] + x * dLon, center[1] + y * dLat] as LngLat)).filter((p) => p[0] !== center[0] || p[1] !== center[1]);
}
