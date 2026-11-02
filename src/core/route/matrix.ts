import type { Label } from './ch-query';
import { createHeap } from './heap';
import type { Hierarchy } from './hierarchy';

export const UNREACHABLE = 0xffffffff;

export type Matrix = { w: Uint32Array; len: Uint32Array };

export type MatrixSolver = { solve(sources: ReadonlyArray<ReadonlyArray<Label>>, targets: ReadonlyArray<ReadonlyArray<Label>>): Matrix };

export function createMatrixSolver(h: Hierarchy): MatrixSolver {
  const dist = new Uint32Array(h.n);
  const length = new Uint32Array(h.n);
  const seen = new Uint32Array(h.n);
  const bucketSeen = new Uint32Array(h.n);
  const bucketHead = new Int32Array(h.n);
  let epoch = 0;
  let bucketEpoch = 0;
  const heap = createHeap();

  const sweep = (labels: ReadonlyArray<Label>, forward: boolean, settle: (v: number, d: number, len: number) => void): void => {
    epoch++;
    heap.clear();
    for (const label of labels) {
      if (seen[label.node] !== epoch || label.w < (dist[label.node] as number)) {
        seen[label.node] = epoch;
        dist[label.node] = label.w;
        length[label.node] = label.len;
        heap.push(label.node, label.w);
      }
    }
    const first = forward ? h.upFirst : h.downFirst;
    const other = forward ? h.upTo : h.downFrom;
    const weight = forward ? h.upW : h.downW;
    const size = forward ? h.upLen : h.downLen;
    while (heap.size() > 0) {
      const d = heap.popKey();
      const v = heap.node();
      if (d > (dist[v] as number)) continue;
      settle(v, d, length[v] as number);
      for (let i = first[v] as number; i < (first[v + 1] as number); i++) {
        const u = other[i] as number;
        const next = d + (weight[i] as number);
        if (seen[u] !== epoch || next < (dist[u] as number)) {
          seen[u] = epoch;
          dist[u] = next;
          length[u] = (length[v] as number) + (size[i] as number);
          heap.push(u, next);
        }
      }
    }
  };

  return {
    solve(sources, targets) {
      const m = targets.length;
      const w = new Uint32Array(sources.length * m).fill(UNREACHABLE);
      const len = new Uint32Array(sources.length * m);
      bucketEpoch++;
      const entryTarget: number[] = [];
      const entryDist: number[] = [];
      const entryLen: number[] = [];
      const entryNext: number[] = [];
      targets.forEach((labels, j) => {
        sweep(labels, false, (v, d, l) => {
          entryTarget.push(j);
          entryDist.push(d);
          entryLen.push(l);
          entryNext.push(bucketSeen[v] === bucketEpoch ? (bucketHead[v] as number) : -1);
          bucketSeen[v] = bucketEpoch;
          bucketHead[v] = entryTarget.length - 1;
        });
      });
      sources.forEach((labels, i) => {
        sweep(labels, true, (v, d, l) => {
          if (bucketSeen[v] !== bucketEpoch) return;
          for (let k = bucketHead[v] as number; k >= 0; k = entryNext[k] as number) {
            const at = i * m + (entryTarget[k] as number);
            const total = d + (entryDist[k] as number);
            if (total < (w[at] as number)) {
              w[at] = total;
              len[at] = l + (entryLen[k] as number);
            }
          }
        });
      });
      return { w, len };
    },
  };
}
