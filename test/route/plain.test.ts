import fc from 'fast-check';

import { createHeap } from '../../src/core/route/heap';
import { buildCsr, dijkstra } from '../../src/core/route/plain';

describe('createHeap', () => {
  it('pops entries by ascending key and reports emptiness', () => {
    const heap = createHeap();
    expect(heap.size()).toBe(0);
    for (const [node, key] of [[1, 5], [2, 3], [3, 9], [4, 3], [5, 1]] as const) heap.push(node, key);
    const out: number[] = [];
    while (heap.size() > 0) out.push(heap.popKey());
    expect(out).toEqual([1, 3, 3, 5, 9]);
  });

  it('peeks at the smallest key without taking it', () => {
    const heap = createHeap();
    expect(heap.peekKey()).toBe(Infinity);
    heap.push(1, 8);
    heap.push(2, 3);
    expect(heap.peekKey()).toBe(3);
    expect(heap.size()).toBe(2);
  });

  it('hands back the node of the last pop and survives clear', () => {
    const heap = createHeap();
    heap.push(7, 2);
    heap.push(8, 1);
    expect(heap.popKey()).toBe(1);
    expect(heap.node()).toBe(8);
    heap.clear();
    expect(heap.size()).toBe(0);
    heap.push(9, 4);
    expect(heap.popKey()).toBe(4);
    expect(heap.node()).toBe(9);
  });

  it('sorts anything (property)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 1000 })), (keys) => {
      const heap = createHeap();
      keys.forEach((k, i) => heap.push(i, k));
      const out: number[] = [];
      while (heap.size() > 0) out.push(heap.popKey());
      expect(out).toEqual([...keys].sort((a, b) => a - b));
    }));
  });
});

describe('buildCsr', () => {
  it('groups arcs by tail keeping their order', () => {
    const g = buildCsr(4, [2, 0, 2, 0], [3, 1, 0, 2], [5, 6, 7, 8]);
    expect(Array.from(g.first)).toEqual([0, 2, 2, 4, 4]);
    expect(Array.from(g.to)).toEqual([1, 2, 3, 0]);
    expect(Array.from(g.w)).toEqual([6, 8, 5, 7]);
  });
});

describe('dijkstra', () => {
  const g = buildCsr(5, [0, 0, 1, 2, 3], [1, 2, 3, 3, 4], [4, 1, 1, 5, 2]);

  it('finds shortest distances and leaves unreachable nodes at Infinity', () => {
    expect(Array.from(dijkstra(g, [{ node: 0, dist: 0 }]))).toEqual([0, 4, 1, 5, 7]);
    expect(dijkstra(g, [{ node: 4, dist: 0 }])[0]).toBe(Infinity);
  });

  it('starts from several sources with their own head starts', () => {
    expect(Array.from(dijkstra(g, [{ node: 1, dist: 10 }, { node: 2, dist: 0 }]))).toEqual([Infinity, 10, 0, 5, 7]);
  });

  it('keeps the shorter head start when the same node is given twice', () => {
    expect(Array.from(dijkstra(g, [{ node: 0, dist: 5 }, { node: 0, dist: 9 }]))).toEqual([5, 9, 6, 10, 12]);
    expect(Array.from(dijkstra(g, [{ node: 0, dist: 9 }, { node: 0, dist: 5 }]))).toEqual([5, 9, 6, 10, 12]);
  });

  it('agrees with Floyd-Warshall on random graphs (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.nat(7), fc.nat(7), fc.integer({ min: 1, max: 30 })), { maxLength: 30 }),
      fc.nat(7),
      (arcs, source) => {
        const n = 8;
        const graph = buildCsr(n, arcs.map((a) => a[0]), arcs.map((a) => a[1]), arcs.map((a) => a[2]));
        const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
        for (const [a, b, w] of arcs) d[a]![b] = Math.min(d[a]![b]!, w);
        for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i]![j] = Math.min(d[i]![j]!, d[i]![k]! + d[k]![j]!);
        expect(Array.from(dijkstra(graph, [{ node: source, dist: 0 }]))).toEqual(d[source]);
      },
    ));
  });
});

describe('dijkstra relaxations', () => {
  it('lets an equal-length second arc change nothing and a shorter one win', () => {
    const g = buildCsr(3, [0, 0, 1], [1, 2, 2], [5, 9, 3]);
    expect(Array.from(dijkstra(g, [{ node: 0, dist: 0 }]))).toEqual([0, 5, 8]);
    const tie = buildCsr(3, [0, 0, 1], [1, 2, 2], [5, 8, 3]);
    expect(Array.from(dijkstra(tie, [{ node: 0, dist: 0 }]))).toEqual([0, 5, 8]);
  });

  it('skips queue entries that were beaten later', () => {
    const g = buildCsr(4, [0, 0, 1, 2], [1, 2, 3, 3], [10, 1, 1, 1]);
    expect(Array.from(dijkstra(g, [{ node: 0, dist: 0 }]))).toEqual([0, 10, 1, 2]);
  });

  it('counts arcs for every node exactly once when building', () => {
    const g = buildCsr(3, [2, 2, 0], [0, 1, 1], [1, 2, 3]);
    expect(Array.from(g.first)).toEqual([0, 1, 1, 3]);
    expect(buildCsr(2, [], [], []).first).toEqual(Uint32Array.from([0, 0, 0]));
  });
});
