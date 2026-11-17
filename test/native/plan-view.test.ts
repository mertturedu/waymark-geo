import { emptyPlan, markVisited, move, planFeatures, removeStop, rowsOf, togglePin, toRequest, withOrder, type PlanState } from '../../src/native/logic/plan-view';
import type { PlanResult } from '../../src/core/plan/types';

const base = (): PlanState => ({
  ...emptyPlan(),
  stops: [
    { id: 'a', point: [29, 41], label: 'Moda' },
    { id: 'b', point: [29.1, 41.1] },
    { id: 'c', point: [29.2, 41.2] },
  ],
});

const solved: PlanResult = {
  ok: true,
  order: ['c', 'a', 'b'],
  legs: [
    { from: null, to: 'a', distanceM: 1, durationS: 1, geometry: [[29.2, 41.2], [29, 41]] },
    { from: 'a', to: 'b', distanceM: 1, durationS: 1, geometry: [[29, 41], [29.1, 41.1]] },
  ],
  totalDistanceM: 2,
  totalDurationS: 2,
  unreachable: [{ id: 'b', reason: 'no_road' }],
  merged: [],
  warnings: [],
  approximate: false,
  strategy: 'exact',
};

describe('plan view logic', () => {
  it('moves an item and ignores impossible moves', () => {
    expect(move([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(move([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(move([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });

  it('pins a stop at its current slot and unpins it again', () => {
    const pinned = togglePin(base(), 'b');
    expect(pinned.pinned).toEqual({ b: 1 });
    expect(togglePin(pinned, 'b').pinned).toEqual({});
    expect(togglePin(base(), 'zzz')).toEqual(base());
  });

  it('builds a request without references to stops that are gone', () => {
    const state: PlanState = { ...base(), startId: 'a', end: { stopId: 'c' }, pinned: { b: 1, gone: 0 }, visited: ['gone'], links: [{ before: 'a', after: 'gone' }, { before: 'a', after: 'b' }] };
    const request = toRequest(state, 'optimize', 100);
    expect(request.start).toEqual({ stopId: 'a' });
    expect(request.end).toEqual({ kind: 'stop', stopId: 'c' });
    expect(request.pins).toEqual([{ stopId: 'b', position: 1 }]);
    expect(request.visited).toEqual([]);
    expect(request.precedence).toEqual([{ before: 'a', after: 'b' }]);
    expect(request.budgetMs).toBe(100);
  });

  it('uses a start point when no start stop is chosen', () => {
    expect(toRequest({ ...base(), startPoint: [28.9, 40.9] }, 'keep').start).toEqual({ point: [28.9, 40.9] });
  });

  it('removing a stop clears every rule that mentions it', () => {
    const state: PlanState = { ...base(), startId: 'a', end: { stopId: 'a' }, pinned: { a: 0 }, visited: ['a'], links: [{ before: 'a', after: 'b' }] };
    const after = removeStop(state, 'a');
    expect(after.stops.map((s) => s.id)).toEqual(['b', 'c']);
    expect(after).toMatchObject({ startId: null, end: 'free', pinned: {}, visited: [], links: [] });
  });

  it('puts the solved order first and keeps unlisted stops at the end', () => {
    expect(withOrder(base(), ['c', 'a']).stops.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('lists rows by the solved order and marks unreachable and pinned stops', () => {
    const rows = rowsOf(togglePin(base(), 'a'), solved);
    expect(rows.map((r) => [r.id, r.number])).toEqual([['c', 1], ['a', 2], ['b', 3]]);
    expect(rows.find((r) => r.id === 'b')?.unreachable).toBe('no_road');
    expect(rows.find((r) => r.id === 'a')?.pinned).toBe(true);
    expect(rowsOf(base(), null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('marks a visited stop once', () => {
    expect(markVisited(markVisited(base(), 'a'), 'a').visited).toEqual(['a']);
  });

  it('numbers the stops on the map and highlights the next leg', () => {
    const { legs, stops } = planFeatures(base(), solved, 1);
    expect(legs.features.map((f) => f.properties)).toEqual([{ leg: 0, next: 0, done: 1 }, { leg: 1, next: 1, done: 0 }]);
    expect(stops.features.map((f) => f.properties.label)).toEqual(['2', '3', '1']);
    expect(planFeatures(base(), null).legs.features).toEqual([]);
  });
});
