import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { dijkstraTargets, fromEdges, makeGridGraph, matrix, runBench, type Graph } from '../../scripts/spikes/graph';

const referenceDistances = (g: Graph, source: number): number[] => {
  const dist = new Array<number>(g.n).fill(Infinity);
  const done = new Array<boolean>(g.n).fill(false);
  dist[source] = 0;
  for (let step = 0; step < g.n; step++) {
    let u = -1;
    for (let i = 0; i < g.n; i++) if (!done[i] && (u === -1 || (dist[i] as number) < (dist[u] as number))) u = i;
    if (u === -1 || dist[u] === Infinity) break;
    done[u] = true;
    for (let e = g.firstEdge[u] as number; e < (g.firstEdge[u + 1] as number); e++) {
      const v = g.target[e] as number;
      const candidate = (dist[u] as number) + (g.weight[e] as number);
      if (candidate < (dist[v] as number)) dist[v] = candidate;
    }
  }
  return dist;
};

const hashOf = (g: Graph): string => createHash('sha1').update(Buffer.from(g.firstEdge.buffer)).update(Buffer.from(g.target.buffer)).update(Buffer.from(g.weight.buffer)).digest('hex');

describe('fromEdges and dijkstraTargets', () => {
  const square = fromEdges(4, [[0, 1, 1], [1, 0, 1], [1, 2, 2], [2, 1, 2], [0, 3, 10], [3, 0, 10], [2, 3, 3], [3, 2, 3]]);

  it('finds shortest distances on a hand built graph', () => {
    expect(Array.from(dijkstraTargets(square, 0, Uint32Array.of(1, 2, 3)))).toEqual([1, 3, 6]);
  });

  it('is zero for the source itself', () => {
    expect(Array.from(dijkstraTargets(square, 2, Uint32Array.of(2)))).toEqual([0]);
  });

  it('respects one way edges', () => {
    const oneWay = fromEdges(3, [[0, 1, 5], [1, 2, 5]]);
    expect(Array.from(dijkstraTargets(oneWay, 0, Uint32Array.of(2)))).toEqual([10]);
    expect(Array.from(dijkstraTargets(oneWay, 2, Uint32Array.of(0)))).toEqual([Infinity]);
  });

  it('reports Infinity for a node nothing leads to', () => {
    const split = fromEdges(4, [[0, 1, 1], [1, 0, 1], [2, 3, 1], [3, 2, 1]]);
    expect(Array.from(dijkstraTargets(split, 0, Uint32Array.of(1, 3)))).toEqual([1, Infinity]);
  });

  it('keeps the order of the requested targets', () => {
    expect(Array.from(dijkstraTargets(square, 0, Uint32Array.of(3, 1)))).toEqual([6, 1]);
  });
});

describe('matrix', () => {
  it('is row major over sources and targets', () => {
    const g = makeGridGraph(6, 3);
    const sources = Uint32Array.of(0, 7, 20);
    const targets = Uint32Array.of(35, 1);
    const m = matrix(g, sources, targets);
    expect(m).toHaveLength(6);
    expect(m[2 * 2 + 1]).toBe((referenceDistances(g, 20)[1]) as number);
  });

  it('is symmetric on the symmetric grid', () => {
    const g = makeGridGraph(8, 11);
    const ids = Uint32Array.of(0, 9, 27, 63, 40);
    const m = matrix(g, ids, ids);
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) expect(m[i * ids.length + j]).toBe(m[j * ids.length + i]);
  });

  it('agrees with a plain reference on random grids', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), fc.integer({ min: 0, max: 1000 }), fc.array(fc.nat(), { minLength: 1, maxLength: 5 }), fc.array(fc.nat(), { minLength: 1, maxLength: 5 }), (side, seed, a, b) => {
        const g = makeGridGraph(side, seed);
        const sources = Uint32Array.from(a.map((x) => x % g.n));
        const targets = Uint32Array.from(b.map((x) => x % g.n));
        const m = matrix(g, sources, targets);
        sources.forEach((s, i) => {
          const ref = referenceDistances(g, s);
          targets.forEach((t, j) => expect(m[i * targets.length + j]).toBe(ref[t]));
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe('makeGridGraph', () => {
  it('builds four directed edges per interior node pair', () => {
    const g = makeGridGraph(20, 1);
    expect(g.n).toBe(400);
    expect(g.target).toHaveLength(4 * 20 * 19);
    expect(g.firstEdge).toHaveLength(401);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    expect(hashOf(makeGridGraph(30, 5))).toBe(hashOf(makeGridGraph(30, 5)));
    expect(hashOf(makeGridGraph(30, 5))).not.toBe(hashOf(makeGridGraph(30, 6)));
  });

  it('uses weights between 1 and 200', () => {
    const g = makeGridGraph(30, 2);
    expect(Math.min(...g.weight)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...g.weight)).toBeLessThanOrEqual(200);
  });
});

describe('runBench', () => {
  it('measures repeated matrices with the given clock and reports the median', () => {
    let tick = 0;
    const clock = () => (tick += 7);
    const result = runBench({ side: 12, seed: 1, points: 5, repetitions: 3, now: clock });
    expect(result.nodes).toBe(144);
    expect(result.timesMs).toEqual([7, 7, 7]);
    expect(result.medianMs).toBe(7);
    expect(result.checksum).toBe(runBench({ side: 12, seed: 1, points: 5, repetitions: 1, now: clock }).checksum);
  });
});
