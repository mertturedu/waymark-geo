import { bandSpans, delayDs, trafficLeg } from '../../src/core/route/traffic';
import { FLAG, readRoutePack } from '../../src/core/route/format';
import { createPlanner, type Planner, type RouteLeg } from '../../src/core/route/planner';
import type { Snap, SnapResult } from '../../src/core/route/snap';
import { slowdownOfIndex } from '../../src/core/traffic/model';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const X = 29;
const Y = 41;
const lonDeg = (meters: number): number => deg(meters) / Math.cos((41 * Math.PI) / 180);
const rush = Date.UTC(2026, 10, 9) + 5 * 3_600_000;

const points = Array.from({ length: 11 }, (_, i): Pt => [10 + i, X + lonDeg(2000 * i), Y]);
const pack = readRoutePack(buildRoutePack(rows(points.slice(1).map((point, i) => way(100 + i, [points[i] as Pt, point], { cls: 'motorway' }))), { ferries: false }).bytes);
const planner = createPlanner(pack);
const snapAt = (meters: number): Snap => {
  const got = planner.snap(X + lonDeg(meters), Y);
  if (!got.ok) throw new Error('no road');
  return got.snap;
};
const from = snapAt(200);
const to = snapAt(19800);
const base = planner.route(from, to) as RouteLeg;

const slowOf = (pa: number): number => slowdownOfIndex((pack.edges.flags[pa >> 1] as number) >> FLAG.classShift, rush, 1);

describe('delayDs', () => {
  it('uses the whole duration for a one-arc leg', () => {
    const slow = slowOf(base.arcs[0] as number);
    expect(slow).toBeGreaterThan(0);
    expect(delayDs(pack, [base.arcs[0] as number], 1000, rush, 1)).toBe(Math.round(1000 * (1 / (1 - slow) - 1)));
  });

  it('counts half of the first and last arc and all of the arcs between', () => {
    const arcs = [0, 2, 4, 6];
    const travel = (i: number): number => pack.edges.travel[arcs[i] as number] as number;
    const slow = slowOf(0);
    const share = 1 / (1 - slow) - 1;
    expect(delayDs(pack, arcs, 0, rush, 1)).toBe(Math.round((travel(0) * 0.5 + travel(1) + travel(2) + travel(3) * 0.5) * share));
  });

  it('is small at night and large in the rush hour', () => {
    const night = delayDs(pack, base.arcs, base.durationDs, Date.UTC(2026, 10, 9), 1);
    expect(night).toBeLessThan(base.durationDs * 0.05);
    expect(delayDs(pack, base.arcs, base.durationDs, rush, 1)).toBeGreaterThan(night * 5);
  });
});

describe('observed speeds', () => {
  it('colour a stretch by what the cell shows instead of the typical model', () => {
    const night = Date.UTC(2026, 10, 9);
    const stuck = (lat: number, lng: number): number | null => (lng > X + lonDeg(10000) ? 0.8 : lat > 0 ? 0 : null);
    const spans = bandSpans(pack, base.arcs, night, 1, stuck);
    expect(spans[0]?.band).toBe('smooth');
    expect(spans[spans.length - 1]?.band).toBe('jam');
    expect(bandSpans(pack, base.arcs, night, 1).every((span) => span.band === 'smooth')).toBe(true);
    expect(delayDs(pack, base.arcs, base.durationDs, night, 1, stuck)).toBeGreaterThan(delayDs(pack, base.arcs, base.durationDs, night, 1));
  });

  it('fall back to the model where the cell is unknown', () => {
    const none = (): number | null => null;
    expect(delayDs(pack, base.arcs, base.durationDs, rush, 1, none)).toBe(delayDs(pack, base.arcs, base.durationDs, rush, 1));
  });
});

describe('trafficLeg', () => {
  const stay = (leg: TrafficLegResult) => {
    expect(leg.detour).toBe(false);
    expect(leg.leg).toBe(base);
  };
  type TrafficLegResult = ReturnType<typeof trafficLeg>;

  it('keeps the road when it is quiet or short', () => {
    stay(trafficLeg(pack, planner, from, to, base, Date.UTC(2026, 10, 9), '34'));
    const short = { ...base, distanceM: 1500 };
    expect(trafficLeg(pack, planner, from, to, short, rush, '34').leg).toBe(short);
  });

  it('keeps the road when the two ends are the same point', () => {
    stay(trafficLeg(pack, planner, from, from, base, rush, '34'));
  });

  const fake = (route: Planner['route'], snap: Planner['snap'] = () => ({ ok: true, snap: from, farSnap: false })): Planner => ({ snap, route, matrix: planner.matrix });
  const legOf = (durationDs: number, distanceM: number, arcs: number[]): RouteLeg => ({ durationDs, distanceM, arcs, line: [29_000_000, 41_000_000, 29_100_000, 41_000_000] });

  it('skips via points that have no road or only a far one', () => {
    stay(trafficLeg(pack, fake(() => null, () => ({ ok: false, reason: 'no_road' } as SnapResult)), from, to, base, rush, '34'));
    stay(trafficLeg(pack, fake(() => null, () => ({ ok: true, snap: { ...from, distanceM: 900 }, farSnap: true })), from, to, base, rush, '34'));
  });

  it('skips a detour when either half cannot be routed', () => {
    stay(trafficLeg(pack, fake(() => null), from, to, base, rush, '34'));
    let calls = 0;
    stay(trafficLeg(pack, fake(() => (calls++ % 2 === 0 ? legOf(10, 100, [0]) : null)), from, to, base, rush, '34'));
  });

  it('skips a detour that turns straight back on itself', () => {
    let calls = 0;
    stay(trafficLeg(pack, fake(() => (calls++ % 2 === 0 ? legOf(10, 100, [4]) : legOf(10, 100, [5]))), from, to, base, rush, '34'));
  });

  it('skips a detour that is far longer or far slower than the road', () => {
    stay(trafficLeg(pack, fake(() => legOf(10, base.distanceM, [0])), from, to, base, rush, '34'));
    stay(trafficLeg(pack, fake(() => legOf(base.durationDs * 4, 100, [0])), from, to, base, rush, '34'));
  });

  it('takes a detour that clearly saves time, and later keeps only a better one', () => {
    let calls = 0;
    const order = [200, 200, 160, 160, 150, 150, 220, 220, 300, 300, 300, 300, 300, 300, 300, 300];
    const planner2 = fake(() => legOf((order[calls++] as number) / 2, base.distanceM / 2, calls % 2 === 1 ? [0] : [2]));
    const got = trafficLeg(pack, planner2, from, to, base, rush, '34');
    expect(got.detour).toBe(true);
    expect(got.freeFlowDs).toBe(150);
  });

  it('draws a detour from a base line that has no length', () => {
    const flat = { ...base, line: [X * 1e6, Y * 1e6, X * 1e6, Y * 1e6] };
    const got = trafficLeg(pack, fake(() => legOf(100, 5000, [0])), from, to, flat, rush, '34');
    expect(got.detour).toBe(true);
    expect(got.leg.distanceM).toBe(10_000);
  });
});
