import { buildBaseGraph, graphOptionsFor, PACK_OPTIONS, parseRoadRows } from '../../pipeline/build/route-graph';
import { junctionPenalty, roadKmh } from '../../src/core/route/speeds';
import { deg, rows, way } from '../helpers/road-world';

const X = 29;
const Y = 41;

describe('parseRoadRows', () => {
  it('reads ways, blocked nodes and rules from the extractor lines', () => {
    const text = [
      JSON.stringify({ t: 'w', id: 1, cls: 'tertiary', o: 'f', s: '50', n: [1, 2], c: [[29, 41], [29.001, 41]] }),
      JSON.stringify({ t: 'w', id: 2, cls: 'ferry', o: '', f: true, d: 1800, n: [3, 4], c: [[29, 41.1], [29.1, 41.1]] }),
      JSON.stringify({ t: 'b', id: 2 }),
      JSON.stringify({ t: 'r', id: 9, kind: 'no', restriction: 'no_left_turn', from: 1, to: 2, via: [{ n: 2 }] }),
      '',
    ].join('\n');
    const got = parseRoadRows(text);
    expect(got.ways[0]).toEqual({ id: 1, cls: 'tertiary', oneway: 'f', speed: '50', ferry: false, duration: null, nodes: [1, 2], coords: [[29, 41], [29.001, 41]] });
    expect(got.ways[1]).toMatchObject({ ferry: true, duration: 1800, speed: null });
    expect([...got.blocked]).toEqual([2]);
    expect(got.rules).toEqual([{ id: 9, kind: 'no', restriction: 'no_left_turn', from: 1, to: 2, via: [{ n: 2 }] }]);
  });
});

describe('buildBaseGraph', () => {
  it('turns a straight way into one edge and keeps the bends as shape points', () => {
    const g = buildBaseGraph(rows([way(1, [[1, X, Y], [2, X + deg(50), Y], [3, X + deg(100), Y]])]), { ferries: false });
    expect(g.edges).toHaveLength(1);
    const [edge] = g.edges;
    expect(edge).toMatchObject({ way: 1, seq: 0, forward: true, backward: true });
    expect(edge?.shape).toHaveLength(2);
    expect(edge?.lengthM).toBeGreaterThan(75);
    expect(edge?.lengthM).toBeLessThan(85);
    expect(g.nodeOsm.filter((id) => id >= 0).sort()).toEqual([1, 3]);
  });

  it('splits at a shared node and numbers the pieces along each way', () => {
    const a = way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.002, Y]]);
    const b = way(2, [[4, X + 0.001, Y - 0.001], [2, X + 0.001, Y], [5, X + 0.001, Y + 0.001]]);
    const g = buildBaseGraph(rows([a, b]), { ferries: false });
    expect(g.edges).toHaveLength(4);
    expect(g.wayEdges.get(1)?.map((e) => g.edges[e]?.seq)).toEqual([0, 1]);
    expect(g.wayEdges.get(2)?.map((e) => g.edges[e]?.seq)).toEqual([0, 1]);
    const shared = g.nodeOsm.indexOf(2);
    expect(g.edges.filter((e) => e.tail === shared || e.head === shared)).toHaveLength(4);
  });

  it('honours one-way direction in both orientations', () => {
    const f = way(1, [[1, X, Y], [2, X + 0.001, Y]], { oneway: 'f' });
    const b = way(2, [[3, X, Y + 0.01], [4, X + 0.001, Y + 0.01]], { oneway: 'b' });
    const g = buildBaseGraph(rows([f, b]), { ferries: false });
    expect(g.edges.map((e) => [e.forward, e.backward])).toEqual([[true, false], [false, true]]);
    expect(g.edges[0]?.ds[1]).toBe(0);
    expect(g.edges[1]?.ds[0]).toBe(0);
  });

  it('cuts a way at a blocked node so nothing can pass', () => {
    const w = way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.002, Y]]);
    const g = buildBaseGraph(rows([w], [], [2]), { ferries: false });
    expect(g.edges).toHaveLength(2);
    expect(new Set([g.edges[0]?.head, g.edges[1]?.tail]).size).toBe(2);
    expect(g.nodeOsm.filter((id) => id === 2)).toHaveLength(0);
  });

  it('gives a blocked end node of a way its own dead end', () => {
    const a = way(1, [[1, X, Y], [2, X + 0.001, Y]]);
    const b = way(2, [[2, X + 0.001, Y], [3, X + 0.002, Y]]);
    const g = buildBaseGraph(rows([a, b], [], [2]), { ferries: false });
    expect(g.edges).toHaveLength(2);
    expect(g.edges[0]?.head).not.toBe(g.edges[1]?.tail);
  });

  it('keeps a loop with bends and drops one with no length', () => {
    const loop = way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.001, Y + 0.001], [1, X, Y]]);
    const nothing = way(2, [[5, X, Y + 1], [5, X, Y + 1]]);
    const g = buildBaseGraph(rows([loop, nothing]), { ferries: false });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.tail).toBe(g.edges[0]?.head);
    expect(g.edges[0]?.shape).toHaveLength(4);
  });

  it('keeps ferries only when asked and spreads a posted duration over the pieces', () => {
    const f = way(1, [[1, X, Y], [2, X + 0.05, Y], [3, X + 0.15, Y]], { cls: 'ferry', ferry: true, duration: 1000 });
    const road = way(2, [[2, X + 0.05, Y], [9, X + 0.05, Y + 0.01]]);
    expect(buildBaseGraph(rows([f]), { ferries: false }).edges).toHaveLength(0);
    const g = buildBaseGraph(rows([f, road]), { ferries: true });
    const pieces = g.edges.filter((e) => e.way === 1);
    expect(pieces).toHaveLength(2);
    const water = pieces.reduce((sum, e) => sum + e.ds[0], 0);
    expect(water).toBeGreaterThan(1000 * 10 + 3000 - 5);
    expect(water).toBeLessThan(1000 * 10 + 3000 + 5);
    expect(pieces.every((e) => Number.isInteger(e.ds[0]))).toBe(true);
    expect(pieces[0]?.ds[0]).toBeGreaterThan(3000);
    expect(pieces[1]?.ds[0]).toBeGreaterThan(pieces[0]?.ds[0] as number);
  });

  it('treats a node named by a rule as a junction even inside one way', () => {
    const w = way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.002, Y]]);
    const rule = { id: 1, kind: 'no' as const, restriction: 'no_u_turn', from: 1, to: 1, via: [{ n: 2 }] };
    expect(buildBaseGraph(rows([w], [rule]), { ferries: false }).edges).toHaveLength(2);
  });

  it('prices a street by length, class speed and a junction penalty only where roads meet', () => {
    const quietKmh = (lengthM: number): number => roadKmh('residential', null, { near: 0, wide: 0, lengthM });
    const a = way(1, [[1, X, Y], [2, X + deg(100) / Math.cos((Y * Math.PI) / 180), Y]]);
    const lone = buildBaseGraph(rows([a]), { ferries: false }).edges[0];
    expect(lone?.lengthM).toBeCloseTo(100, 0);
    expect(lone?.ds[0]).toBe(Math.round((lone?.lengthM as number / (quietKmh(lone?.lengthM as number) / 3.6)) * 10));
    const b = way(2, [[2, X + 0.0013, Y], [3, X + 0.0013, Y + 0.001]]);
    const c = way(3, [[2, X + 0.0013, Y], [4, X + 0.0013, Y - 0.001]]);
    const g = buildBaseGraph(rows([a, b, c]), { ferries: false });
    const toJunction = g.edges.find((e) => e.way === 1);
    const plain = Math.round(((toJunction?.lengthM as number) / (quietKmh(toJunction?.lengthM as number) / 3.6)) * 10);
    expect(toJunction?.ds[0]).toBe(plain + junctionPenalty('residential'));
    expect(toJunction?.ds[1]).toBe(plain);
    expect(toJunction?.travel).toEqual([plain, plain]);
  });

  it('slows main roads in dense towns', () => {
    const grid = [];
    for (let k = 0; k < 12; k++) {
      grid.push(way(100 + k, Array.from({ length: 12 }, (_, i) => [i * 100 + k, X + i * 0.0006, Y + k * 0.0006] as [number, number, number])));
      grid.push(way(200 + k, Array.from({ length: 12 }, (_, j) => [k * 100 + j, X + k * 0.0006, Y + j * 0.0006] as [number, number, number])));
    }
    const hub = way(1, [[505, X + 0.003, Y + 0.003], [606, X + 0.0036, Y + 0.0036]], { cls: 'primary' });
    const open = way(2, [[90001, X + 1, Y + 1], [90002, X + 1.001, Y + 1]], { cls: 'primary' });
    const g = buildBaseGraph(rows([...grid, hub, open]), { ferries: false });
    const city = g.edges.find((e) => e.way === 1) as (typeof g.edges)[number];
    const country = g.edges.find((e) => e.way === 2) as (typeof g.edges)[number];
    expect((city.ds[0] - junctionPenalty('primary')) / city.lengthM).toBeGreaterThan(country.ds[0] / country.lengthM);
  });

  it('in comparison mode leaves out junction penalties and the city speed model', () => {
    const grid = [];
    for (let k = 0; k < 12; k++) {
      grid.push(way(100 + k, Array.from({ length: 12 }, (_, i) => [i * 100 + k, X + i * 0.0006, Y + k * 0.0006] as [number, number, number])));
      grid.push(way(200 + k, Array.from({ length: 12 }, (_, j) => [k * 100 + j, X + k * 0.0006, Y + j * 0.0006] as [number, number, number])));
    }
    const hub = way(1, [[505, X + 0.003, Y + 0.003], [606, X + 0.0036, Y + 0.0036]], { cls: 'primary' });
    const normal = buildBaseGraph(rows([...grid, hub]), { ferries: false }).edges.find((e) => e.way === 1)!;
    const plain = buildBaseGraph(rows([...grid, hub]), { ferries: false, comparison: true }).edges.find((e) => e.way === 1)!;
    expect(plain.ds).toEqual(plain.travel);
    expect(normal.ds[0]).toBeGreaterThan(plain.ds[0]);
    expect(plain.ds[0]).toBe(Math.round((plain.lengthM / (60 / 3.6)) * 10));
  });

  it('drops loose scraps of road that are too small to matter and says how much', () => {
    const big = [
      way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.002, Y]]),
      way(2, [[2, X + 0.001, Y], [4, X + 0.001, Y + 0.001]]),
      way(3, [[3, X + 0.002, Y], [5, X + 0.002, Y + 0.001]]),
    ];
    const scrap = way(9, [[20, X + 1, Y + 1], [21, X + 1.001, Y + 1]]);
    const kept = buildBaseGraph(rows([...big, scrap]), { ferries: false, minComponent: 4 });
    expect(kept.edges.map((e) => e.way).sort()).toEqual([1, 1, 2, 3]);
    expect(kept.nodeOsm.includes(20)).toBe(false);
    expect(kept.dropped).toEqual({ nodes: 2, edges: 1, scraps: 1 });
    expect([...kept.wayEdges.keys()].sort()).toEqual([1, 2, 3]);
    kept.edges.forEach((e, i) => {
      expect(kept.wayEdges.get(e.way)).toContain(i);
      expect(e.tail).toBeLessThan(kept.nodeLon.length);
      expect(e.head).toBeLessThan(kept.nodeLon.length);
    });
    const all = buildBaseGraph(rows([...big, scrap]), { ferries: false, minComponent: 1 });
    expect(all.edges).toHaveLength(5);
    expect(all.dropped).toEqual({ nodes: 0, edges: 0, scraps: 0 });
  });

  it('keeps components of exactly the minimum size, keeps everything by default and drops the very small ones with the pack settings', () => {
    const three = way(1, [[1, X, Y], [2, X + 0.001, Y], [3, X + 0.002, Y]]);
    const split = rows([three, way(2, [[2, X + 0.001, Y], [4, X + 0.001, Y + 0.001]])]);
    expect(buildBaseGraph(split, { ferries: false, minComponent: 4 }).edges).toHaveLength(3);
    expect(buildBaseGraph(split, { ferries: false, minComponent: 5 }).edges).toHaveLength(0);
    expect(buildBaseGraph(split, { ferries: false }).edges).toHaveLength(3);
    expect(buildBaseGraph(split, { ...PACK_OPTIONS }).edges).toHaveLength(0);
  });

  it('drops a large loose network that lies wholly outside the province, and keeps one that touches it', () => {
    const street = (id: number, first: number, x: number, y: number): ReturnType<typeof way>[] => [
      way(id, [[first, x, y], [first + 1, x + 0.001, y], [first + 2, x + 0.002, y]]),
      way(id + 1, [[first + 1, x + 0.001, y], [first + 3, x + 0.001, y + 0.001]]),
    ];
    const inside = (lon: number): boolean => lon < 29.5;
    const near = street(1, 1, 29.4, 41);
    const far = street(10, 100, 30, 41);
    const straddling = street(20, 200, 29.499, 41.5);
    const kept = buildBaseGraph(rows([...near, ...far, ...straddling]), { ferries: false, minComponent: 4, inside });
    expect(new Set(kept.edges.map((e) => Math.floor(e.way / 10)))).toEqual(new Set([0, 2]));
    expect(kept.dropped).toEqual({ nodes: 4, edges: 3, scraps: 1 });
    const all = buildBaseGraph(rows([...near, ...far, ...straddling]), { ferries: false, minComponent: 4 });
    expect(all.edges).toHaveLength(9);
  });

  it('turns a plate and the borders into the inside test', () => {
    const borders = { provinceAt: (lon: number) => (lon < 29.5 ? '34' : '41') };
    const options = graphOptionsFor({ ferries: true, minComponent: 100, plate: '34' }, borders as never);
    expect(options.inside?.(29, 41)).toBe(true);
    expect(options.inside?.(30, 41)).toBe(false);
    expect(graphOptionsFor({ ferries: true, minComponent: 100 }, borders as never).inside).toBeUndefined();
  });
});
