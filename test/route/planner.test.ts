import { sourceLabels, targetLabels } from '../../src/core/route/labels';
import { UNREACHABLE } from '../../src/core/route/matrix';
import { oracleWeights, plainGraph } from '../../src/core/route/oracle';
import { edgeLine } from '../../src/core/route/format';
import { pointAt } from '../../src/core/route/line';
import { createPlanner } from '../../src/core/route/planner';
import type { Snap } from '../../src/core/route/snap';
import { deg, rows, way, type Pt } from '../helpers/road-world';
import { makePack } from '../helpers/route-world';

const X = 29;
const Y = 41;
const lonDeg = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);

function onEdge(edge: number, offsetM: number): Snap {
  return { edge, offsetM, distanceM: 0, point: [0, 0] };
}

describe('a single straight road', () => {
  const road = (oneway: '' | 'f' | 'b' = ''): ReturnType<typeof makePack> => makePack(rows([way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]], { oneway })]));

  it('prices the stretch between two stops by the share of the road', () => {
    const { pack } = road();
    const travel = pack.edges.travel[0] as number;
    const length = pack.edges.length[0] as number;
    const planner = createPlanner(pack);
    const leg = planner.route(onEdge(0, length * 0.25), onEdge(0, length * 0.75));
    expect(leg?.durationDs).toBe(Math.round(travel * 0.5));
    expect(leg?.distanceM).toBe(Math.round(length * 0.5));
    expect(leg?.arcs).toEqual([0]);
    const back = planner.route(onEdge(0, length * 0.75), onEdge(0, length * 0.25));
    expect(back?.durationDs).toBe(Math.round((pack.edges.travel[1] as number) * 0.5));
    expect(back?.arcs).toEqual([1]);
  });

  it('refuses to go against a one-way road and says so with null', () => {
    const { pack } = road('f');
    const planner = createPlanner(pack);
    const length = pack.edges.length[0] as number;
    expect(planner.route(onEdge(0, length * 0.25), onEdge(0, length * 0.75))).not.toBeNull();
    expect(planner.route(onEdge(0, length * 0.75), onEdge(0, length * 0.25))).toBeNull();
    const table = planner.matrix([onEdge(0, length * 0.75)], [onEdge(0, length * 0.25), onEdge(0, length * 0.9)]);
    expect(Array.from(table.w)).toEqual([UNREACHABLE, Math.round((pack.edges.travel[0] as number) * 0.15)]);
  });

  it('gives a route from a point to itself zero time and distance', () => {
    const { pack } = road();
    const planner = createPlanner(pack);
    const leg = planner.route(onEdge(0, 300), onEdge(0, 300));
    expect(leg).toMatchObject({ durationDs: 0, distanceM: 0 });
  });

  it('starts and ends the drawn line on the stops', () => {
    const { pack } = road();
    const planner = createPlanner(pack);
    const a = planner.snap(X + lonDeg(200), Y + deg(10));
    const b = planner.snap(X + lonDeg(800), Y + deg(10));
    if (!a.ok || !b.ok) throw new Error('snap');
    const leg = planner.route(a.snap, b.snap);
    expect(leg?.line[0]).toBeCloseTo(X * 1e6 + lonDeg(200) * 1e6, -1);
    expect(leg?.line[leg.line.length - 2]).toBeCloseTo(X * 1e6 + lonDeg(800) * 1e6, -1);
  });
});

describe('stops on different roads', () => {
  const nodes = (i: number, j: number): Pt => [100 + i * 10 + j, X + lonDeg(i * 200), Y + deg(j * 200)];

  function city(): ReturnType<typeof makePack> {
    const ways = [];
    for (let j = 0; j < 5; j++) ways.push(way(100 + j, Array.from({ length: 5 }, (_, i) => nodes(i, j)), { oneway: j === 2 ? 'f' : '', cls: j === 4 ? 'primary' : 'residential' }));
    for (let i = 0; i < 5; i++) ways.push(way(200 + i, Array.from({ length: 5 }, (_, j) => nodes(i, j)), { oneway: i === 3 ? 'b' : '' }));
    return makePack(rows(ways));
  }

  it('is the same as plain Dijkstra on the pack for a spread of stops', () => {
    const { pack } = city();
    const planner = createPlanner(pack);
    const snaps: Snap[] = [];
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    while (snaps.length < 24) {
      const got = planner.snap(X + lonDeg(rnd() * 800), Y + deg(rnd() * 800));
      if (got.ok) snaps.push(got.snap);
    }
    const table = planner.matrix(snaps, snaps);
    const oracle = oracleWeights(plainGraph(pack.hierarchy), snaps.map((s) => sourceLabels(pack, s)), snaps.map((s) => targetLabels(pack, s)));
    for (let i = 0; i < snaps.length; i++) {
      for (let j = 0; j < snaps.length; j++) {
        const at = i * snaps.length + j;
        const a = snaps[i] as Snap;
        const b = snaps[j] as Snap;
        const same = a.edge === b.edge;
        if (!same) expect(table.w[at]).toBe(oracle[at]);
        else expect(table.w[at]).toBeLessThanOrEqual(oracle[at] as number);
        const leg = planner.route(a, b);
        expect(leg === null ? UNREACHABLE : leg.durationDs).toBe(table.w[at]);
      }
    }
  });

  it('draws a connected path that obeys the one-way streets', () => {
    const { pack } = city();
    const planner = createPlanner(pack);
    const a = planner.snap(X + lonDeg(700), Y + deg(400));
    const b = planner.snap(X + lonDeg(100), Y + deg(500));
    if (!a.ok || !b.ok) throw new Error('snap');
    const leg = planner.route(a.snap, b.snap);
    expect(leg).not.toBeNull();
    let node = -1;
    (leg?.arcs ?? []).forEach((pa, i) => {
      const edge = pa >> 1;
      const flags = pack.edges.flags[edge] as number;
      expect(flags & ((pa & 1) === 0 ? 1 : 2)).not.toBe(0);
      const from = (pa & 1) === 0 ? pack.edges.tail[edge] : pack.edges.head[edge];
      const to = (pa & 1) === 0 ? pack.edges.head[edge] : pack.edges.tail[edge];
      if (i > 0) expect(from).toBe(node);
      node = to as number;
    });
    expect(leg?.line.length).toBeGreaterThan(4);
  });
});

describe('route line and ties', () => {
  const X0 = 29;
  const Y0 = 41;
  const bend = (): ReturnType<typeof makePack> =>
    makePack(rows([
      way(1, [[1, X0, Y0], [5, X0 + lonDeg(400), Y0], [6, X0 + lonDeg(400), Y0 + deg(400)], [2, X0 + lonDeg(800), Y0 + deg(400)]]),
      way(2, [[2, X0 + lonDeg(800), Y0 + deg(400)], [3, X0 + lonDeg(800), Y0 + deg(900)]]),
    ]));

  it('draws a road driven backwards from the stop to the end of the road, not the other way', () => {
    const { pack } = bend();
    const planner = createPlanner(pack);
    const length = pack.edges.length[0] as number;
    const back = planner.route(onEdge(0, length * 0.6), onEdge(0, length * 0.2));
    expect(back?.arcs).toEqual([1]);
    const whole = edgeLine(pack, 0);
    const [startX, startY] = pointAt(whole, 0.6);
    const [endX, endY] = pointAt(whole, 0.2);
    expect(back?.line[0]).toBeCloseTo(startX, -1);
    expect(back?.line[1]).toBeCloseTo(startY, -1);
    expect(back?.line[back.line.length - 2]).toBeCloseTo(endX, -1);
    expect(back?.line[back.line.length - 1]).toBeCloseTo(endY, -1);
    const forward = planner.route(onEdge(0, length * 0.2), onEdge(0, length * 0.6));
    expect(forward?.line[1]).toBeLessThan(forward?.line[forward.line.length - 1] as number);
  });

  it('continues across roads: start part first, whole roads, end part last, in the right order', () => {
    const { pack } = bend();
    const planner = createPlanner(pack);
    const a = planner.route(onEdge(0, 100), onEdge(1, 100));
    const first = a?.line.slice(0, 2) as number[];
    const last = a?.line.slice(-2) as number[];
    expect(first[0]).toBeCloseTo(X0 * 1e6 + lonDeg(100) * 1e6, -1);
    expect(last[1]).toBeGreaterThan(Y0 * 1e6 + deg(400) * 1e6);
    const reverse = planner.route(onEdge(1, 100), onEdge(0, 100));
    expect(reverse?.line.slice(0, 2)[1]).toBeGreaterThan(Y0 * 1e6 + deg(400) * 1e6);
    expect(reverse?.line.slice(-2)[0]).toBeCloseTo(X0 * 1e6 + lonDeg(100) * 1e6, -1);
  });

  it('prefers the direct way over an equally cheap longer one', () => {
    const { pack } = bend();
    const planner = createPlanner(pack);
    const same = planner.route(onEdge(0, 300), onEdge(0, 300));
    expect(same?.arcs).toEqual([0]);
    expect(same?.durationDs).toBe(0);
  });

  it('treats a road with no length as a stop at its start', () => {
    const tiny = makePack(rows([way(1, [[1, X0, Y0], [2, X0 + lonDeg(0.2), Y0]]), way(2, [[2, X0 + lonDeg(0.2), Y0], [3, X0 + lonDeg(500), Y0]])]));
    const planner = createPlanner(tiny.pack);
    expect(tiny.pack.edges.length[0]).toBe(0);
    expect(planner.route(onEdge(0, 50), onEdge(1, 100))).not.toBeNull();
  });

  it('fills the table with the same direct costs as single routes, with equal costs going to the direct way', () => {
    const { pack } = bend();
    const planner = createPlanner(pack);
    const stops = [onEdge(0, 100), onEdge(0, 300), onEdge(1, 100)];
    const table = planner.matrix(stops, stops);
    stops.forEach((a, i) => stops.forEach((b, j) => expect(table.w[i * 3 + j]).toBe(planner.route(a, b)?.durationDs)));
    expect(table.w[1 * 3 + 1]).toBe(0);
    expect(table.len[1 * 3 + 1]).toBe(0);
  });
});
