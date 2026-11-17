import type { LngLat } from '../../src/core/geo/cells';
import { planStops } from '../../src/core/plan/plan';
import type { PlanRequest, StopInput } from '../../src/core/plan/types';
import { fakeDeps } from './fake-router';

const at = (n: number): LngLat => [29 + (n % 10) * 0.01, 41 + Math.floor(n / 10) * 0.01];
const stops = (count: number): StopInput[] => Array.from({ length: count }, (_, i) => ({ id: `s${i}`, point: at(i) }));
const ok = async (request: PlanRequest, deps = fakeDeps()) => {
  const result = await planStops(request, deps);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result;
};

describe('planStops edge cases', () => {
  it('handles no stops, with and without a start', async () => {
    expect(await ok({ stops: [] })).toMatchObject({ order: [], legs: [], totalDurationS: 0 });
    expect(await ok({ stops: [], start: { point: at(0) } })).toMatchObject({ order: [], legs: [] });
  });

  it('handles one stop', async () => {
    const free = await ok({ stops: stops(1) });
    expect(free.order).toEqual(['s0']);
    expect(free.legs).toEqual([]);
    const fromStart = await ok({ stops: stops(1), start: { point: at(5) } });
    expect(fromStart.legs).toHaveLength(1);
  });

  it('treats stops on one spot as a single visit that keeps every id', async () => {
    const same = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, point: at(3) }));
    const result = await ok({ stops: [...same, { id: 'far', point: at(40) }], start: { point: at(0) } });
    expect([...result.order].sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'far']);
    expect(result.merged).toHaveLength(4);
    expect(result.legs).toHaveLength(2);
  });

  it('plans when every stop is on one spot and when the start sits on a stop', async () => {
    const same = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, point: at(7) }));
    const all = await ok({ stops: same, start: { point: at(0) } });
    expect([...all.order].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(all.legs).toHaveLength(1);
    const onStop = await ok({ stops: stops(5), start: { point: at(2) } });
    expect(onStop.order[0]).toBe('s2');
    expect(onStop.legs.every((l) => l.durationS > 0)).toBe(true);
  });

  it('accepts 100 stops and refuses 101', async () => {
    expect((await planStops({ stops: stops(100), budgetMs: 50 }, fakeDeps())).ok).toBe(true);
    expect(await planStops({ stops: stops(101) }, fakeDeps())).toMatchObject({ ok: false, code: 'TOO_MANY_STOPS' });
  });

  it('puts the start first and closes the tour in return mode', async () => {
    const result = await ok({ stops: stops(6), start: { stopId: 's2' }, end: { kind: 'return' } });
    expect(result.order[0]).toBe('s2');
    expect(result.legs[result.legs.length - 1]).toMatchObject({ to: 's2' });
    expect(result.totalDurationS).toBe(result.legs.reduce((a, l) => a + l.durationS, 0));
  });

  it('keeps a fixed end last and a pinned stop in its slot', async () => {
    const result = await ok({ stops: stops(8), start: { point: [28.9, 40.9] }, end: { kind: 'stop', stopId: 's3' }, pins: [{ stopId: 's6', position: 1 }] });
    expect(result.order[result.order.length - 1]).toBe('s3');
    expect(result.order[1]).toBe('s6');
  });

  it('treats an end equal to the start as a return tour', async () => {
    const result = await ok({ stops: stops(5), start: { stopId: 's1' }, end: { kind: 'stop', stopId: 's1' } });
    expect(result.legs[result.legs.length - 1]).toMatchObject({ to: 's1' });
  });

  it('puts every pickup before its delivery', async () => {
    const request: PlanRequest = { stops: stops(10), precedence: [{ before: 's9', after: 's0' }, { before: 's8', after: 's1' }, { before: 's7', after: 's2' }] };
    const { order } = await ok(request);
    for (const p of request.precedence ?? []) expect(order.indexOf(p.before)).toBeLessThan(order.indexOf(p.after));
  });

  it('leaves visited stops out and starts from the current position', async () => {
    const result = await ok({ stops: stops(6), visited: ['s0', 's1'], start: { point: at(2) } });
    expect(result.order.sort()).toEqual(['s2', 's3', 's4', 's5']);
  });

  it('keeps the given order in keep mode and reports broken rules', async () => {
    const given = ['s4', 's2', 's5', 's0'];
    const result = await ok({ stops: given.map((id) => ({ id, point: at(Number(id.slice(1))) })), mode: 'keep', precedence: [{ before: 's0', after: 's4' }] });
    expect(result.order).toEqual(given);
    expect(result.warnings).toContainEqual({ code: 'order_breaks_rule', stopId: 's4' });
  });

  it('returns CONSTRAINT_CONFLICT for rules that cannot hold together', async () => {
    const cases: PlanRequest[] = [
      { stops: stops(4), pins: [{ stopId: 's0', position: 1 }, { stopId: 's1', position: 1 }] },
      { stops: stops(4), pins: [{ stopId: 's0', position: 9 }] },
      { stops: stops(4), precedence: [{ before: 's0', after: 's1' }, { before: 's1', after: 's0' }] },
      { stops: stops(4), pins: [{ stopId: 's0', position: 3 }, { stopId: 's1', position: 0 }], precedence: [{ before: 's0', after: 's1' }] },
      { stops: stops(4), start: { stopId: 's0' }, pins: [{ stopId: 's0', position: 2 }] },
    ];
    for (const request of cases) expect(await planStops(request, fakeDeps())).toMatchObject({ ok: false, code: 'CONSTRAINT_CONFLICT' });
  });

  it('rejects malformed requests', async () => {
    const cases = [
      { stops: [{ id: '', point: at(0) }] },
      { stops: [{ id: 'a', point: at(0) }, { id: 'a', point: at(1) }] },
      { stops: [{ id: 'a', point: [NaN, 1] as LngLat }] },
      { stops: stops(2), pins: [{ stopId: 'zzz', position: 0 }] },
      { stops: stops(2), end: { kind: 'return' as const } },
    ];
    for (const request of cases) expect(await planStops(request as PlanRequest, fakeDeps())).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('never drops a stop silently: unreachable ones come back with the reason', async () => {
    const deps = fakeDeps({ noRoad: (p) => p[0] === at(2)[0] && p[1] === at(2)[1], outside: (p) => p[1] > 41.045, island: (p) => p[0] === at(4)[0] && p[1] === at(4)[1] });
    const request: PlanRequest = { stops: [...stops(6), { id: 'north', point: [29.02, 41.06] }], start: { point: at(0) } };
    const result = await ok(request, deps);
    const accounted = [...result.order, ...result.unreachable.map((u) => u.id)];
    expect(accounted.sort()).toEqual(request.stops.map((s) => s.id).sort());
    expect(result.unreachable.find((u) => u.id === 's2')?.reason).toBe('no_road');
    expect(result.unreachable.find((u) => u.id === 'north')?.reason).toBe('outside_region');
    expect(result.unreachable.find((u) => u.id === 's4')?.reason).toBe('disconnected');
  });

  it('is deterministic and independent of the input order', async () => {
    const list = stops(30);
    const shuffled = [...list].reverse();
    const a = await ok({ stops: list, start: { point: at(0) }, budgetMs: 150 });
    const b = await ok({ stops: list, start: { point: at(0) }, budgetMs: 150 });
    const c = await ok({ stops: shuffled, start: { point: at(0) }, budgetMs: 150 });
    expect(b.order).toEqual(a.order);
    expect(Math.abs(c.totalDurationS - a.totalDurationS)).toBeLessThanOrEqual(a.totalDurationS * 0.02);
  });
});
