import type { LngLat } from '../geo/cells';
import { distanceM, lineLengthM } from '../geo/distance';
import { t } from '../i18n/messages';
import { formatDistance, type DirectionStep } from './directions';

export const OFF_ROUTE_M = 45;
export const ACCURACY_SLACK_M = 30;
export const ARRIVE_M = 30;
export const BACKTRACK_M = 60;
export const LOOKAHEAD_M = 400;
export const PASSED_M = 3;
export const CUES_M = [500, 150, 30] as const;

const RAD = Math.PI / 180;

export type RouteProgress = {
  snapped: LngLat;
  alongM: number;
  offsetM: number;
  offRoute: boolean;
  arrived: boolean;
  next: DirectionStep | null;
  after: DirectionStep | null;
  toNextM: number;
  remainingM: number;
  remainingS: number;
};

export type TrackInput = { geometry: LngLat[]; steps: DirectionStep[]; durationS: number; point: LngLat; accuracyM?: number | null; lastAlongM?: number };

export function headingTo(a: LngLat, b: LngLat): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const dy = b[1] - a[1];
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

function project(point: LngLat, line: LngLat[], fromM: number, toM: number): { point: LngLat; distanceM: number; alongM: number } | null {
  const scale = Math.cos(point[1] * RAD) * 111_195;
  let best: { point: LngLat; distanceM: number; alongM: number } | null = null;
  let walked = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as LngLat;
    const b = line[i + 1] as LngLat;
    const segment = distanceM(a, b);
    if (walked + segment >= fromM && walked <= toM) {
      const ax = (a[0] - point[0]) * scale;
      const ay = (a[1] - point[1]) * 111_195;
      const dx = (b[0] - a[0]) * scale;
      const dy = (b[1] - a[1]) * 111_195;
      const squared = dx * dx + dy * dy;
      const t = squared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / squared));
      const away = Math.hypot(ax + dx * t, ay + dy * t);
      if (!best || away < best.distanceM) best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], distanceM: away, alongM: walked + segment * t };
    }
    walked += segment;
  }
  return best;
}

export function trackRoute(input: TrackInput): RouteProgress {
  const { geometry, steps, point } = input;
  const totalM = lineLengthM(geometry);
  const slack = OFF_ROUTE_M + Math.min(Math.max(0, input.accuracyM ?? 0), ACCURACY_SLACK_M);
  const near = input.lastAlongM === undefined ? null : project(point, geometry, input.lastAlongM - BACKTRACK_M, input.lastAlongM + LOOKAHEAD_M);
  const whole = project(point, geometry, -Infinity, Infinity) ?? { point: geometry[0] ?? point, distanceM: 0, alongM: 0 };
  const hit = near && near.distanceM <= slack ? near : whole;
  const alongM = Math.min(totalM, hit.alongM);
  const remainingM = Math.max(0, totalM - alongM);
  const end = geometry[geometry.length - 1] ?? point;
  const arrived = remainingM <= ARRIVE_M || distanceM(point, end) <= ARRIVE_M;
  const index = steps.findIndex((step) => step.kind !== 'start' && step.atM > alongM + PASSED_M);
  const next = arrived ? null : (steps[index] ?? null);
  const after = next ? (steps[index + 1] ?? null) : null;
  return {
    snapped: hit.point,
    alongM,
    offsetM: hit.distanceM,
    offRoute: !arrived && hit.distanceM > slack,
    arrived,
    next,
    after,
    toNextM: next ? Math.max(0, next.atM - alongM) : 0,
    remainingM,
    remainingS: totalM > 0 ? (input.durationS * remainingM) / totalM : 0,
  };
}

export function dueCue(toNextM: number, spoken: number): number | null {
  let level: number | null = null;
  CUES_M.forEach((limit, index) => {
    if (toNextM <= limit && index > spoken) level = index;
  });
  return level;
}

export function cueText(step: DirectionStep, toNextM: number, level: number, lang: string): string {
  if (level >= CUES_M.length - 1) return step.action;
  const dist = formatDistance(toNextM, lang);
  if (step.kind === 'arrive') return t(lang, 'turn.arrive-in', { dist });
  return t(lang, 'turn.in', { dist, action: step.action });
}
