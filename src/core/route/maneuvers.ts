import type { LngLat } from '../geo/cells';
import { distanceM, lineLengthM, pointAlong } from '../geo/distance';

export type ManeuverKind = 'start' | 'straight' | 'slight-left' | 'left' | 'sharp-left' | 'slight-right' | 'right' | 'sharp-right' | 'uturn' | 'roundabout' | 'arrive';

export type Maneuver = { kind: ManeuverKind; at: LngLat; atM: number; legM: number; angle?: number; exit?: number; street?: string };

export const SAMPLE_M = 5;
export const ARM_SAMPLES = 4;
export const TURN_MIN_DEG = 20;
export const MERGE_M = 30;
export const ROUNDABOUT_MIN_SWEEP = 150;
export const ROUNDABOUT_MAX_M = 220;
const TIGHT_DEG = 6;
const BEND_MAX_DEG = 45;
const RING_MIN_SAMPLES = 6;
const RAD = Math.PI / 180;

export const normalAngle = (angle: number): number => {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
};

function bearing(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

export function kindOfAngle(angle: number): ManeuverKind {
  const size = Math.abs(angle);
  const side = angle < 0 ? 'left' : 'right';
  if (size < TURN_MIN_DEG) return 'straight';
  if (size < 45) return `slight-${side}`;
  if (size < 135) return side;
  if (size < 165) return `sharp-${side}`;
  return 'uturn';
}

export function exitNumber(entryDeg: number, exitDeg: number): number {
  const raw = normalAngle(exitDeg - entryDeg);
  const a = raw === 180 ? -180 : raw;
  return Math.min(6, Math.max(1, Math.round((90 - a) / 90) + 1));
}

function resample(line: LngLat[]): { points: LngLat[]; step: number } {
  const total = lineLengthM(line);
  const count = Math.max(1, Math.round(total / SAMPLE_M));
  const step = total / count;
  const points: LngLat[] = [];
  for (let k = 0; k <= count; k++) points.push(pointAlong(line, k * step));
  return { points, step };
}

type Peak = { index: number; angle: number };

function turnPeaks(points: LngLat[]): Peak[] {
  const angles: number[] = points.map(() => 0);
  for (let k = ARM_SAMPLES; k + ARM_SAMPLES < points.length; k++) {
    angles[k] = normalAngle(bearing(points[k] as LngLat, points[k + ARM_SAMPLES] as LngLat) - bearing(points[k - ARM_SAMPLES] as LngLat, points[k] as LngLat));
  }
  const peaks: Peak[] = [];
  for (let k = ARM_SAMPLES; k + ARM_SAMPLES < points.length; k++) {
    const here = angles[k] as number;
    if (Math.abs(here) < TURN_MIN_DEG) continue;
    let top = true;
    for (let j = Math.max(0, k - ARM_SAMPLES); j <= Math.min(points.length - 1, k + ARM_SAMPLES); j++) {
      const other = angles[j] as number;
      if (Math.sign(other) === Math.sign(here) && (Math.abs(other) > Math.abs(here) || (Math.abs(other) === Math.abs(here) && j < k))) top = false;
    }
    if (top) peaks.push({ index: k, angle: here });
  }
  return peaks;
}

function mergePeaks(peaks: Peak[], step: number): Peak[] {
  const out: Peak[] = [];
  for (const peak of peaks) {
    const last = out[out.length - 1];
    if (last && Math.sign(last.angle) === Math.sign(peak.angle) && (peak.index - last.index) * step <= MERGE_M) {
      if (Math.abs(peak.angle) > Math.abs(last.angle)) out[out.length - 1] = peak;
    } else out.push(peak);
  }
  return out;
}

type Ring = { from: number; to: number; exit: number };

function roundabouts(points: LngLat[], step: number): Ring[] {
  const heading: number[] = [];
  for (let k = 0; k + 1 < points.length; k++) heading.push(bearing(points[k] as LngLat, points[k + 1] as LngLat));
  const change = (k: number): number => normalAngle((heading[k] as number) - (heading[k - 1] as number));
  const rings: Ring[] = [];
  let k = 1;
  while (k < heading.length) {
    if (change(k) > -TIGHT_DEG || change(k) < -BEND_MAX_DEG) {
      k += 1;
      continue;
    }
    let end = k;
    let sweep = 0;
    while (end < heading.length && change(end) <= -TIGHT_DEG && change(end) >= -BEND_MAX_DEG && (end - k) * step <= ROUNDABOUT_MAX_M) {
      sweep += change(end);
      end += 1;
    }
    if (-sweep >= ROUNDABOUT_MIN_SWEEP && end - k >= RING_MIN_SAMPLES) {
      const entry = heading[Math.max(0, k - 2)] as number;
      const leave = heading[Math.min(heading.length - 1, end + 1)] as number;
      rings.push({ from: k, to: end, exit: exitNumber(entry, leave) });
    }
    k = Math.max(end, k + 1);
  }
  return rings;
}

export function buildManeuvers(geometry: readonly LngLat[]): Maneuver[] {
  const line: LngLat[] = [];
  for (const point of geometry) {
    const last = line[line.length - 1];
    if (!last || distanceM(last, point) > 0.01) line.push(point);
  }
  if (line.length === 0) return [];
  const total = lineLengthM(line);
  const steps: Maneuver[] = [{ kind: 'start', at: line[0] as LngLat, atM: 0, legM: 0 }];
  if (line.length >= 2 && total > 2 * ARM_SAMPLES * SAMPLE_M) {
    const { points, step } = resample(line);
    const rings = roundabouts(points, step);
    const inRing = (index: number): boolean => rings.some((ring) => index >= ring.from - ARM_SAMPLES && index <= ring.to + ARM_SAMPLES);
    const items: Maneuver[] = [
      ...rings.map((ring) => ({ kind: 'roundabout' as const, at: points[Math.round((ring.from + ring.to) / 2)] as LngLat, atM: ring.from * step, legM: 0, exit: ring.exit })),
      ...mergePeaks(turnPeaks(points).filter((peak) => !inRing(peak.index)), step).map((peak) => ({ kind: kindOfAngle(peak.angle), at: points[peak.index] as LngLat, atM: peak.index * step, legM: 0, angle: Math.round(peak.angle) })),
    ].sort((a, b) => a.atM - b.atM);
    steps.push(...items.filter((item) => item.kind !== 'straight'));
  }
  steps.push({ kind: 'arrive', at: line[line.length - 1] as LngLat, atM: total, legM: 0 });
  let previous = 0;
  for (const item of steps) {
    item.legM = Math.max(0, item.atM - previous);
    item.atM = Math.round(item.atM);
    previous = item.atM + 0;
    item.legM = Math.round(item.legM);
  }
  return steps;
}
