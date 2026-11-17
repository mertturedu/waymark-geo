import type { Label } from './ch-query';
import { FLAG, type RoutePack } from './format';
import { ROAD_CLASSES, junctionPenalty } from './speeds';
import type { Snap } from './snap';

export type ArcLabel = Label & { pa: number };

const find = (keys: Uint32Array, key: number): number => {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((keys[mid] as number) < key) low = mid + 1;
    else high = mid;
  }
  return low < keys.length && keys[low] === key ? low : -1;
};

function fraction(pack: RoutePack, snap: Snap): number {
  const length = pack.edges.length[snap.edge] as number;
  return length === 0 ? 0 : Math.min(1, Math.max(0, snap.offsetM / length));
}

function usable(pack: RoutePack, pa: number): boolean {
  return ((pack.edges.flags[pa >> 1] as number) & ((pa & 1) === 0 ? FLAG.forward : FLAG.backward)) !== 0;
}

function penalty(pack: RoutePack, pa: number): number {
  const flags = pack.edges.flags[pa >> 1] as number;
  const on = (pa & 1) === 0 ? FLAG.penaltyForward : FLAG.penaltyBackward;
  return (flags & on) !== 0 ? junctionPenalty(ROAD_CLASSES[flags >> FLAG.classShift] ?? 'residential') : 0;
}

export function arcWeight(pack: RoutePack, pa: number): number {
  return (pack.edges.travel[pa] as number) + penalty(pack, pa);
}

export function entryNode(pack: RoutePack, pa: number): number {
  const at = find(pack.entry.key, pa);
  if (at >= 0) return pack.entry.node[at] as number;
  const edge = pa >> 1;
  return pack.base.node[(pa & 1) === 0 ? (pack.edges.head[edge] as number) : (pack.edges.tail[edge] as number)] as number;
}

export function exitNodes(pack: RoutePack, pa: number): number[] {
  const edge = pa >> 1;
  const out = [pack.base.node[(pa & 1) === 0 ? (pack.edges.tail[edge] as number) : (pack.edges.head[edge] as number)] as number];
  const keys = pack.exits.key;
  const at = find(keys, pa);
  if (at < 0) return out;
  for (let k = at; k < keys.length && keys[k] === pa; k++) out.push(pack.exits.node[k] as number);
  return out;
}

export function sourceLabels(pack: RoutePack, snap: Snap): ArcLabel[] {
  const f = fraction(pack, snap);
  const out: ArcLabel[] = [];
  for (const dir of [0, 1]) {
    const pa = 2 * snap.edge + dir;
    if (!usable(pack, pa)) continue;
    const left = dir === 0 ? 1 - f : f;
    out.push({
      node: entryNode(pack, pa),
      w: Math.round((pack.edges.travel[pa] as number) * left) + penalty(pack, pa),
      len: Math.round((pack.edges.length[snap.edge] as number) * left),
      pa,
    });
  }
  return out;
}

export function targetLabels(pack: RoutePack, snap: Snap): ArcLabel[] {
  const f = fraction(pack, snap);
  const out: ArcLabel[] = [];
  for (const dir of [0, 1]) {
    const pa = 2 * snap.edge + dir;
    if (!usable(pack, pa)) continue;
    const done = dir === 0 ? f : 1 - f;
    const w = Math.round((pack.edges.travel[pa] as number) * done);
    const len = Math.round((pack.edges.length[snap.edge] as number) * done);
    for (const node of exitNodes(pack, pa)) out.push({ node, w, len, pa });
  }
  return out;
}

export function sameEdgeCost(pack: RoutePack, from: Snap, to: Snap): { w: number; len: number; pa: number } | null {
  if (from.edge !== to.edge) return null;
  const a = fraction(pack, from);
  const b = fraction(pack, to);
  const edge = from.edge;
  const length = pack.edges.length[edge] as number;
  let best: { w: number; len: number; pa: number } | null = null;
  if (usable(pack, 2 * edge) && b >= a) best = { w: Math.round((pack.edges.travel[2 * edge] as number) * (b - a)), len: Math.round(length * (b - a)), pa: 2 * edge };
  if (usable(pack, 2 * edge + 1) && a >= b) {
    const w = Math.round((pack.edges.travel[2 * edge + 1] as number) * (a - b));
    if (best === null || w < best.w) best = { w, len: Math.round(length * (a - b)), pa: 2 * edge + 1 };
  }
  return best;
}
