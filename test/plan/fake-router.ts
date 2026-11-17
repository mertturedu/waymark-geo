import type { LngLat } from '../../src/core/geo/cells';
import type { StopState } from '../../src/core/route/router';
import type { PlanDeps } from '../../src/core/plan/types';

export const metres = (a: LngLat, b: LngLat): number => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540);

export type FakeOptions = { noRoad?: (p: LngLat) => boolean; island?: (p: LngLat) => boolean; outside?: (p: LngLat) => boolean; oneWay?: boolean };

export function fakeDeps(options: FakeOptions = {}): PlanDeps & { calls: { matrix: number; route: number } } {
  const calls = { matrix: 0, route: 0 };
  const seconds = (a: LngLat, b: LngLat): number => Math.round(metres(a, b) / 10) + (options.oneWay && a[0] > b[0] ? 7 : 0);
  return {
    calls,
    now: () => performance.now(),
    async matrix(points) {
      calls.matrix++;
      const stops: StopState[] = points.map((p) => (options.outside?.(p) ? { ok: false, reason: 'outside_region' } : options.noRoad?.(p) ? { ok: false, reason: 'no_road' } : { ok: true, point: p, warnings: [] }));
      const reach = (i: number, j: number): boolean => i === j || !!(options.island?.(points[i] as LngLat) === options.island?.(points[j] as LngLat));
      const durationS = points.map((a, i) => points.map((b, j) => (reach(i, j) ? seconds(a, b) : null)));
      const distanceM = points.map((a, i) => points.map((b, j) => (reach(i, j) ? Math.round(metres(a, b)) : null)));
      return { ok: true, region: '34', approximate: false, stops, durationS, distanceM };
    },
    async route(from, to) {
      calls.route++;
      return { ok: true, region: '34', distanceM: Math.round(metres(from, to)), durationS: seconds(from, to), approximate: false, geometry: [from, to], from, to, warnings: [] };
    },
  };
}
