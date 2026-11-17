import { createHeap } from './heap';

export type Csr = { n: number; first: Uint32Array; to: Uint32Array; w: Uint32Array };

export type Source = { node: number; dist: number };

export function buildCsr(n: number, tails: ArrayLike<number>, heads: ArrayLike<number>, weights: ArrayLike<number>): Csr {
  const first = new Uint32Array(n + 1);
  for (let i = 0; i < tails.length; i++) first[(tails[i] as number) + 1] = (first[(tails[i] as number) + 1] as number) + 1;
  for (let v = 0; v < n; v++) first[v + 1] = (first[v + 1] as number) + (first[v] as number);
  const fill = first.slice(0, n);
  const to = new Uint32Array(tails.length);
  const w = new Uint32Array(tails.length);
  for (let i = 0; i < tails.length; i++) {
    const slot = fill[tails[i] as number] as number;
    fill[tails[i] as number] = slot + 1;
    to[slot] = heads[i] as number;
    w[slot] = weights[i] as number;
  }
  return { n, first, to, w };
}

export function dijkstra(g: Csr, sources: ReadonlyArray<Source>): Float64Array {
  const dist = new Float64Array(g.n).fill(Infinity);
  const heap = createHeap();
  for (const s of sources) {
    if (s.dist < (dist[s.node] as number)) {
      dist[s.node] = s.dist;
      heap.push(s.node, s.dist);
    }
  }
  while (heap.size() > 0) {
    const d = heap.popKey();
    const v = heap.node();
    if (d > (dist[v] as number)) continue;
    for (let i = g.first[v] as number; i < (g.first[v + 1] as number); i++) {
      const next = d + (g.w[i] as number);
      const u = g.to[i] as number;
      if (next < (dist[u] as number)) {
        dist[u] = next;
        heap.push(u, next);
      }
    }
  }
  return dist;
}
