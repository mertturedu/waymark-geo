import type { Label } from './ch-query';
import { ORIGINAL, type Hierarchy } from './hierarchy';
import { UNREACHABLE } from './matrix';
import { buildCsr, dijkstra, type Csr } from './plain';

export function plainGraph(h: Hierarchy): Csr {
  const tails: number[] = [];
  const heads: number[] = [];
  const weights: number[] = [];
  for (let v = 0; v < h.n; v++) {
    for (let i = h.upFirst[v] as number; i < (h.upFirst[v + 1] as number); i++) {
      if ((h.upVia[i] as number) < ORIGINAL) continue;
      tails.push(v);
      heads.push(h.upTo[i] as number);
      weights.push(h.upW[i] as number);
    }
    for (let i = h.downFirst[v] as number; i < (h.downFirst[v + 1] as number); i++) {
      if ((h.downVia[i] as number) < ORIGINAL) continue;
      tails.push(h.downFrom[i] as number);
      heads.push(v);
      weights.push(h.downW[i] as number);
    }
  }
  return buildCsr(h.n, tails, heads, weights);
}

export function oracleWeights(graph: Csr, sources: ReadonlyArray<ReadonlyArray<Label>>, targets: ReadonlyArray<ReadonlyArray<Label>>): Uint32Array {
  const out = new Uint32Array(sources.length * targets.length).fill(UNREACHABLE);
  sources.forEach((labels, i) => {
    const dist = dijkstra(graph, labels.map((l) => ({ node: l.node, dist: l.w })));
    targets.forEach((to, j) => {
      let best = Infinity;
      for (const l of to) best = Math.min(best, (dist[l.node] as number) + l.w);
      if (best !== Infinity) out[i * targets.length + j] = best;
    });
  });
  return out;
}
