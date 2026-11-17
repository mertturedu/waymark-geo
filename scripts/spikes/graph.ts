import type { Yield } from './yielder';

export type Graph = { n: number; firstEdge: Uint32Array; target: Uint32Array; weight: Uint32Array };

export function fromEdges(n: number, edges: [number, number, number][]): Graph {
  const firstEdge = new Uint32Array(n + 1);
  for (const [from] of edges) firstEdge[from + 1] = (firstEdge[from + 1] as number) + 1;
  for (let i = 0; i < n; i++) firstEdge[i + 1] = (firstEdge[i + 1] as number) + (firstEdge[i] as number);
  const fill = firstEdge.slice(0, n);
  const target = new Uint32Array(edges.length);
  const weight = new Uint32Array(edges.length);
  for (const [from, to, w] of edges) {
    const at = fill[from] as number;
    target[at] = to;
    weight[at] = w;
    fill[from] = at + 1;
  }
  return { n, firstEdge, target, weight };
}

const mix = (a: number, b: number, seed: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + seed, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
};

function* gridRows(side: number, seed: number): Generator<[number, number, number][]> {
  const weightOf = (u: number, v: number): number => 1 + (mix(Math.min(u, v), Math.max(u, v), seed) % 200);
  for (let y = 0; y < side; y++) {
    const row: [number, number, number][] = [];
    for (let x = 0; x < side; x++) {
      const u = y * side + x;
      if (x > 0) row.push([u, u - 1, weightOf(u, u - 1)]);
      if (x < side - 1) row.push([u, u + 1, weightOf(u, u + 1)]);
      if (y > 0) row.push([u, u - side, weightOf(u, u - side)]);
      if (y < side - 1) row.push([u, u + side, weightOf(u, u + side)]);
    }
    yield row;
  }
}

export function makeGridGraph(side: number, seed: number): Graph {
  const edges: [number, number, number][] = [];
  for (const row of gridRows(side, seed)) for (const edge of row) edges.push(edge);
  return fromEdges(side * side, edges);
}

export async function makeGridGraphAsync(side: number, seed: number, yieldNow: Yield): Promise<Graph> {
  const edges: [number, number, number][] = [];
  for (const row of gridRows(side, seed)) {
    for (const edge of row) edges.push(edge);
    await yieldNow();
  }
  return fromEdges(side * side, edges);
}

type Workspace = { dist: Float64Array; heapKey: Float64Array; heapNode: Uint32Array; isTarget: Uint8Array };

const workspaceFor = (g: Graph): Workspace => ({
  dist: new Float64Array(g.n),
  heapKey: new Float64Array(g.target.length + 2),
  heapNode: new Uint32Array(g.target.length + 2),
  isTarget: new Uint8Array(g.n),
});

function search(g: Graph, ws: Workspace, source: number, targets: Uint32Array): void {
  const { dist, heapKey, heapNode, isTarget } = ws;
  dist.fill(Infinity);
  isTarget.fill(0);
  let remaining = 0;
  for (const t of targets) {
    if (isTarget[t] === 0) remaining++;
    isTarget[t] = 1;
  }
  let size = 0;
  const push = (key: number, node: number): void => {
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((heapKey[parent] as number) <= key) break;
      heapKey[i] = heapKey[parent] as number;
      heapNode[i] = heapNode[parent] as number;
      i = parent;
    }
    heapKey[i] = key;
    heapNode[i] = node;
  };
  const pop = (): void => {
    size--;
    if (size === 0) return;
    const key = heapKey[size] as number;
    const node = heapNode[size] as number;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && (heapKey[child + 1] as number) < (heapKey[child] as number)) child++;
      if ((heapKey[child] as number) >= key) break;
      heapKey[i] = heapKey[child] as number;
      heapNode[i] = heapNode[child] as number;
      i = child;
    }
    heapKey[i] = key;
    heapNode[i] = node;
  };

  dist[source] = 0;
  push(0, source);
  while (size > 0 && remaining > 0) {
    const d = heapKey[0] as number;
    const u = heapNode[0] as number;
    pop();
    if (d > (dist[u] as number)) continue;
    if (isTarget[u] === 1) {
      isTarget[u] = 2;
      remaining--;
    }
    for (let e = g.firstEdge[u] as number; e < (g.firstEdge[u + 1] as number); e++) {
      const v = g.target[e] as number;
      const candidate = d + (g.weight[e] as number);
      if (candidate < (dist[v] as number)) {
        dist[v] = candidate;
        push(candidate, v);
      }
    }
  }
}

export function dijkstraTargets(g: Graph, source: number, targets: Uint32Array): Float64Array {
  const ws = workspaceFor(g);
  search(g, ws, source, targets);
  return Float64Array.from(targets, (t) => ws.dist[t] as number);
}

export function matrix(g: Graph, sources: Uint32Array, targets: Uint32Array): Float64Array {
  const ws = workspaceFor(g);
  const out = new Float64Array(sources.length * targets.length);
  sources.forEach((source, row) => {
    search(g, ws, source, targets);
    targets.forEach((t, col) => {
      out[row * targets.length + col] = ws.dist[t] as number;
    });
  });
  return out;
}

export async function matrixAsync(
  g: Graph,
  sources: Uint32Array,
  targets: Uint32Array,
  options: { yieldNow: Yield; now: () => number },
): Promise<{ values: Float64Array; computeMs: number }> {
  const ws = workspaceFor(g);
  const values = new Float64Array(sources.length * targets.length);
  let computeMs = 0;
  for (let row = 0; row < sources.length; row++) {
    const start = options.now();
    search(g, ws, sources[row] as number, targets);
    targets.forEach((t, col) => {
      values[row * targets.length + col] = ws.dist[t] as number;
    });
    computeMs += options.now() - start;
    await options.yieldNow();
  }
  return { values, computeMs };
}

export type BenchResult = { nodes: number; edges: number; points: number; timesMs: number[]; medianMs: number; checksum: number };

export function benchPoints(g: Graph, seed: number, points: number): { sources: Uint32Array; targets: Uint32Array } {
  const pick = (salt: number): Uint32Array => Uint32Array.from({ length: points }, (_, i) => mix(i, salt, seed) % g.n);
  return { sources: pick(1), targets: pick(2) };
}

export function runBench(options: { side: number; seed: number; points: number; repetitions: number; now: () => number }): BenchResult {
  const g = makeGridGraph(options.side, options.seed);
  const { sources, targets } = benchPoints(g, options.seed, options.points);
  const timesMs: number[] = [];
  let checksum = 0;
  for (let rep = 0; rep < options.repetitions; rep++) {
    const start = options.now();
    const m = matrix(g, sources, targets);
    timesMs.push(options.now() - start);
    checksum = m.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  }
  const sorted = [...timesMs].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)] as number;
  return { nodes: g.n, edges: g.target.length, points: options.points, timesMs, medianMs, checksum };
}
