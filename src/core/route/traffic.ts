import { regionBusyness, slowdownOfIndex } from '../traffic/model';
import { FLAG, type RoutePack } from './format';
import { join } from './line';
import type { Planner, RouteLeg } from './planner';
import type { Snap } from './snap';

const M_PER_DEGREE = 111_195;
const MICRO = 1e6;
const MIN_OFFSET_M = 500;
const MAX_OFFSET_M = 6000;
const OFFSET_SHARE = 0.2;
const MAX_DISTANCE_STRETCH = 1.4;
const MAX_TIME_STRETCH = 3;
const MIN_GAIN = 0.95;
const MAX_VIA_SNAP_M = 200;
const MIN_DELAY_SHARE = 0.12;

export type TrafficLeg = { leg: RouteLeg; freeFlowDs: number; delayDs: number; detour: boolean };

export function delayDs(pack: RoutePack, arcs: ReadonlyArray<number>, durationDs: number, at: number, busyness: number): number {
  const { flags, travel } = pack.edges;
  const last = arcs.length - 1;
  let delay = 0;
  for (let i = 0; i <= last; i++) {
    const pa = arcs[i] as number;
    const slow = slowdownOfIndex((flags[pa >> 1] as number) >> FLAG.classShift, at, busyness);
    const weight = arcs.length === 1 ? durationDs : i === 0 || i === last ? (travel[pa] as number) * 0.5 : (travel[pa] as number);
    delay += weight * (1 / (1 - slow) - 1);
  }
  return Math.round(delay);
}

function pointAt(line: number[], share: number): [number, number] {
  const lat0 = ((line[1] as number) / MICRO) * (Math.PI / 180);
  const mLng = M_PER_DEGREE * Math.cos(lat0);
  const lengths: number[] = [0];
  for (let i = 2; i + 1 < line.length; i += 2) lengths.push((lengths[lengths.length - 1] as number) + Math.hypot(((line[i] as number) - (line[i - 2] as number)) / MICRO * mLng, ((line[i + 1] as number) - (line[i - 1] as number)) / MICRO * M_PER_DEGREE));
  const target = (lengths[lengths.length - 1] as number) * share;
  let at = 1;
  while (at < lengths.length - 1 && (lengths[at] as number) < target) at++;
  const span = (lengths[at] as number) - (lengths[at - 1] as number);
  const t = span === 0 ? 0 : (target - (lengths[at - 1] as number)) / span;
  const x = (line[2 * (at - 1)] as number) + ((line[2 * at] as number) - (line[2 * (at - 1)] as number)) * t;
  const y = (line[2 * (at - 1) + 1] as number) + ((line[2 * at + 1] as number) - (line[2 * (at - 1) + 1] as number)) * t;
  return [x / MICRO, y / MICRO];
}

function viaPoints(base: RouteLeg, from: Snap, to: Snap): [number, number][] {
  const lat = (from.point[1] + to.point[1]) / 2;
  const mLng = M_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const dx = (to.point[0] - from.point[0]) * mLng;
  const dy = (to.point[1] - from.point[1]) * M_PER_DEGREE;
  const norm = Math.hypot(dx, dy);
  if (norm < 1) return [];
  const px = -dy / norm;
  const py = dx / norm;
  const reach = Math.min(MAX_OFFSET_M, Math.max(MIN_OFFSET_M, base.distanceM * OFFSET_SHARE));
  const plan: [number, number][] = [[0.5, -1], [0.5, 1], [0.5, -0.5], [0.5, 0.5], [0.3, -1], [0.3, 1], [0.7, -1], [0.7, 1]];
  return plan.map(([share, side]) => {
    const [x, y] = pointAt(base.line, share);
    return [x + (px * side * reach) / mLng, y + (py * side * reach) / M_PER_DEGREE];
  });
}

export function trafficLeg(pack: RoutePack, planner: Planner, from: Snap, to: Snap, base: RouteLeg, at: number, region: string): TrafficLeg {
  const busyness = regionBusyness(region);
  const baseDelay = delayDs(pack, base.arcs, base.durationDs, at, busyness);
  const stay: TrafficLeg = { leg: base, freeFlowDs: base.durationDs, delayDs: baseDelay, detour: false };
  const index = baseDelay / Math.max(1, base.durationDs);
  if (index < MIN_DELAY_SHARE || base.distanceM < 2000) return stay;
  let best = stay;
  for (const [lng, lat] of viaPoints(base, from, to)) {
    const via = planner.snap(lng, lat);
    if (!via.ok || via.snap.distanceM > MAX_VIA_SNAP_M) continue;
    const first = planner.route(from, via.snap);
    const second = planner.route(via.snap, to);
    if (first === null || second === null) continue;
    if (((first.arcs[first.arcs.length - 1] as number) ^ 1) === (second.arcs[0] as number)) continue;
    const durationDs = first.durationDs + second.durationDs;
    const distanceM = first.distanceM + second.distanceM;
    if (distanceM > base.distanceM * MAX_DISTANCE_STRETCH || durationDs > base.durationDs * MAX_TIME_STRETCH) continue;
    const arcs = [...first.arcs, ...second.arcs];
    const delay = delayDs(pack, arcs, durationDs, at, busyness);
    if (durationDs + delay < (best.freeFlowDs + best.delayDs) * (best === stay ? MIN_GAIN : 1)) best = { leg: { durationDs, distanceM, line: join([first.line, second.line]), arcs }, freeFlowDs: durationDs, delayDs: delay, detour: true };
  }
  return best;
}
