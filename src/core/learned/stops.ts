import { sideOfLine } from '../address/reverse-street';
import type { LngLat } from '../geo/cells';
import { distanceM, projectOnLine } from '../geo/distance';

export type TracePoint = { lng: number; lat: number; accuracyM: number; speed?: number | null; t: number };
export type Stop = { point: LngLat; seconds: number; samples: number; endsBefore: number; accuracyM: number };
export type OnSide = { line: readonly LngLat[]; side: 'left' | 'right' };

export type StopTarget = { points?: readonly LngLat[]; line?: readonly LngLat[]; side?: 'left' | 'right'; onSide?: OnSide; reachM?: number };

export const STOP_SPEED_MS = 1;
export const MIN_STOP_SECONDS = 3;
export const MIN_STOP_SAMPLES = 2;
export const MAX_TRACE_ACCURACY_M = 30;
export const MAX_TRACE_SECONDS = 600;
export const MAX_TRACE_POINTS = 30;
export const STOP_REACH_M = 60;
export const SAME_STOP_M = 12;
export const ENTRANCE_REACH_M = 15;
const MIN_STOP_ACCURACY_M = 3;
const LONG_STOP_BONUS_M_PER_S = 0.5;
const LONG_STOP_BONUS_MAX_M = 10;
const NO_REFERENCE_WINDOW_S = 60;

const usable = (p: TracePoint): boolean => Number.isFinite(p.lng) && Number.isFinite(p.lat) && Number.isFinite(p.t) && Number.isFinite(p.accuracyM) && p.accuracyM > 0 && p.accuracyM <= MAX_TRACE_ACCURACY_M;

function speeds(points: TracePoint[]): number[] {
  return points.map((p, i) => {
    if (typeof p.speed === 'number' && Number.isFinite(p.speed) && p.speed >= 0) return p.speed;
    const other = points[i + 1] ?? points[i - 1];
    if (!other) return Infinity;
    const seconds = Math.abs(p.t - other.t);
    return seconds > 0 ? distanceM([p.lng, p.lat], [other.lng, other.lat]) / seconds : Infinity;
  });
}

function centroidOf(run: TracePoint[]): { point: LngLat; accuracyM: number } {
  let w = 0;
  let x = 0;
  let y = 0;
  for (const p of run) {
    const weight = 1 / (p.accuracyM * p.accuracyM);
    w += weight;
    x += weight * p.lng;
    y += weight * p.lat;
  }
  return { point: [x / w, y / w], accuracyM: Math.max(MIN_STOP_ACCURACY_M, 1 / Math.sqrt(w)) };
}

function stopOf(run: TracePoint[]): Stop | null {
  const first = run[0] as TracePoint;
  const last = run[run.length - 1] as TracePoint;
  const seconds = first.t - last.t;
  if (run.length < MIN_STOP_SAMPLES || seconds < MIN_STOP_SECONDS) return null;
  return { ...centroidOf(run), seconds, samples: run.length, endsBefore: last.t };
}

export function findStops(trace: readonly TracePoint[]): Stop[] {
  const points = trace.filter((p) => usable(p) && p.t >= 0 && p.t <= MAX_TRACE_SECONDS).sort((a, b) => b.t - a.t);
  const speed = speeds(points);
  const stops: Stop[] = [];
  let run: TracePoint[] = [];
  const close = (): void => {
    const stop = run.length > 0 ? stopOf(run) : null;
    if (stop) stops.push(stop);
    run = [];
  };
  points.forEach((p, i) => {
    if ((speed[i] as number) >= STOP_SPEED_MS) return close();
    if (run.length > 0 && distanceM(centroidOf(run).point, [p.lng, p.lat]) > Math.max(SAME_STOP_M, 1.5 * p.accuracyM)) close();
    run.push(p);
  });
  close();
  return stops;
}

const nearestTo = (point: LngLat, target: StopTarget): number => {
  const references = target.points ?? [];
  let best = Infinity;
  for (const ref of references) best = Math.min(best, distanceM(point, ref));
  if (target.line && target.line.length >= 2) best = Math.min(best, projectOnLine(point, target.line as LngLat[]).distanceM);
  return best;
};

export function chooseStop(stops: readonly Stop[], target: StopTarget = {}): Stop | null {
  const hasReference = (target.points?.length ?? 0) > 0 || (target.line?.length ?? 0) >= 2;
  const reach = target.reachM ?? STOP_REACH_M;
  const sideOk = (stop: Stop): boolean => !target.side || !target.line || target.line.length < 2 || sideOfLine(stop.point, target.line as LngLat[]) === target.side;
  const sameSide = (stop: Stop): boolean => !target.onSide || target.onSide.line.length < 2 || sideOfLine(stop.point, target.onSide.line as LngLat[]) === target.onSide.side;
  const candidates = stops.filter((s) => sideOk(s) && sameSide(s) && (hasReference ? nearestTo(s.point, target) <= reach : s.endsBefore <= NO_REFERENCE_WINDOW_S));
  if (candidates.length === 0) return null;
  const score = (s: Stop): number => (hasReference ? nearestTo(s.point, target) - Math.min(LONG_STOP_BONUS_MAX_M, s.seconds * LONG_STOP_BONUS_M_PER_S) : s.endsBefore);
  return [...candidates].sort((a, b) => score(a) - score(b) || a.endsBefore - b.endsBefore || a.point[0] - b.point[0])[0] as Stop;
}

export const stopPoint = (trace: readonly TracePoint[], target: StopTarget = {}): Stop | null => chooseStop(findStops(trace), target);

export function deliveryStop(trace: readonly TracePoint[], intended: readonly LngLat[], confirm?: { lng: number; lat: number }, onSide?: OnSide): Stop | null {
  const pick = (target: StopTarget): Stop | null => (onSide ? stopPoint(trace, { ...target, onSide }) : null) ?? stopPoint(trace, target);
  const first = intended.length > 0 ? pick({ points: intended }) : null;
  if (first) return first;
  if (confirm) return pick({ points: [[confirm.lng, confirm.lat]] });
  return intended.length === 0 ? pick({}) : null;
}

export function entranceCandidate(stop: Stop, edgeDistanceM: number): LngLat | null {
  return edgeDistanceM <= ENTRANCE_REACH_M ? stop.point : null;
}
