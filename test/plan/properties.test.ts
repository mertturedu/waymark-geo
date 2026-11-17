import type { LngLat } from '../../src/core/geo/cells';
import { planStops } from '../../src/core/plan/plan';
import type { PlanRequest } from '../../src/core/plan/types';
import { fakeDeps } from './fake-router';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

const POINTS: LngLat[] = Array.from({ length: 12 }, (_, i) => [29 + (i % 4) * 0.013, 41 + Math.floor(i / 4) * 0.011]);

type Case = { request: PlanRequest; ids: string[] };

function randomCase(next: () => number): Case {
  const size = Math.floor(next() * 8);
  const ids = Array.from({ length: size }, (_, i) => `x${i}`);
  const stops = ids.map((id, i) => ({ id, point: POINTS[i] as LngLat }));
  const request: { -readonly [K in keyof PlanRequest]: PlanRequest[K] } = { stops };
  const pick = (): string => ids[Math.floor(next() * size)] as string;
  if (size > 0 && next() < 0.5) request.start = next() < 0.5 ? { stopId: pick() } : { point: [28.95, 40.95] };
  const endRoll = next();
  if (size > 0 && endRoll < 0.25) request.end = { kind: 'stop', stopId: pick() };
  else if (request.start && endRoll < 0.5) request.end = { kind: 'return' };
  if (size > 0 && next() < 0.5) request.pins = Array.from({ length: 1 + Math.floor(next() * 2) }, () => ({ stopId: pick(), position: Math.floor(next() * (size + 1)) }));
  if (size > 1 && next() < 0.5) request.precedence = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ before: pick(), after: pick() })).filter((p) => p.before !== p.after);
  if (size > 0 && next() < 0.25) request.visited = [pick()];
  if (next() < 0.1) request.mode = 'keep';
  return { request, ids };
}

function satisfiable(request: PlanRequest): boolean {
  const visited = new Set(request.visited ?? []);
  const startId = request.start && 'stopId' in request.start ? request.start.stopId : null;
  const startIsStop = startId !== null && !visited.has(startId);
  let endStop = request.end?.kind === 'stop' ? request.end.stopId : null;
  if (endStop !== null && endStop === startId) endStop = null;
  if (endStop !== null && visited.has(endStop)) return false;
  const rest = request.stops.map((s) => s.id).filter((id) => !visited.has(id) && !(startIsStop && id === startId));
  const offset = startIsStop ? 1 : 0;
  return permutations(rest).some((order) => {
    const full = startIsStop ? [startId as string, ...order] : order;
    const at = new Map(full.map((id, i) => [id, i]));
    for (const pin of request.pins ?? []) {
      if (visited.has(pin.stopId)) continue;
      const position = at.get(pin.stopId);
      if (pin.stopId === startId && startIsStop) {
        if (pin.position !== 0) return false;
        continue;
      }
      if (position === undefined || position !== pin.position) return false;
    }
    for (const link of request.precedence ?? []) {
      const a = at.get(link.before);
      const b = at.get(link.after);
      if (visited.has(link.after) && !visited.has(link.before)) return false;
      if (a !== undefined && b !== undefined && a >= b) return false;
    }
    if (endStop !== null && at.get(endStop) !== full.length - 1) return false;
    void offset;
    return true;
  });
}

describe('plan properties over random requests', () => {
  it('keeps every rule and never invents a conflict (10,000 requests)', async () => {
    const next = seeded(4242);
    const deps = fakeDeps();
    let solved = 0;
    let conflicts = 0;
    for (let round = 0; round < 10000; round++) {
      const { request } = randomCase(next);
      const startId = request.start && 'stopId' in request.start ? request.start.stopId : null;
      const result = await planStops(request, deps);
      if (request.mode === 'keep') {
        if (result.ok) {
          const kept = request.stops.map((s) => s.id).filter((id) => !(request.visited ?? []).includes(id));
          const startFirst = startId !== null && !(request.visited ?? []).includes(startId) ? [startId, ...kept.filter((id) => id !== startId)] : kept;
          expect(result.order).toEqual(startFirst);
        }
        continue;
      }
      const possible = satisfiable(request);
      if (!possible) {
        conflicts++;
        expect(result).toMatchObject({ ok: false, code: 'CONSTRAINT_CONFLICT' });
        continue;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      solved++;
      const visited = new Set(request.visited ?? []);
      const expected = request.stops.map((s) => s.id).filter((id) => !visited.has(id));
      expect([...result.order].sort()).toEqual([...expected].sort());
      for (const id of result.order) expect(visited.has(id)).toBe(false);
      if (startId !== null && !visited.has(startId)) expect(result.order[0]).toBe(startId);
      const endStop = request.end?.kind === 'stop' && request.end.stopId !== startId ? request.end.stopId : null;
      if (endStop !== null) expect(result.order[result.order.length - 1]).toBe(endStop);
      for (const pin of request.pins ?? []) if (!visited.has(pin.stopId)) expect(result.order.indexOf(pin.stopId)).toBe(pin.position);
      for (const link of request.precedence ?? []) if (!visited.has(link.before) && !visited.has(link.after)) expect(result.order.indexOf(link.before)).toBeLessThan(result.order.indexOf(link.after));
      expect(result.totalDurationS).toBe(result.legs.reduce((a, l) => a + l.durationS, 0));
      expect(result.totalDistanceM).toBe(result.legs.reduce((a, l) => a + l.distanceM, 0));
      const returns = request.end?.kind === 'return' || (request.end?.kind === 'stop' && request.end.stopId === startId);
      if (returns && request.start && result.order.length > 0 && result.legs.length > 0) {
        const last = result.legs[result.legs.length - 1] as { to: string | null };
        expect(last.to).toBe(startId !== null && !visited.has(startId) ? startId : null);
      }
    }
    expect(solved).toBeGreaterThan(1500);
    expect(conflicts).toBeGreaterThan(300);
  }, 120000);
});
