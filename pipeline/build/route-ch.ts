import { createHeap } from '../../src/core/route/heap';
import { ORIGINAL, type Hierarchy } from '../../src/core/route/hierarchy';

export type ChInput = { n: number; tail: Uint32Array; head: Uint32Array; ds: Uint32Array; len: Uint32Array; pa: Uint32Array };

export type ChOutput = { hierarchy: Hierarchy; toNew: Uint32Array; stats: { arcs: number; shortcuts: number } };

const SETTLE_LIMIT = 300;
const EDGE_DIFF_WEIGHT = 4;
const DELETED_WEIGHT = 2;

export function contract(input: ChInput): ChOutput {
  const { n } = input;
  const aTail: number[] = [];
  const aHead: number[] = [];
  const aW: number[] = [];
  const aLen: number[] = [];
  const aVia: number[] = [];
  const outs: number[][] = Array.from({ length: n }, () => []);
  const ins: number[][] = Array.from({ length: n }, () => []);
  const done = new Uint8Array(n);

  const find = (u: number, v: number): number => {
    for (const a of outs[u] as number[]) if (aHead[a] === v) return a;
    return -1;
  };
  const add = (u: number, v: number, w: number, len: number, via: number): void => {
    const known = find(u, v);
    if (known >= 0) {
      if (w < (aW[known] as number)) {
        aW[known] = w;
        aLen[known] = len;
        aVia[known] = via;
      }
      return;
    }
    aTail.push(u);
    aHead.push(v);
    aW.push(w);
    aLen.push(len);
    aVia.push(via);
    (outs[u] as number[]).push(aTail.length - 1);
    (ins[v] as number[]).push(aTail.length - 1);
  };
  for (let i = 0; i < input.tail.length; i++) {
    const u = input.tail[i] as number;
    const v = input.head[i] as number;
    if (u !== v) add(u, v, input.ds[i] as number, input.len[i] as number, (ORIGINAL | (input.pa[i] as number)) >>> 0);
  }
  const originals = aTail.length;

  const seen = new Uint32Array(n);
  const reach = new Float64Array(n);
  let stamp = 0;
  const heap = createHeap();

  const witness = (from: number, skip: number, limit: number): void => {
    stamp++;
    heap.clear();
    seen[from] = stamp;
    reach[from] = 0;
    heap.push(from, 0);
    let settled = 0;
    while (heap.size() > 0 && settled < SETTLE_LIMIT) {
      const d = heap.popKey();
      const v = heap.node();
      if (d > (reach[v] as number)) continue;
      if (d > limit) break;
      settled++;
      for (const a of outs[v] as number[]) {
        const x = aHead[a] as number;
        if (x === skip || done[x] === 1) continue;
        const next = d + (aW[a] as number);
        if (seen[x] !== stamp || next < (reach[x] as number)) {
          seen[x] = stamp;
          reach[x] = next;
          heap.push(x, next);
        }
      }
    }
  };

  const live = (list: number[], other: Uint32Array | number[], v: number): number[] => list.filter((a) => done[(other[a] as number)] === 0 && (other[a] as number) !== v);

  type Plan = { u: number; x: number; w: number; len: number; a: number; b: number };
  const plan = (v: number): Plan[] => {
    const inArcs = live(ins[v] as number[], aTail, v);
    const outArcs = live(outs[v] as number[], aHead, v);
    const found: Plan[] = [];
    if (outArcs.length === 0) return found;
    for (const a of inArcs) {
      const u = aTail[a] as number;
      let limit = 0;
      for (const b of outArcs) if (aHead[b] !== u) limit = Math.max(limit, (aW[a] as number) + (aW[b] as number));
      if (limit === 0) continue;
      witness(u, v, limit);
      for (const b of outArcs) {
        const x = aHead[b] as number;
        if (x === u) continue;
        const through = (aW[a] as number) + (aW[b] as number);
        if (seen[x] === stamp && (reach[x] as number) <= through) continue;
        found.push({ u, x, w: through, len: (aLen[a] as number) + (aLen[b] as number), a, b });
      }
    }
    return found;
  };

  const deleted = new Uint32Array(n);
  const level = new Uint32Array(n);
  const prio = new Float64Array(n);
  const priority = (v: number): number => {
    const shortcuts = plan(v).length;
    const removed = live(ins[v] as number[], aTail, v).length + live(outs[v] as number[], aHead, v).length;
    return EDGE_DIFF_WEIGHT * (shortcuts - removed) + DELETED_WEIGHT * (deleted[v] as number) + (level[v] as number);
  };

  const queue = createHeap();
  for (let v = 0; v < n; v++) {
    prio[v] = priority(v);
    queue.push(v, prio[v] as number);
  }
  const order = new Uint32Array(n);
  let rank = 0;
  while (queue.size() > 0) {
    const key = queue.popKey();
    const v = queue.node();
    if (done[v] === 1 || key !== prio[v]) continue;
    const fresh = priority(v);
    if (fresh > key && fresh > queue.peekKey()) {
      prio[v] = fresh;
      queue.push(v, fresh);
      continue;
    }
    const shortcuts = plan(v);
    const neighbours = new Set<number>();
    for (const a of live(ins[v] as number[], aTail, v)) neighbours.add(aTail[a] as number);
    for (const a of live(outs[v] as number[], aHead, v)) neighbours.add(aHead[a] as number);
    done[v] = 1;
    order[rank++] = v;
    for (const s of shortcuts) add(s.u, s.x, s.w, s.len, v);
    for (const w of [...neighbours].sort((x, y) => x - y)) {
      deleted[w] = (deleted[w] as number) + 1;
      level[w] = Math.max(level[w] as number, (level[v] as number) + 1);
      prio[w] = priority(w);
      queue.push(w, prio[w] as number);
    }
  }

  const toNew = new Uint32Array(n);
  for (let r = 0; r < n; r++) toNew[order[r] as number] = r;

  type Entry = { owner: number; other: number; w: number; len: number; via: number };
  const up: Entry[] = [];
  const down: Entry[] = [];
  for (let a = 0; a < aTail.length; a++) {
    const u = toNew[aTail[a] as number] as number;
    const v = toNew[aHead[a] as number] as number;
    const via = (aVia[a] as number) >= ORIGINAL ? (aVia[a] as number) : (toNew[aVia[a] as number] as number);
    if (u < v) up.push({ owner: u, other: v, w: aW[a] as number, len: aLen[a] as number, via });
    else down.push({ owner: v, other: u, w: aW[a] as number, len: aLen[a] as number, via });
  }
  const csr = (list: Entry[]): { first: Uint32Array; other: Uint32Array; w: Uint32Array; len: Uint32Array; via: Uint32Array } => {
    list.sort((x, y) => x.owner - y.owner || x.other - y.other);
    const first = new Uint32Array(n + 1);
    for (const e of list) first[e.owner + 1] = (first[e.owner + 1] as number) + 1;
    for (let v = 0; v < n; v++) first[v + 1] = (first[v + 1] as number) + (first[v] as number);
    return { first, other: Uint32Array.from(list, (e) => e.other), w: Uint32Array.from(list, (e) => e.w), len: Uint32Array.from(list, (e) => e.len), via: Uint32Array.from(list, (e) => e.via) };
  };
  const upCsr = csr(up);
  const downCsr = csr(down);
  const hierarchy: Hierarchy = {
    n,
    upFirst: upCsr.first,
    upTo: upCsr.other,
    upW: upCsr.w,
    upLen: upCsr.len,
    upVia: upCsr.via,
    downFirst: downCsr.first,
    downFrom: downCsr.other,
    downW: downCsr.w,
    downLen: downCsr.len,
    downVia: downCsr.via,
  };
  return { hierarchy, toNew, stats: { arcs: aTail.length, shortcuts: aTail.length - originals } };
}
