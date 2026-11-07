import { borderSamples, crossingsOf, pickChain, solveChain, type ChainPlace, type Crossing } from '../../src/core/route/chain';
import { readRoutePack } from '../../src/core/route/format';
import { createPlanner, type Planner } from '../../src/core/route/planner';
import { UNREACHABLE } from '../../src/core/route/matrix';
import type { Snap } from '../../src/core/route/snap';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { deg, rows, way, type Pt } from '../helpers/road-world';

type Ring = [number, number][][][];
const square = (west: number, south: number, east: number, north: number): Ring => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
const bordersOf = (list: [string, Ring][]) => createBorders(encodeBorders(list.map(([plate, rings]) => ({ plate, rings }))));

describe('borderSamples', () => {
  const grid = bordersOf([
    ['16', square(28.5, 40.5, 29.5, 41.5)],
    ['17', square(28.5, 41.5, 29.5, 42.5)],
    ['18', square(28.5, 39.5, 29.5, 40.5)],
    ['19', square(29.5, 40.5, 30.5, 41.5)],
    ['20', square(27.5, 40.5, 28.5, 41.5)],
    ['21', square(35, 40.5, 36, 41.5)],
  ]);

  it.each(['17', '18', '19', '20'])('finds the shared edge with the neighbour %s, from either side', (other) => {
    expect(borderSamples(grid, '16', other).length).toBeGreaterThan(20);
    expect(borderSamples(grid, other, '16').length).toBeGreaterThan(20);
  });

  it('returns nothing for a province without borders', () => {
    expect(borderSamples(grid, '16', '99')).toEqual([]);
    expect(borderSamples(grid, '99', '16')).toEqual([]);
  });

  it('returns nothing when the provinces are far apart', () => {
    expect(borderSamples(grid, '16', '21')).toEqual([]);
  });

  it('returns nothing when the other province has no edge near this one', () => {
    const nested = bordersOf([
      ['16', square(28.9, 40.9, 29.1, 41.1)],
      ['17', square(20, 30, 40, 50)],
    ]);
    expect(borderSamples(nested, '16', '17')).toEqual([]);
  });

  it('stops at the sample cap on a very long shared border', () => {
    const long = bordersOf([
      ['16', square(20, 40, 30, 41)],
      ['17', square(20, 41, 30, 42)],
    ]);
    expect(borderSamples(long, '16', '17')).toHaveLength(800);
  });
});

describe('pickChain', () => {
  const line = Array.from({ length: 10 }, (_, i) => [String(10 + i), square(i, 40, i + 1, 41)] as [string, Ring]);
  const strip = bordersOf(line);
  const ids = line.map(([id]) => id);
  const near = (a: string, b: string): boolean => Math.abs(Number(a) - Number(b)) === 1;

  it('returns the start alone when it is also the end', () => {
    expect(pickChain(strip, ids, '12', '12', near)).toEqual(['12']);
  });

  it('walks the provinces between the two ends in order', () => {
    expect(pickChain(strip, ids, '12', '15', near)).toEqual(['12', '13', '14', '15']);
    expect(pickChain(strip, ids, '15', '12', near)).toEqual(['15', '14', '13', '12']);
  });

  it('chains at most eight provinces', () => {
    expect(pickChain(strip, ids, '10', '17', near)).toHaveLength(8);
    expect(pickChain(strip, ids, '10', '18', near)).toBeNull();
    expect(pickChain(strip, ids, '10', '19', near)).toBeNull();
  });

  it('skips provinces that have no borders', () => {
    expect(pickChain(strip, [...ids, '99'], '12', '14', () => true)).toEqual(['12', '14']);
    expect(pickChain(strip, ids, '99', '14', () => true)).toBeNull();
  });

  it('returns null when nothing connects the ends', () => {
    expect(pickChain(strip, ids, '12', '15', () => false)).toBeNull();
  });
});

describe('crossingsOf and solveChain', () => {
  const Y = 41;
  const pt = (id: number, x: number, y: number): Pt => [id, x, y];
  const roadPack = (first: number, ids: number, from: number, to: number) => {
    const points = Array.from({ length: 11 }, (_, i) => pt(ids + i, from + ((to - from) * i) / 10, Y));
    return readRoutePack(buildRoutePack(rows(points.slice(1).map((point, i) => way(first + i, [points[i] as Pt, point]))), { ferries: false }).bytes);
  };
  const left = roadPack(100, 1000, 29.0, 29.6);
  const right = roadPack(200, 2000, 29.4, 30.0);
  const place = (region: string, pack: typeof left): ChainPlace => ({ region, pack, planner: createPlanner(pack) });
  const a = place('34', left);
  const b = place('41', right);

  it('pairs roads that meet at the border and skips samples with no road or no match', () => {
    const found = crossingsOf(a, b, [[29.5, 10], [29.5, Y], [29.5, Y + deg(2)], [29.2, Y]]);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.length).toBeLessThanOrEqual(2);
    for (const crossing of found) expect(crossing.a.edge).not.toBeUndefined();
  });

  it('keeps one crossing per road piece', () => {
    const found = crossingsOf(a, b, [[29.5, Y], [29.5 + 1e-6, Y], [29.5 - 1e-6, Y]]);
    expect(found).toHaveLength(1);
  });

  it('thins the list when there are too many crossings', () => {
    const samples: [number, number][] = Array.from({ length: 200 }, (_, i) => [29.4 + i * 0.001, Y]);
    expect(crossingsOf(a, b, samples).length).toBeLessThanOrEqual(80);
  });

  const snap = (edge: number, x: number): Snap => ({ edge, offsetM: 0, distanceM: 0, point: [x, Y] });
  const stub = (matrix: Planner['matrix'], route: Planner['route']): Planner => ({ snap: () => ({ ok: false, reason: 'no_road' }), matrix, route });
  const leg = { durationDs: 10, distanceM: 100, line: [29_000_000, 41_000_000, 29_100_000, 41_000_000], arcs: [0] };
  const matrixOf = (w: number[], len: number[] = w.map(() => 50)) => ({ w: Uint32Array.from(w), len: Uint32Array.from(len) });
  const placeOf = (region: string, planner: Planner): ChainPlace => ({ region, planner, pack: left });
  const crossingList = (n: number): Crossing[] => Array.from({ length: n }, (_, i) => ({ a: snap(i, 29.5), b: snap(10 + i, 29.5) }));

  it('picks the crossing with the cheapest total and joins the legs', async () => {
    const first = stub(() => matrixOf([100, 40]), () => leg);
    const second = stub(() => matrixOf([30, 70]), () => leg);
    const got = await solveChain([placeOf('34', first), placeOf('41', second)], snap(1, 29.1), snap(2, 29.9), [crossingList(2)], async () => undefined);
    expect(got?.durationDs).toBe(110);
    expect(got?.distanceM).toBe(100);
    expect(got?.regions).toEqual(['34', '41']);
    expect(got?.legs.map((item) => item.region)).toEqual(['34', '41']);
  });

  it('ignores a crossing that the first province cannot reach', async () => {
    const first = stub(() => matrixOf([UNREACHABLE, 40]), () => leg);
    const second = stub((from) => matrixOf(from.length === 2 ? [25, 10] : [1]), () => leg);
    const got = await solveChain([placeOf('34', first), placeOf('41', second)], snap(1, 29.1), snap(2, 29.9), [crossingList(2)], async () => undefined);
    expect(got?.durationDs).toBe(50);
  });

  it('fails when no crossing connects the provinces', async () => {
    const first = stub(() => matrixOf([UNREACHABLE, UNREACHABLE]), () => leg);
    const second = stub(() => matrixOf([1, 1]), () => leg);
    const got = await solveChain([placeOf('34', first), placeOf('41', second)], snap(1, 29.1), snap(2, 29.9), [crossingList(2)], async () => undefined);
    expect(got).toBeNull();
  });

  it('fails when a leg of the chosen way cannot be drawn', async () => {
    const first = stub(() => matrixOf([10]), () => leg);
    const second = stub(() => matrixOf([10]), () => null);
    const got = await solveChain([placeOf('34', first), placeOf('41', second)], snap(1, 29.1), snap(2, 29.9), [crossingList(1)], async () => undefined);
    expect(got).toBeNull();
  });
});
