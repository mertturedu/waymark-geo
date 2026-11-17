import type { LngLat } from '../../src/core/geo/cells';
import { planStops } from '../../src/core/plan/plan';
import type { PlanDeps } from '../../src/core/plan/types';
import type { Arrival } from '../../src/core/route/arrival';
import { fakeDeps } from './fake-router';

const at = (n: number): LngLat => [29 + n * 0.01, 41];

describe('planStops with arrivals', () => {
  it('routes to each stop with its own arrival and keeps the leg arrival', async () => {
    const calls: { to: LngLat; arrive?: Arrival }[] = [];
    const base = fakeDeps();
    const arrive: Arrival = { door: at(2), entrance: at(2), chain: [[at(1), at(3)]] };
    const deps: PlanDeps = {
      ...base,
      route: async (from, to, options) => {
        calls.push({ to, ...(options?.arrive ? { arrive: options.arrive } : {}) });
        const got = await base.route(from, to);
        return got.ok ? { ...got, arrival: { side: 'left', offM: 12, target: 'entrance', onChain: true, point: to } } : got;
      },
    };
    const result = await planStops({ stops: [{ id: 'a', point: at(1) }, { id: 'b', point: at(2), arrive }], start: { point: at(0) }, mode: 'keep' }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.map((c) => c.arrive)).toEqual([undefined, arrive]);
    expect(result.legs.map((l) => l.arrival?.side)).toEqual(['left', 'left']);
  });

  it('gives the matrix the arrivals in point order', async () => {
    const seen: (readonly (Arrival | undefined)[] | undefined)[] = [];
    const base = fakeDeps();
    const deps: PlanDeps = { ...base, matrix: async (points, options) => (seen.push(options?.arrives), base.matrix(points, options)) };
    const arrive: Arrival = { door: at(2), chain: [[at(1), at(3)]] };
    await planStops({ stops: [{ id: 'a', point: at(1) }, { id: 'b', point: at(2), arrive }], start: { point: at(0) } }, deps);
    expect(seen[0]).toEqual([undefined, undefined, arrive]);
    seen.length = 0;
    await planStops({ stops: [{ id: 'a', point: at(1) }], start: { point: at(0) } }, deps);
    expect(seen[0]).toBeUndefined();
  });

  it('adds nothing to legs when the router gives no arrival', async () => {
    const result = await planStops({ stops: [{ id: 'a', point: at(1) }], start: { point: at(0) } }, fakeDeps());
    expect(result.ok && result.legs[0]).not.toHaveProperty('arrival');
  });
});
