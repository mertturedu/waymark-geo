import type { LngLat } from '../../core/geo/cells';
import type { PlanRequest, PlanResult, StopInput } from '../../core/plan/types';

export type PlanState = {
  stops: StopInput[];
  startId: string | null;
  startPoint: LngLat | null;
  end: 'free' | 'return' | { stopId: string };
  pinned: Record<string, number>;
  visited: string[];
  links: { before: string; after: string }[];
};

export const emptyPlan = (): PlanState => ({ stops: [], startId: null, startPoint: null, end: 'free', pinned: {}, visited: [], links: [] });

export function toRequest(state: PlanState, mode: 'optimize' | 'keep', budgetMs?: number): PlanRequest {
  const alive = new Set(state.stops.map((s) => s.id));
  return {
    stops: state.stops,
    ...(state.startId && alive.has(state.startId) ? { start: { stopId: state.startId } } : state.startPoint ? { start: { point: state.startPoint } } : {}),
    end: state.end === 'free' ? { kind: 'free' } : state.end === 'return' ? { kind: 'return' } : { kind: 'stop', stopId: state.end.stopId },
    pins: Object.entries(state.pinned).filter(([id]) => alive.has(id)).map(([stopId, position]) => ({ stopId, position })),
    visited: state.visited.filter((id) => alive.has(id)),
    precedence: state.links.filter((l) => alive.has(l.before) && alive.has(l.after)),
    mode,
    ...(budgetMs !== undefined ? { budgetMs } : {}),
  };
}

export function move<T>(list: ReadonlyArray<T>, from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function withOrder(state: PlanState, order: ReadonlyArray<string>): PlanState {
  const byId = new Map(state.stops.map((s) => [s.id, s]));
  const placed = order.map((id) => byId.get(id)).filter((s): s is StopInput => s !== undefined);
  const left = state.stops.filter((s) => !order.includes(s.id));
  return { ...state, stops: [...placed, ...left] };
}

export function removeStop(state: PlanState, id: string): PlanState {
  const pinned = { ...state.pinned };
  delete pinned[id];
  return {
    ...state,
    stops: state.stops.filter((s) => s.id !== id),
    startId: state.startId === id ? null : state.startId,
    end: typeof state.end === 'object' && state.end.stopId === id ? 'free' : state.end,
    pinned,
    visited: state.visited.filter((v) => v !== id),
    links: state.links.filter((l) => l.before !== id && l.after !== id),
  };
}

export function togglePin(state: PlanState, id: string): PlanState {
  const slot = state.stops.findIndex((s) => s.id === id);
  if (slot < 0) return state;
  const { [id]: held, ...rest } = state.pinned;
  return held !== undefined ? { ...state, pinned: rest } : { ...state, pinned: { ...rest, [id]: slot } };
}

export function markVisited(state: PlanState, id: string): PlanState {
  return state.visited.includes(id) ? state : { ...state, visited: [...state.visited, id] };
}

export type PlanRow = { id: string; label: string; number: number | null; pinned: boolean; visited: boolean; unreachable: string | null; isStart: boolean; isEnd: boolean };

export function rowsOf(state: PlanState, result: PlanResult | null): PlanRow[] {
  const order = result && result.ok ? result.order : null;
  const failed = new Map(result && result.ok ? result.unreachable.map((u) => [u.id, u.reason]) : []);
  const numberOf = new Map((order ?? []).map((id, i) => [id, i + 1]));
  const rows = state.stops.map((s) => ({
    id: s.id,
    label: s.label ?? s.id,
    number: numberOf.get(s.id) ?? null,
    pinned: state.pinned[s.id] !== undefined,
    visited: state.visited.includes(s.id),
    unreachable: failed.get(s.id) ?? null,
    isStart: state.startId === s.id,
    isEnd: typeof state.end === 'object' && state.end.stopId === s.id,
  }));
  return order ? rows.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9)) : rows;
}

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Point'; coordinates: LngLat } };
export type PlanCollection = { type: 'FeatureCollection'; features: Feature[] };

export function planFeatures(state: PlanState, result: PlanResult | null, nextLeg = 0): { legs: PlanCollection; stops: PlanCollection } {
  const legs: Feature[] = [];
  const stops: Feature[] = [];
  const order = result && result.ok ? result.order : [];
  const numberOf = new Map(order.map((id, i) => [id, i + 1]));
  if (result && result.ok) result.legs.forEach((leg, i) => legs.push({ type: 'Feature', properties: { leg: i, next: i === nextLeg ? 1 : 0, done: i < nextLeg ? 1 : 0 }, geometry: { type: 'LineString', coordinates: leg.geometry } }));
  for (const stop of state.stops) {
    const number = numberOf.get(stop.id);
    stops.push({
      type: 'Feature',
      properties: { id: stop.id, label: number !== undefined ? String(number) : '', pinned: state.pinned[stop.id] !== undefined ? 1 : 0, visited: state.visited.includes(stop.id) ? 1 : 0, ordered: number !== undefined ? 1 : 0 },
      geometry: { type: 'Point', coordinates: stop.point },
    });
  }
  return { legs: { type: 'FeatureCollection', features: legs }, stops: { type: 'FeatureCollection', features: stops } };
}
