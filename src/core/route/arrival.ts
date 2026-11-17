import type { LngLat } from '../geo/cells';
import { distanceM, lineLengthM, pointAlong } from '../geo/distance';

export type Arrival = { door: LngLat; entrance?: LngLat; entranceRef?: string; chain?: ReadonlyArray<ReadonlyArray<LngLat>> };

export type ArrivalInfo = { side: 'left' | 'right' | null; offM: number; target: 'entrance' | 'door'; onChain: boolean; point: LngLat; entranceRef?: string };

export const SIDE_MIN_OFF_M = 5;
export const SIDE_MIN_LATERAL_M = 4;
const HEADING_BACK_M = 8;
const M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

export const arrivalTarget = (arrival: Arrival): LngLat => arrival.entrance ?? arrival.door;

export function sideOfArrival(geometry: readonly LngLat[], target: LngLat): { side: 'left' | 'right' | null; offM: number } {
  const end = geometry[geometry.length - 1];
  if (!end) return { side: null, offM: 0 };
  const offM = distanceM(end, target);
  const line = geometry as LngLat[];
  const total = lineLengthM(line);
  if (offM < SIDE_MIN_OFF_M || total < 1) return { side: null, offM };
  const back = pointAlong(line, Math.max(0, total - HEADING_BACK_M));
  const scale = Math.cos(end[1] * RAD);
  const hx = (end[0] - back[0]) * scale;
  const hy = end[1] - back[1];
  const vx = (target[0] - end[0]) * scale;
  const vy = target[1] - end[1];
  const lateralM = ((hx * vy - hy * vx) / Math.hypot(hx, hy)) * M_PER_DEGREE;
  if (!Number.isFinite(lateralM) || Math.abs(lateralM) < SIDE_MIN_LATERAL_M) return { side: null, offM };
  return { side: lateralM > 0 ? 'left' : 'right', offM };
}

export function arrivalInfo(geometry: readonly LngLat[], arrival: Arrival, onChain: boolean): ArrivalInfo {
  const target = arrivalTarget(arrival);
  const { side, offM } = sideOfArrival(geometry, target);
  const point = geometry[geometry.length - 1] ?? target;
  return { side, offM: Math.round(offM), target: arrival.entrance ? 'entrance' : 'door', onChain, point, ...(arrival.entranceRef ? { entranceRef: arrival.entranceRef } : {}) };
}
