import type { BaseGraph, RoadRule } from './route-graph';

export type RoadGraph = {
  base: BaseGraph;
  nodeCount: number;
  nodeBase: Uint32Array;
  arcTail: Uint32Array;
  arcHead: Uint32Array;
  arcDs: Uint32Array;
  arcPa: Uint32Array;
  entry: Map<number, number>;
  exits: Map<number, number[]>;
  report: { rules: number; applied: number; skipped: Record<string, number>; copies: number };
};

type Trie = { kids: Map<number, number>; banned: Set<number>; only: Set<number> | null; last: number; seq: number[] };

const MAX_COMBOS = 16;
const MICRO = 1e6;
const RAD = Math.PI / 180;

const edgeOf = (pa: number): number => pa >> 1;

function tailOf(g: BaseGraph, pa: number): number {
  const e = g.edges[edgeOf(pa)]!;
  return (pa & 1) === 0 ? e.tail : e.head;
}

function headOf(g: BaseGraph, pa: number): number {
  const e = g.edges[edgeOf(pa)]!;
  return (pa & 1) === 0 ? e.head : e.tail;
}

function usable(g: BaseGraph, pa: number): boolean {
  const e = g.edges[edgeOf(pa)]!;
  return (pa & 1) === 0 ? e.forward : e.backward;
}

function points(g: BaseGraph, pa: number): [number, number][] {
  const e = g.edges[edgeOf(pa)]!;
  const line: [number, number][] = [[g.nodeLon[e.tail] as number, g.nodeLat[e.tail] as number]];
  for (let i = 0; i < e.shape.length; i += 2) line.push([e.shape[i] as number, e.shape[i + 1] as number]);
  line.push([g.nodeLon[e.head] as number, g.nodeLat[e.head] as number]);
  return (pa & 1) === 0 ? line : line.reverse();
}

function bearing(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2 / MICRO) * RAD);
  return Math.atan2(dx, b[1] - a[1]) / RAD;
}

function turnAngle(g: BaseGraph, from: number, to: number): number {
  const before = points(g, from);
  const after = points(g, to);
  let angle = bearing(after[0] as [number, number], after[1] as [number, number]) - bearing(before[before.length - 2] as [number, number], before[before.length - 1] as [number, number]);
  while (angle > 180) angle -= 360;
  while (angle <= -180) angle += 360;
  return angle;
}

function fitsTurn(restriction: string, angle: number): boolean {
  if (restriction.endsWith('u_turn')) return Math.abs(angle) > 160;
  if (restriction.endsWith('left_turn')) return angle <= -20 && angle >= -160;
  if (restriction.endsWith('right_turn')) return angle >= 20 && angle <= 160;
  if (restriction.endsWith('straight_on')) return Math.abs(angle) < 45;
  return true;
}

type Lookup = { g: BaseGraph; byOsm: Map<number, number> };

function arrivals({ g }: Lookup, way: number, node: number): number[] {
  const out: number[] = [];
  for (const index of g.wayEdges.get(way) ?? []) {
    for (const pa of [2 * index, 2 * index + 1]) if (usable(g, pa) && headOf(g, pa) === node) out.push(pa);
  }
  return out;
}

function departures({ g }: Lookup, way: number, node: number): number[] {
  const out: number[] = [];
  for (const index of g.wayEdges.get(way) ?? []) {
    for (const pa of [2 * index, 2 * index + 1]) if (usable(g, pa) && tailOf(g, pa) === node) out.push(pa);
  }
  return out;
}

function sharedNodes({ g, byOsm }: Lookup, a: number, b: number): number[] {
  const ends = (way: number): Set<number> => {
    const set = new Set<number>();
    for (const index of g.wayEdges.get(way) ?? []) {
      const e = g.edges[index]!;
      if (g.nodeOsm[e.tail] !== -1) set.add(e.tail);
      if (g.nodeOsm[e.head] !== -1) set.add(e.head);
    }
    return set;
  };
  const left = ends(a);
  const right = ends(b);
  return [...left].filter((v) => right.has(v) && byOsm.get(g.nodeOsm[v] as number) === v).sort((x, y) => x - y);
}

function walk({ g }: Lookup, way: number, from: number, to: number): number[][] {
  const list = g.wayEdges.get(way) ?? [];
  const found: number[][] = [];
  if (from === to) return found;
  for (let i = 0; i < list.length; i++) {
    if (g.edges[list[i] as number]!.tail !== from) continue;
    const path: number[] = [];
    for (let j = i; j < list.length; j++) {
      const index = list[j] as number;
      if (!g.edges[index]!.forward || (j > i && g.edges[list[j - 1] as number]!.head !== g.edges[index]!.tail)) break;
      path.push(2 * index);
      if (g.edges[index]!.head === to) {
        found.push(path);
        break;
      }
    }
    break;
  }
  for (let i = 0; i < list.length; i++) {
    if (g.edges[list[i] as number]!.head !== from) continue;
    const path: number[] = [];
    for (let j = i; j >= 0; j--) {
      const index = list[j] as number;
      if (!g.edges[index]!.backward || (j < i && g.edges[list[j + 1] as number]!.tail !== g.edges[index]!.head)) break;
      path.push(2 * index + 1);
      if (g.edges[index]!.tail === to) {
        found.push(path);
        break;
      }
    }
    break;
  }
  return found;
}

function nodeTurns(look: Lookup, rule: RoadRule, via: number): number[][] {
  const node = look.byOsm.get(via);
  if (node === undefined) return [];
  const ins = arrivals(look, rule.from, node);
  const outs = departures(look, rule.to, node);
  let pairs: number[][] = [];
  if (rule.restriction.endsWith('u_turn') && rule.from === rule.to) {
    for (const pa of ins) if (outs.includes(pa ^ 1)) pairs.push([pa, pa ^ 1]);
  } else {
    for (const a of ins) for (const b of outs) pairs.push([a, b]);
  }
  if (pairs.length > 1) {
    const fitting = pairs.filter(([a, b]) => fitsTurn(rule.restriction, turnAngle(look.g, a as number, b as number)));
    if (fitting.length > 0) pairs = fitting;
  }
  return pairs;
}

function wayTurns(look: Lookup, rule: RoadRule): number[][] {
  const chain = [rule.from, ...rule.via.map((v) => ('w' in v ? v.w : -1)), rule.to];
  if (chain.includes(-1)) return [];
  const results: number[][] = [];
  const grow = (step: number, at: number, arcs: number[]): void => {
    if (results.length >= MAX_COMBOS) return;
    if (step === chain.length - 1) {
      for (const out of departures(look, chain[step] as number, at)) results.push([...arcs, out]);
      return;
    }
    for (const next of sharedNodes(look, chain[step] as number, chain[step + 1] as number).slice(0, 4)) {
      for (const path of walk(look, chain[step] as number, at, next)) grow(step + 1, next, [...arcs, ...path]);
    }
  };
  const first = sharedNodes(look, chain[0] as number, chain[1] as number).slice(0, 4);
  for (const start of first) {
    for (const incoming of arrivals(look, chain[0] as number, start)) {
      for (const next of [start]) grow(1, next, [incoming]);
    }
  }
  if (results.length > 1) {
    const fitting = results.filter((seq) => fitsTurn(rule.restriction, turnAngle(look.g, seq[0] as number, seq[seq.length - 1] as number)));
    if (fitting.length > 0) return fitting;
  }
  return results;
}

export function applyRestrictions(base: BaseGraph, rules: RoadRule[]): RoadGraph {
  const byOsm = new Map<number, number>();
  base.nodeOsm.forEach((osm, index) => {
    if (osm >= 0) byOsm.set(osm, index);
  });
  const look: Lookup = { g: base, byOsm };
  const trie: Trie[] = [{ kids: new Map(), banned: new Set(), only: null, last: -1, seq: [] }];
  const byKey = new Map<string, number>();
  const insert = (prefix: number[]): number => {
    let at = 0;
    for (const pa of prefix) {
      let kid = trie[at]!.kids.get(pa);
      if (kid === undefined) {
        kid = trie.length;
        trie.push({ kids: new Map(), banned: new Set(), only: null, last: pa, seq: [...trie[at]!.seq, pa] });
        trie[at]!.kids.set(pa, kid);
        byKey.set(trie[kid]!.seq.join(','), kid);
      }
      at = kid;
    }
    return at;
  };

  const report = { rules: rules.length, applied: 0, skipped: {} as Record<string, number>, copies: 0 };
  for (const rule of rules) {
    const first = rule.via[0];
    const sequences = first && 'n' in first && rule.via.length === 1 ? nodeTurns(look, rule, first.n) : wayTurns(look, rule);
    if (sequences.length === 0) {
      report.skipped['no-arcs'] = (report.skipped['no-arcs'] ?? 0) + 1;
      continue;
    }
    report.applied++;
    for (const seq of sequences) {
      const at = insert(seq.slice(0, -1));
      const last = seq[seq.length - 1] as number;
      if (rule.kind === 'no') trie[at]!.banned.add(last);
      else (trie[at]!.only ??= new Set()).add(last);
    }
  }

  const nodes = base.nodeLon.length;
  const out: number[][] = Array.from({ length: nodes }, () => []);
  for (let pa = 0; pa < base.edges.length * 2; pa++) if (usable(base, pa)) out[tailOf(base, pa)]!.push(pa);

  const tail: number[] = [];
  const head: number[] = [];
  const ds: number[] = [];
  const arcPa: number[] = [];
  const exits = new Map<number, number[]>();
  const entry = new Map<number, number>();
  const nodeOf = (t: number): number => nodes + t - 1;
  const suffixes = (t: number): number[] => {
    const seq = trie[t]!.seq;
    const found: number[] = [];
    for (let i = 1; i < seq.length; i++) {
      const state = byKey.get(seq.slice(i).join(','));
      if (state !== undefined) found.push(state);
    }
    return found;
  };
  const effective = trie.map((_, t) => {
    if (t === 0) return { banned: new Set<number>(), only: null as Set<number> | null };
    const banned = new Set(trie[t]!.banned);
    let only = trie[t]!.only === null ? null : new Set(trie[t]!.only);
    for (const state of suffixes(t)) {
      for (const pa of trie[state]!.banned) banned.add(pa);
      const narrower = trie[state]!.only;
      if (narrower !== null) only = only === null ? new Set(narrower) : new Set([...only].filter((pa) => narrower.has(pa)));
    }
    return { banned, only };
  });
  const next = (t: number, pa: number): number => {
    const seq = trie[t]!.seq;
    for (let i = 0; i <= seq.length; i++) {
      const state = i === seq.length ? trie[0]!.kids.get(pa) : byKey.get([...seq.slice(i), pa].join(','));
      if (state !== undefined) return nodeOf(state);
    }
    return -1;
  };
  const emit = (t: number, state: number, v: number): void => {
    const options = out[v] as number[];
    const rules = effective[t]!;
    for (const pa of options) {
      if (t > 0 && (rules.banned.has(pa) || (rules.only !== null && !rules.only.has(pa)))) continue;
      if (t > 0 && pa === (trie[t]!.last ^ 1) && options.length > 1) continue;
      const target = next(t, pa);
      tail.push(state);
      head.push(target === -1 ? headOf(base, pa) : target);
      ds.push(base.edges[edgeOf(pa)]!.ds[pa & 1] as number);
      arcPa.push(pa);
      if (t > 0) {
        const list = exits.get(pa);
        if (list) list.push(state);
        else exits.set(pa, [state]);
      }
    }
  };
  for (let v = 0; v < nodes; v++) emit(0, v, v);
  for (let t = 1; t < trie.length; t++) emit(t, nodeOf(t), headOf(base, trie[t]!.last));
  for (const [pa, kid] of trie[0]!.kids) entry.set(pa, nodeOf(kid));

  const nodeBase = new Uint32Array(nodes + trie.length - 1);
  for (let v = 0; v < nodes; v++) nodeBase[v] = v;
  for (let t = 1; t < trie.length; t++) nodeBase[nodeOf(t)] = headOf(base, trie[t]!.last);
  report.copies = trie.length - 1;
  return {
    base,
    nodeCount: nodeBase.length,
    nodeBase,
    arcTail: Uint32Array.from(tail),
    arcHead: Uint32Array.from(head),
    arcDs: Uint32Array.from(ds),
    arcPa: Uint32Array.from(arcPa),
    entry,
    exits,
    report,
  };
}

export function entryNode(g: RoadGraph, pa: number): number {
  return g.entry.get(pa) ?? headOf(g.base, pa);
}

export function exitNodes(g: RoadGraph, pa: number): number[] {
  return [tailOf(g.base, pa), ...(g.exits.get(pa) ?? [])];
}
