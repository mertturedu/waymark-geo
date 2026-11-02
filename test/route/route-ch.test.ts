import fc from 'fast-check';

import { contract } from '../../pipeline/build/route-ch';
import { createSearcher } from '../../src/core/route/ch-query';
import type { Hierarchy } from '../../src/core/route/hierarchy';
import { buildCsr, dijkstra } from '../../src/core/route/plain';

type Arcs = { n: number; tail: number[]; head: number[]; w: number[]; len: number[] };

function build(arcs: Arcs): { h: Hierarchy; toNew: Uint32Array } {
  const { hierarchy, toNew } = contract({
    n: arcs.n,
    tail: Uint32Array.from(arcs.tail),
    head: Uint32Array.from(arcs.head),
    ds: Uint32Array.from(arcs.w),
    len: Uint32Array.from(arcs.len),
    pa: Uint32Array.from(arcs.tail.map((_, i) => i)),
  });
  return { h: hierarchy, toNew };
}

const randomArcs = fc.record({
  n: fc.integer({ min: 2, max: 14 }),
  list: fc.array(fc.tuple(fc.nat(13), fc.nat(13), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 90 })), { maxLength: 60 }),
}).map(({ n, list }): Arcs => {
  const kept = list.filter(([a, b]) => a < n && b < n);
  return { n, tail: kept.map((a) => a[0]), head: kept.map((a) => a[1]), w: kept.map((a) => a[2]), len: kept.map((a) => a[3]) };
});

describe('contract', () => {
  it('answers every pair like plain Dijkstra and unpacks to a valid path (property)', () => {
    fc.assert(fc.property(randomArcs, (arcs) => {
      const { h, toNew } = build(arcs);
      const csr = buildCsr(arcs.n, arcs.tail, arcs.head, arcs.w);
      const searcher = createSearcher(h);
      for (let s = 0; s < arcs.n; s++) {
        const dist = dijkstra(csr, [{ node: s, dist: 0 }]);
        for (let t = 0; t < arcs.n; t++) {
          const got = searcher.path([{ node: toNew[s] as number, w: 0, len: 0 }], [{ node: toNew[t] as number, w: 0, len: 0 }]);
          if (dist[t] === Infinity) {
            expect(got).toBeNull();
            continue;
          }
          expect(got?.weight).toBe(dist[t]);
          let at = s;
          let weight = 0;
          let length = 0;
          for (const pa of got?.arcs ?? []) {
            expect(arcs.tail[pa]).toBe(at);
            at = arcs.head[pa] as number;
            weight += arcs.w[pa] as number;
            length += arcs.len[pa] as number;
          }
          expect(at).toBe(t);
          expect(weight).toBe(dist[t]);
          expect(got?.length).toBe(length);
        }
      }
    }), { numRuns: 150 });
  });

  it('treats a start and an end with head starts as extra weight on the path', () => {
    const arcs: Arcs = { n: 3, tail: [0, 1], head: [1, 2], w: [5, 7], len: [50, 70] };
    const { h, toNew } = build(arcs);
    const got = createSearcher(h).path([{ node: toNew[0] as number, w: 3, len: 30 }, { node: toNew[1] as number, w: 100, len: 1 }], [{ node: toNew[2] as number, w: 2, len: 20 }]);
    expect(got).toMatchObject({ weight: 17, length: 170, from: 0, to: 0, arcs: [0, 1] });
  });

  it('is the same bytes every time', () => {
    const arcs: Arcs = { n: 6, tail: [0, 1, 2, 3, 4, 5, 0, 2], head: [1, 2, 3, 4, 5, 0, 3, 5], w: [4, 3, 2, 6, 1, 5, 9, 8], len: [1, 1, 1, 1, 1, 1, 1, 1] };
    const a = build(arcs).h;
    const b = build(arcs).h;
    expect(Array.from(a.upTo)).toEqual(Array.from(b.upTo));
    expect(Array.from(a.downFrom)).toEqual(Array.from(b.downFrom));
    expect(Array.from(a.upVia)).toEqual(Array.from(b.upVia));
  });

  it('puts every arc in exactly one upward list and renumbers nodes by rank', () => {
    const arcs: Arcs = { n: 5, tail: [0, 1, 2, 3, 4], head: [1, 2, 3, 4, 0], w: [1, 1, 1, 1, 1], len: [1, 1, 1, 1, 1] };
    const { h } = build(arcs);
    for (let v = 0; v < h.n; v++) {
      for (let i = h.upFirst[v] as number; i < (h.upFirst[v + 1] as number); i++) expect(h.upTo[i]).toBeGreaterThan(v);
      for (let i = h.downFirst[v] as number; i < (h.downFirst[v + 1] as number); i++) expect(h.downFrom[i]).toBeGreaterThan(v);
    }
    expect(h.upTo.length + h.downFrom.length).toBeGreaterThanOrEqual(5);
  });

  it('survives loops, parallel arcs and isolated nodes', () => {
    const arcs: Arcs = { n: 4, tail: [0, 0, 0, 1], head: [0, 1, 1, 2], w: [3, 9, 4, 2], len: [1, 2, 3, 4] };
    const { h, toNew } = build(arcs);
    const got = createSearcher(h).path([{ node: toNew[0] as number, w: 0, len: 0 }], [{ node: toNew[2] as number, w: 0, len: 0 }]);
    expect(got).toMatchObject({ weight: 6, arcs: [2, 3] });
    expect(createSearcher(h).path([{ node: toNew[3] as number, w: 0, len: 0 }], [{ node: toNew[0] as number, w: 0, len: 0 }])).toBeNull();
  });
});

describe('createSearcher labels and damaged shortcuts', () => {
  const chain: Arcs = { n: 4, tail: [0, 1, 2], head: [1, 2, 3], w: [5, 7, 9], len: [50, 70, 90] };

  it('keeps the cheaper of two labels on the same node, whichever comes first', () => {
    const { h, toNew } = build(chain);
    const searcher = createSearcher(h);
    const node = (v: number): number => toNew[v] as number;
    const target = [{ node: node(3), w: 0, len: 0 }];
    expect(searcher.path([{ node: node(0), w: 3, len: 30 }, { node: node(0), w: 8, len: 80 }], target)).toMatchObject({ weight: 24, length: 240, from: 0 });
    expect(searcher.path([{ node: node(0), w: 8, len: 80 }, { node: node(0), w: 3, len: 30 }], target)).toMatchObject({ weight: 24, length: 240, from: 1 });
    const source = [{ node: node(0), w: 0, len: 0 }];
    expect(searcher.path(source, [{ node: node(3), w: 4, len: 40 }, { node: node(3), w: 9, len: 90 }])).toMatchObject({ weight: 25, to: 0 });
    expect(searcher.path(source, [{ node: node(3), w: 9, len: 90 }, { node: node(3), w: 4, len: 40 }])).toMatchObject({ weight: 25, to: 1 });
  });

  it('answers an empty list of sources or targets with nothing and can be asked again', () => {
    const { h, toNew } = build(chain);
    const searcher = createSearcher(h);
    expect(searcher.path([], [{ node: toNew[3] as number, w: 0, len: 0 }])).toBeNull();
    expect(searcher.path([{ node: toNew[0] as number, w: 0, len: 0 }], [])).toBeNull();
    expect(searcher.path([{ node: toNew[0] as number, w: 0, len: 0 }], [{ node: toNew[3] as number, w: 0, len: 0 }])?.weight).toBe(21);
    expect(searcher.path([{ node: toNew[1] as number, w: 0, len: 0 }], [{ node: toNew[3] as number, w: 0, len: 0 }])?.weight).toBe(16);
  });

  it('stops on a shortcut whose parts are missing', () => {
    const ring: Arcs = { n: 6, tail: [0, 1, 2, 3, 4, 5], head: [1, 2, 3, 4, 5, 0], w: [1, 1, 1, 1, 1, 1], len: [1, 1, 1, 1, 1, 1] };
    const { h, toNew } = build(ring);
    expect(Array.from(h.upVia).concat(Array.from(h.downVia)).some((via) => via < 0x80000000)).toBe(true);
    const broken: Hierarchy = { ...h, downFrom: h.downFrom.map(() => 0xffffff) };
    const searcher = createSearcher(broken);
    let failed = false;
    for (let s = 0; s < 6; s++) {
      for (let t = 0; t < 6; t++) {
        try {
          searcher.path([{ node: toNew[s] as number, w: 0, len: 0 }], [{ node: toNew[t] as number, w: 0, len: 0 }]);
        } catch (error) {
          failed = true;
          expect((error as Error).message).toMatch(/hierarchy/);
        }
      }
    }
    expect(failed).toBe(true);
  });
});
