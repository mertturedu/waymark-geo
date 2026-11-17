export type Tree = { feature: Int16Array | number[]; cut: Float64Array | number[]; left: Int16Array | number[]; right: Int16Array | number[]; value: Float64Array | number[] };

export type TrafficModel = { version: 1; slots: number; features: number; mean: number[]; basis: number[][]; base: number[]; rate: number; trees: Tree[][] };

export type TrainOptions = { components: number; rounds: number; rate: number; depth: number; minLeaf: number; rowShare: number; columnShare: number; bins: number; seed: number };

export const TRAIN_OPTIONS: TrainOptions = { components: 3, rounds: 300, rate: 0.03, depth: 5, minLeaf: 10, rowShare: 0.7, columnShare: 0.5, bins: 32, seed: 1 };

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function meanCurve(rows: ReadonlyArray<ReadonlyArray<number | null>>, slots: number): number[] {
  return Array.from({ length: slots }, (_, s) => {
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      const value = row[s];
      if (value === null || value === undefined) continue;
      sum += value;
      count += 1;
    }
    return count === 0 ? 0 : sum / count;
  });
}

export function principalCurves(centred: ReadonlyArray<Float64Array>, slots: number, count: number): number[][] {
  const cov = Array.from({ length: slots }, () => new Float64Array(slots));
  for (const row of centred) for (let a = 0; a < slots; a++) for (let b = a; b < slots; b++) (cov[a] as Float64Array)[b] = ((cov[a] as Float64Array)[b] as number) + (row[a] as number) * (row[b] as number);
  for (let a = 0; a < slots; a++) for (let b = 0; b < a; b++) (cov[a] as Float64Array)[b] = (cov[b] as Float64Array)[a] as number;
  const basis: number[][] = [];
  for (let k = 0; k < count; k++) {
    let v = Float64Array.from({ length: slots }, (_, s) => 1 + ((s * 7 + k * 3) % 5) / 10);
    for (let round = 0; round < 500; round++) {
      const next = new Float64Array(slots);
      for (let a = 0; a < slots; a++) {
        let sum = 0;
        for (let b = 0; b < slots; b++) sum += ((cov[a] as Float64Array)[b] as number) * (v[b] as number);
        next[a] = sum;
      }
      for (const done of basis) {
        let dot = 0;
        for (let a = 0; a < slots; a++) dot += (next[a] as number) * (done[a] as number);
        for (let a = 0; a < slots; a++) next[a] = (next[a] as number) - dot * (done[a] as number);
      }
      const norm = Math.hypot(...next);
      if (norm === 0) break;
      for (let a = 0; a < slots; a++) next[a] = (next[a] as number) / norm;
      v = next;
    }
    const sign = v.reduce((sum, x) => sum + x, 0) < 0 ? -1 : 1;
    basis.push(Array.from(v, (x) => x * sign));
  }
  return basis;
}

type Binned = { cuts: number[][]; codes: Uint8Array[] };

function binFeatures(x: ReadonlyArray<Float64Array>, features: number, bins: number): Binned {
  const cuts: number[][] = [];
  const codes: Uint8Array[] = [];
  for (let f = 0; f < features; f++) {
    const sorted = x.map((row) => row[f] as number).sort((a, b) => a - b);
    const edges: number[] = [];
    for (let b = 1; b < bins; b++) {
      const low = sorted[Math.floor((sorted.length * b) / bins) - 1];
      const high = sorted[Math.floor((sorted.length * b) / bins)];
      if (low === undefined || high === undefined || low === high) continue;
      const edge = (low + high) / 2;
      if (edges[edges.length - 1] !== edge) edges.push(edge);
    }
    cuts.push(edges);
    codes.push(Uint8Array.from(x, (row) => {
      let code = 0;
      while (code < edges.length && (row[f] as number) > (edges[code] as number)) code++;
      return code;
    }));
  }
  return { cuts, codes };
}

function growTree(binned: Binned, residual: Float64Array, rows: number[], options: TrainOptions, next: () => number): Tree {
  const feature: number[] = [];
  const cut: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const value: number[] = [];
  const features = binned.cuts.length;
  const build = (members: number[], depth: number): number => {
    const index = feature.length;
    let total = 0;
    for (const row of members) total += residual[row] as number;
    feature.push(-1);
    cut.push(0);
    left.push(-1);
    right.push(-1);
    value.push(members.length === 0 ? 0 : total / members.length);
    if (depth === 0 || members.length < 2 * options.minLeaf) return index;
    let best = { gain: 0, feature: -1, bin: -1 };
    const parent = (total * total) / members.length;
    for (let f = 0; f < features; f++) {
      if (next() >= options.columnShare) continue;
      const edges = binned.cuts[f] as number[];
      if (edges.length === 0) continue;
      const sums = new Float64Array(edges.length + 1);
      const counts = new Uint32Array(edges.length + 1);
      const codes = binned.codes[f] as Uint8Array;
      for (const row of members) {
        sums[codes[row] as number] = (sums[codes[row] as number] as number) + (residual[row] as number);
        counts[codes[row] as number] = (counts[codes[row] as number] as number) + 1;
      }
      let sum = 0;
      let count = 0;
      for (let b = 0; b < edges.length; b++) {
        sum += sums[b] as number;
        count += counts[b] as number;
        if (count < options.minLeaf || members.length - count < options.minLeaf) continue;
        const gain = (sum * sum) / count + ((total - sum) * (total - sum)) / (members.length - count) - parent;
        if (gain > best.gain + 1e-12) best = { gain, feature: f, bin: b };
      }
    }
    if (best.feature < 0) return index;
    const codes = binned.codes[best.feature] as Uint8Array;
    feature[index] = best.feature;
    cut[index] = (binned.cuts[best.feature] as number[])[best.bin] as number;
    left[index] = build(members.filter((row) => (codes[row] as number) <= best.bin), depth - 1);
    right[index] = build(members.filter((row) => (codes[row] as number) > best.bin), depth - 1);
    return index;
  };
  build(rows, options.depth);
  return { feature, cut, left, right, value };
}

export function treeValue(tree: Tree, x: ArrayLike<number>): number {
  let at = 0;
  while ((tree.feature[at] as number) >= 0) at = ((x[tree.feature[at] as number] as number) <= (tree.cut[at] as number) ? tree.left[at] : tree.right[at]) as number;
  return tree.value[at] as number;
}

export function trainTrafficModel(x: ReadonlyArray<Float64Array>, curves: ReadonlyArray<ReadonlyArray<number | null>>, options: TrainOptions = TRAIN_OPTIONS): TrafficModel {
  const slots = (curves[0] as ReadonlyArray<number | null>).length;
  const features = (x[0] as Float64Array).length;
  const mean = meanCurve(curves, slots);
  const centred = curves.map((row) => Float64Array.from({ length: slots }, (_, s) => ((row[s] ?? mean[s]) as number) - (mean[s] as number)));
  const basis = principalCurves(centred, slots, options.components);
  const binned = binFeatures(x, features, options.bins);
  const next = random(options.seed);
  const base: number[] = [];
  const trees: Tree[][] = [];
  for (const curve of basis) {
    const target = Float64Array.from(centred, (row) => row.reduce((sum, v, s) => sum + v * (curve[s] as number), 0));
    const start = target.reduce((sum, v) => sum + v, 0) / target.length;
    const fitted = new Float64Array(target.length).fill(start);
    const forest: Tree[] = [];
    for (let round = 0; round < options.rounds; round++) {
      const residual = Float64Array.from(target, (v, i) => v - (fitted[i] as number));
      const rows: number[] = [];
      for (let i = 0; i < target.length; i++) if (next() < options.rowShare) rows.push(i);
      const tree = growTree(binned, residual, rows, options, next);
      for (let i = 0; i < target.length; i++) fitted[i] = (fitted[i] as number) + options.rate * treeValue(tree, x[i] as Float64Array);
      forest.push(tree);
    }
    base.push(start);
    trees.push(forest);
  }
  return { version: 1, slots, features, mean, basis, base, rate: options.rate, trees };
}

export function predictScores(model: TrafficModel, x: ArrayLike<number>): number[] {
  return model.trees.map((forest, k) => forest.reduce((sum, tree) => sum + model.rate * treeValue(tree, x), model.base[k] as number));
}

export function curveOf(model: TrafficModel, scores: ReadonlyArray<number>): number[] {
  return model.mean.map((value, s) => Math.max(0, value + scores.reduce((sum, score, k) => sum + score * ((model.basis[k] as number[])[s] as number), 0)));
}

export const predictCurve = (model: TrafficModel, x: ArrayLike<number>): number[] => curveOf(model, predictScores(model, x));
