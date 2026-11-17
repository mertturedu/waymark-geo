import type { LngLat } from '../../src/core/geo/cells';
import { solveHeuristic } from '../../src/core/plan/heuristic';
import { planStops } from '../../src/core/plan/plan';
import type { Problem } from '../../src/core/plan/problem';
import type { PlanRequest } from '../../src/core/plan/types';
import { fakeDeps, type FakeOptions } from './fake-router';

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function problemOf(size: number, next: () => number, rules: Problem['rules'], back: boolean): Problem {
  const points = Array.from({ length: size + 1 }, () => [next() * 100, next() * 100] as const);
  const dist = (a: number, b: number): number => Math.round(Math.hypot(points[a]![0] - points[b]![0], points[a]![1] - points[b]![1]) * 10) + (a > b ? 3 : 0);
  return {
    size,
    from: Array.from({ length: size }, (_, i) => dist(0, i + 1)),
    between: Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => dist(i + 1, j + 1))),
    back: back ? Array.from({ length: size }, () => Math.round(next() * 500)) : null,
    rules,
  };
}

export function heuristicRuns(): (number[] | null)[] {
  const next = seeded(4242);
  const runs: (number[] | null)[] = [];
  const sizes = [13, 14, 16, 20, 25, 31, 40, 55, 70, 100];
  for (let round = 0; round < 30; round++) {
    const size = sizes[round % sizes.length] as number;
    const pins = new Map<number, number>();
    const before: [number, number][] = [];
    if (round % 3 === 1) {
      pins.set(2, 0);
      pins.set(size - 3, size - 1);
    }
    if (round % 3 === 2) {
      pins.set(4, 5);
      before.push([6, 7], [7, 8], [10, 9]);
    }
    const problem = problemOf(size, next, { size, pins, before }, round % 2 === 0);
    let t = 0;
    runs.push(solveHeuristic(problem, { now: () => (t += 1), ms: round % 5 === 0 ? 5 : 40, seed: 1 + round }));
  }
  return runs;
}

const spot = (i: number, spread: number): LngLat => [29 + (i % 13) * spread, 41 + Math.floor(i / 13) * spread * 0.9];

export type Scenario = { request: PlanRequest; options: FakeOptions };

export function scenarios(): Scenario[] {
  const next = seeded(777);
  const list: Scenario[] = [];
  const sizes = [0, 1, 2, 3, 5, 8, 11, 12, 13, 17, 24, 30, 49, 50, 51, 64, 80, 100];
  for (let round = 0; round < 90; round++) {
    const size = sizes[round % sizes.length] as number;
    const ids = Array.from({ length: size }, (_, i) => `s${i}`);
    const stops = ids.map((id, i) => ({ id, point: next() < 0.06 && i > 0 ? spot(i - 1, 0.011) : spot(i, 0.011), ...(next() < 0.2 ? { label: `L${i}` } : {}) }));
    const pick = (): string => ids[Math.floor(next() * size)] as string;
    const request: { -readonly [K in keyof PlanRequest]: PlanRequest[K] } = { stops };
    if (size > 0 && next() < 0.5) request.start = next() < 0.5 ? { stopId: pick() } : { point: [28.95, 40.95] };
    const endRoll = next();
    if (size > 0 && endRoll < 0.25) request.end = { kind: 'stop', stopId: pick() };
    else if (endRoll < 0.5) request.end = { kind: 'return' };
    else if (endRoll < 0.6) request.end = { kind: 'free' };
    if (size > 2 && next() < 0.5) request.pins = [{ stopId: pick(), position: Math.floor(next() * size) }];
    if (size > 3 && next() < 0.5) request.precedence = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ before: pick(), after: pick() })).filter((p) => p.before !== p.after);
    if (size > 1 && next() < 0.3) request.visited = [pick(), pick()];
    if (next() < 0.12) request.mode = 'keep';
    if (next() < 0.1) request.seed = Math.floor(next() * 1000);
    if (size > 12 || next() < 0.1) request.budgetMs = 2 + Math.floor(next() * 6);
    if (next() < 0.1) request.vehicle = 'car';
    const options: FakeOptions = {};
    if (round % 7 === 3) options.noRoad = (p) => Math.abs(p[0] - spot(2, 0.011)[0]) < 1e-9 && Math.abs(p[1] - spot(2, 0.011)[1]) < 1e-9;
    if (round % 9 === 4) options.island = (p) => p[0] > 29.07;
    if (round % 11 === 5) options.outside = (p) => p[1] > 41.04;
    if (round % 5 === 1) options.oneWay = true;
    list.push({ request, options });
  }
  return list;
}

export async function scenarioResults(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const { request, options } of scenarios()) {
    const base = fakeDeps(options);
    const deps = { ...base, now: () => 0 };
    const result = await planStops(request, deps);
    out.push(
      result.ok
        ? { order: result.order, legs: result.legs.map((l) => [l.from, l.to, l.distanceM, l.durationS]), d: result.totalDistanceM, t: result.totalDurationS, u: result.unreachable, m: result.merged, w: result.warnings, a: result.approximate, s: result.strategy, calls: [base.calls.matrix, base.calls.route] }
        : { code: result.code, detail: result.detail ?? null },
    );
  }
  return out;
}
