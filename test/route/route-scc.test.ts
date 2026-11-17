import fc from 'fast-check';

import { largestComponent } from '../../pipeline/build/route-scc';
import { buildCsr, dijkstra } from '../../src/core/route/plain';

describe('largestComponent', () => {
  it('marks the biggest strongly connected set and counts it', () => {
    const g = buildCsr(7, [0, 1, 2, 2, 3, 4, 5], [1, 2, 0, 3, 4, 3, 6], [1, 1, 1, 1, 1, 1, 1]);
    const got = largestComponent(g);
    expect(Array.from(got.inside)).toEqual([1, 1, 1, 0, 0, 0, 0]);
    expect(got.size).toBe(3);
  });

  it('prefers the lower node id when two components tie', () => {
    const g = buildCsr(4, [0, 1, 2, 3], [1, 0, 3, 2], [1, 1, 1, 1]);
    expect(Array.from(largestComponent(g).inside)).toEqual([1, 1, 0, 0]);
  });

  it('handles an empty graph and isolated nodes', () => {
    expect(largestComponent(buildCsr(0, [], [], [])).size).toBe(0);
    const got = largestComponent(buildCsr(3, [], [], []));
    expect(got.size).toBe(1);
    expect(Array.from(got.inside)).toEqual([1, 0, 0]);
  });

  it('survives a very long chain without blowing the stack', () => {
    const n = 200_000;
    const tails = Array.from({ length: n }, (_, i) => i);
    const heads = Array.from({ length: n }, (_, i) => (i + 1) % n);
    expect(largestComponent(buildCsr(n, tails, heads, tails.map(() => 1))).size).toBe(n);
  });

  it('agrees with mutual reachability (property)', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.nat(9), fc.nat(9)), { maxLength: 40 }), (arcs) => {
      const g = buildCsr(10, arcs.map((a) => a[0]), arcs.map((a) => a[1]), arcs.map(() => 1));
      const reach = Array.from({ length: 10 }, (_, s) => dijkstra(g, [{ node: s, dist: 0 }]));
      let best = new Set<number>([0]);
      for (let s = 0; s < 10; s++) {
        const members = new Set<number>();
        for (let t = 0; t < 10; t++) if (reach[s]![t] !== Infinity && reach[t]![s] !== Infinity) members.add(t);
        if (members.size > best.size) best = members;
      }
      const got = largestComponent(g);
      expect(got.size).toBe(best.size);
      expect(Array.from(got.inside).reduce((sum, v) => sum + v, 0)).toBe(best.size);
    }));
  });
});
