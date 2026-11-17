export type Pt = [number, number];
export type Chain = { id: number; name: string; lines: Pt[][] };
export type Component = { chain: number; index: number; path: Pt[]; cumulative: number[] };
export type Trace = { id: string; lon: number; lat: number; area: number; ring?: Pt[] };

export type Alt = { chain: number; distanceM: number };

export type Cand = { chain: number; component: number; side: 1 | -1; s: number; distanceM: number };

export type Link = {
  chain: number;
  component: number;
  side: 1 | -1;
  distanceM: number;
  s: number;
  second: Alt | null;
  third: Alt | null;
  candidates: Cand[];
};

export const LINK_M = 60;
export const ALTERNATIVE_M = 100;
const EDGE_REACH_M = 60;
const EDGE_SKIP_M = 8;
const CELL = 0.0006;
const M_PER_DEGREE = 111_320;
const JOIN_M = 12;

const scaleOf = (lat: number): number => Math.cos((lat * Math.PI) / 180);
export const metres = (a: Pt, b: Pt): number => Math.hypot((a[0] - b[0]) * M_PER_DEGREE * scaleOf((a[1] + b[1]) / 2), (a[1] - b[1]) * M_PER_DEGREE);

function orderInto(lines: Pt[][]): Pt[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  const out: Pt[][] = [];
  while (pool.length > 0) {
    let path = pool.shift() as Pt[];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const other = pool[i] as Pt[];
        const head = path[0] as Pt;
        const tail = path[path.length - 1] as Pt;
        const oHead = other[0] as Pt;
        const oTail = other[other.length - 1] as Pt;
        let joined: Pt[] | null = null;
        if (metres(tail, oHead) <= JOIN_M) joined = [...path, ...other.slice(1)];
        else if (metres(tail, oTail) <= JOIN_M) joined = [...path, ...[...other].reverse().slice(1)];
        else if (metres(head, oTail) <= JOIN_M) joined = [...other, ...path.slice(1)];
        else if (metres(head, oHead) <= JOIN_M) joined = [...[...other].reverse(), ...path.slice(1)];
        if (joined) {
          path = joined;
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    out.push(path);
  }
  return out;
}

export function componentsOf(chains: Chain[]): Component[] {
  const out: Component[] = [];
  for (const chain of chains) {
    orderInto(chain.lines).forEach((path, index) => {
      const cumulative = [0];
      for (let i = 1; i < path.length; i++) cumulative.push((cumulative[i - 1] as number) + metres(path[i - 1] as Pt, path[i] as Pt));
      out.push({ chain: chain.id, index, path, cumulative });
    });
  }
  return out;
}

type Segment = { component: number; i: number };
export type Index = { components: Component[]; grid: Map<string, Segment[]> };

const cellKey = (x: number, y: number): string => `${x}:${y}`;

export function indexOf(components: Component[]): Index {
  const grid = new Map<string, Segment[]>();
  components.forEach((component, c) => {
    for (let i = 1; i < component.path.length; i++) {
      const a = component.path[i - 1] as Pt;
      const b = component.path[i] as Pt;
      const x0 = Math.floor(Math.min(a[0], b[0]) / CELL) - 1;
      const x1 = Math.floor(Math.max(a[0], b[0]) / CELL) + 1;
      const y0 = Math.floor(Math.min(a[1], b[1]) / CELL) - 1;
      const y1 = Math.floor(Math.max(a[1], b[1]) / CELL) + 1;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = cellKey(x, y);
        const list = grid.get(key);
        if (list) list.push({ component: c, i });
        else grid.set(key, [{ component: c, i }]);
      }
    }
  });
  return { components, grid };
}

export type Hit = { component: number; distanceM: number; side: 1 | -1; s: number; theta: number };

function project(p: Pt, a: Pt, b: Pt): { t: number; distanceM: number; side: 1 | -1; theta: number } {
  const k = scaleOf(p[1]) * M_PER_DEGREE;
  const ax = (a[0] - p[0]) * k;
  const ay = (a[1] - p[1]) * M_PER_DEGREE;
  const bx = (b[0] - p[0]) * k;
  const by = (b[1] - p[1]) * M_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  const cross = dx * -ay - dy * -ax;
  return { t, distanceM: Math.hypot(ax + t * dx, ay + t * dy), side: cross >= 0 ? 1 : -1, theta: Math.atan2(dy, dx) };
}

export function nearestByChain(index: Index, p: Pt, limitM: number): Map<number, Hit> {
  const best = new Map<number, Hit>();
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const seen = new Set<string>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const seg of index.grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
      const tag = `${seg.component}:${seg.i}`;
      if (seen.has(tag)) continue;
      seen.add(tag);
      const component = index.components[seg.component] as Component;
      const a = component.path[seg.i - 1] as Pt;
      const b = component.path[seg.i] as Pt;
      const hit = project(p, a, b);
      if (hit.distanceM > limitM) continue;
      const s = (component.cumulative[seg.i - 1] as number) + hit.t * ((component.cumulative[seg.i] as number) - (component.cumulative[seg.i - 1] as number));
      const known = best.get(component.chain);
      if (!known || hit.distanceM < known.distanceM) best.set(component.chain, { component: seg.component, distanceM: hit.distanceM, side: hit.side, s, theta: hit.theta });
    }
  }
  return best;
}

const SAMPLE_VERTICES = 6;
const CANDIDATES = 5;

function sampled(ring: Pt[]): Pt[] {
  if (ring.length <= SAMPLE_VERTICES) return ring;
  const step = ring.length / SAMPLE_VERTICES;
  return Array.from({ length: SAMPLE_VERTICES }, (_, i) => ring[Math.floor(i * step)] as Pt);
}

export function link(index: Index, trace: Trace, limitM = LINK_M): Link | null {
  const reach = Math.max(limitM, ALTERNATIVE_M);
  const centre = nearestByChain(index, [trace.lon, trace.lat], reach + (trace.ring ? EDGE_REACH_M : 0));
  const edge = new Map<number, number>();
  for (const [chain, hit] of centre) edge.set(chain, hit.distanceM);
  let nearest = Infinity;
  for (const hit of centre.values()) nearest = Math.min(nearest, hit.distanceM);
  if (trace.ring && nearest > EDGE_SKIP_M) {
    for (const vertex of sampled(trace.ring)) {
      for (const [chain, hit] of nearestByChain(index, vertex, reach)) if (hit.distanceM < (edge.get(chain) ?? Infinity)) edge.set(chain, hit.distanceM);
    }
  }
  const near = [...edge].filter(([, d]) => d <= reach).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const first = near[0];
  if (!first || first[1] > limitM) return null;
  const reference = centre.get(first[0]);
  if (!reference) return null;
  const alt = (entry: [number, number] | undefined): Alt | null => (entry ? { chain: entry[0], distanceM: Math.round(entry[1] * 10) / 10 } : null);
  const candidates: Cand[] = [];
  for (const [chain, distance] of near.slice(0, CANDIDATES)) {
    const hit = centre.get(chain);
    if (hit) candidates.push({ chain, component: hit.component, side: hit.side, s: Math.round(hit.s * 10) / 10, distanceM: Math.round(distance * 10) / 10 });
  }
  return { chain: first[0], component: reference.component, side: reference.side, distanceM: Math.round(first[1] * 10) / 10, s: Math.round(reference.s * 10) / 10, second: alt(near[1]), third: alt(near[2]), candidates };
}

export const MIN_AREA_M2 = 25;

export function sequence(links: { id: string; link: Link; area: number }[]): Map<string, number> {
  const groups = new Map<string, { id: string; s: number }[]>();
  for (const item of links) {
    if (item.area < MIN_AREA_M2) continue;
    const key = `${item.link.component}:${item.link.side}`;
    const list = groups.get(key) ?? [];
    list.push({ id: item.id, s: item.link.s });
    groups.set(key, list);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
    list.forEach((entry, rank) => out.set(entry.id, rank + 1));
  }
  return out;
}

export function floorsOf(input: { numFloors: number | null; osmLevels: number | null; height: number | null; fallback: number }): { floors: number; source: 1 | 2 | 3 | 4 } {
  if (input.numFloors !== null && input.numFloors > 0) return { floors: Math.round(input.numFloors), source: 1 };
  if (input.osmLevels !== null && input.osmLevels > 0) return { floors: Math.round(input.osmLevels), source: 2 };
  if (input.height !== null && input.height > 0) return { floors: Math.max(1, Math.round(input.height / 3)), source: 3 };
  return { floors: input.fallback, source: 4 };
}
