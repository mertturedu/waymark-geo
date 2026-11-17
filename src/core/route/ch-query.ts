import { packError } from './bytes';
import { createHeap } from './heap';
import { ORIGINAL, VIA_MASK, type Hierarchy } from './hierarchy';

export type Label = { node: number; w: number; len: number };

export type PathResult = { weight: number; length: number; from: number; to: number; arcs: number[] };

export type Searcher = {
  path(sources: ReadonlyArray<Label>, targets: ReadonlyArray<Label>): PathResult | null;
};

export function unpackArc(h: Hierarchy, from: number, to: number, via: number, out: number[]): void {
  const stack: number[] = [from, to, via];
  while (stack.length > 0) {
    const arcVia = stack.pop() as number;
    const head = stack.pop() as number;
    const tail = stack.pop() as number;
    if (arcVia >= ORIGINAL) {
      out.push(arcVia & VIA_MASK);
      continue;
    }
    let left = -1;
    for (let i = h.downFirst[arcVia] as number; i < (h.downFirst[arcVia + 1] as number); i++) if (h.downFrom[i] === tail) left = h.downVia[i] as number;
    let right = -1;
    for (let i = h.upFirst[arcVia] as number; i < (h.upFirst[arcVia + 1] as number); i++) if (h.upTo[i] === head) right = h.upVia[i] as number;
    if (left < 0 || right < 0) throw packError('hierarchy');
    stack.push(arcVia, head, right, tail, arcVia, left);
  }
}

export function createSearcher(h: Hierarchy): Searcher {
  const distF = new Uint32Array(h.n);
  const distB = new Uint32Array(h.n);
  const lenF = new Uint32Array(h.n);
  const lenB = new Uint32Array(h.n);
  const seenF = new Uint32Array(h.n);
  const seenB = new Uint32Array(h.n);
  const fromF = new Int32Array(h.n);
  const fromB = new Int32Array(h.n);
  const entryF = new Uint32Array(h.n);
  const entryB = new Uint32Array(h.n);
  const rootF = new Uint32Array(h.n);
  const rootB = new Uint32Array(h.n);
  let epoch = 0;
  const heap = createHeap();

  return {
    path(sources, targets) {
      epoch++;
      heap.clear();
      sources.forEach((s, i) => {
        if (seenF[s.node] !== epoch || s.w < (distF[s.node] as number)) {
          seenF[s.node] = epoch;
          distF[s.node] = s.w;
          lenF[s.node] = s.len;
          fromF[s.node] = -1;
          rootF[s.node] = i;
          heap.push(s.node, s.w);
        }
      });
      while (heap.size() > 0) {
        const d = heap.popKey();
        const v = heap.node();
        if (d > (distF[v] as number)) continue;
        for (let i = h.upFirst[v] as number; i < (h.upFirst[v + 1] as number); i++) {
          const u = h.upTo[i] as number;
          const next = d + (h.upW[i] as number);
          if (seenF[u] !== epoch || next < (distF[u] as number)) {
            seenF[u] = epoch;
            distF[u] = next;
            lenF[u] = (lenF[v] as number) + (h.upLen[i] as number);
            fromF[u] = v;
            entryF[u] = i;
            rootF[u] = rootF[v] as number;
            heap.push(u, next);
          }
        }
      }

      let best = Infinity;
      let meet = -1;
      heap.clear();
      targets.forEach((t, i) => {
        if (seenB[t.node] !== epoch || t.w < (distB[t.node] as number)) {
          seenB[t.node] = epoch;
          distB[t.node] = t.w;
          lenB[t.node] = t.len;
          fromB[t.node] = -1;
          rootB[t.node] = i;
          heap.push(t.node, t.w);
        }
      });
      while (heap.size() > 0) {
        const d = heap.popKey();
        const v = heap.node();
        if (d > (distB[v] as number)) continue;
        if (d >= best) break;
        if (seenF[v] === epoch && (distF[v] as number) + d < best) {
          best = (distF[v] as number) + d;
          meet = v;
        }
        for (let i = h.downFirst[v] as number; i < (h.downFirst[v + 1] as number); i++) {
          const u = h.downFrom[i] as number;
          const next = d + (h.downW[i] as number);
          if (seenB[u] !== epoch || next < (distB[u] as number)) {
            seenB[u] = epoch;
            distB[u] = next;
            lenB[u] = (lenB[v] as number) + (h.downLen[i] as number);
            fromB[u] = v;
            entryB[u] = i;
            rootB[u] = rootB[v] as number;
            heap.push(u, next);
          }
        }
      }
      if (meet < 0) return null;

      const forward: number[][] = [];
      for (let v = meet; (fromF[v] as number) >= 0; v = fromF[v] as number) forward.push([fromF[v] as number, v, h.upVia[entryF[v] as number] as number]);
      const arcs: number[] = [];
      for (let i = forward.length - 1; i >= 0; i--) {
        const [tail, head, via] = forward[i] as number[];
        unpackArc(h, tail as number, head as number, via as number, arcs);
      }
      for (let v = meet; (fromB[v] as number) >= 0; v = fromB[v] as number) unpackArc(h, v, fromB[v] as number, h.downVia[entryB[v] as number] as number, arcs);
      return { weight: best, length: (lenF[meet] as number) + (lenB[meet] as number), from: rootF[meet] as number, to: rootB[meet] as number, arcs };
    },
  };
}
