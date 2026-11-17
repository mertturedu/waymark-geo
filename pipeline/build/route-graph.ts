import { distanceM } from '../../src/core/geo/distance';
import type { Borders } from '../../src/core/region/borders';
import { ROAD_CLASSES, ferryDeciseconds, junctionPenalty, roadKmh, speedKmh, travelDeciseconds, type RoadClass } from '../../src/core/route/speeds';
import { junctionDensity } from './route-context';

export type RoadWay = {
  id: number;
  cls: RoadClass;
  oneway: '' | 'f' | 'b';
  speed: string | null;
  ferry: boolean;
  duration: number | null;
  nodes: number[];
  coords: [number, number][];
};

export type RoadVia = { n: number } | { w: number };

export type RoadRule = { id: number; kind: 'no' | 'only'; restriction: string; from: number; to: number; via: RoadVia[] };

export type RoadRows = { ways: RoadWay[]; blocked: Set<number>; rules: RoadRule[] };

export type BaseEdge = {
  tail: number;
  head: number;
  way: number;
  seq: number;
  cls: number;
  forward: boolean;
  backward: boolean;
  lengthM: number;
  shape: number[];
  ds: [number, number];
  travel: [number, number];
};

export type BaseGraph = {
  nodeLon: number[];
  nodeLat: number[];
  nodeOsm: number[];
  edges: BaseEdge[];
  wayEdges: Map<number, number[]>;
  dropped: { nodes: number; edges: number; scraps: number };
};

export type GraphOptions = { ferries: boolean; comparison?: boolean; minComponent?: number; inside?: (lon: number, lat: number) => boolean };

export type PackSettings = { ferries: boolean; minComponent: number; plate?: string };

const MICRO = 1e6;
const MIN_JUNCTION_DEGREE = 3;
const MAX_FERRY_S = 48 * 3600;
export const PACK_OPTIONS = { ferries: true, minComponent: 100 } as const;

export function graphOptionsFor(settings: PackSettings, borders: Pick<Borders, 'provinceAt'>): GraphOptions {
  const { plate } = settings;
  return { ferries: settings.ferries, minComponent: settings.minComponent, ...(plate === undefined ? {} : { inside: (lon: number, lat: number) => borders.provinceAt(lon, lat) === plate }) };
}

export function parseRoadRows(text: string): RoadRows {
  const ways: RoadWay[] = [];
  const rules: RoadRule[] = [];
  const blocked = new Set<number>();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const row = JSON.parse(line);
    if (row.t === 'w') {
      ways.push({ id: row.id, cls: row.cls, oneway: row.o, speed: row.s ?? null, ferry: row.f === true, duration: row.d ?? null, nodes: row.n, coords: row.c });
    } else if (row.t === 'b') {
      blocked.add(row.id);
    } else if (row.t === 'r') {
      rules.push({ id: row.id, kind: row.kind, restriction: row.restriction, from: row.from, to: row.to, via: row.via });
    }
  }
  return { ways, blocked, rules };
}

type Piece = { way: RoadWay; seq: number; tail: number; head: number; shape: number[]; lengthM: number };

const micro = (degrees: number): number => Math.round(degrees * MICRO);

export function buildBaseGraph(input: RoadRows, options: GraphOptions): BaseGraph {
  const ways = input.ways.filter((w) => options.ferries || !w.ferry);
  const uses = new Map<number, number>();
  for (const w of ways) {
    for (const id of w.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
    for (const end of [w.nodes[0], w.nodes[w.nodes.length - 1]]) uses.set(end as number, (uses.get(end as number) ?? 0) + 1);
  }
  for (const rule of input.rules) for (const via of rule.via) if ('n' in via) uses.set(via.n, (uses.get(via.n) ?? 0) + 2);

  const nodeLon: number[] = [];
  const nodeLat: number[] = [];
  const nodeOsm: number[] = [];
  const interned = new Map<number, number>();
  const makeNode = (osm: number, lon: number, lat: number): number => {
    nodeLon.push(micro(lon));
    nodeLat.push(micro(lat));
    nodeOsm.push(osm);
    return nodeLon.length - 1;
  };
  const sharedNode = (osm: number, point: [number, number]): number => {
    const known = interned.get(osm);
    if (known !== undefined) return known;
    const made = makeNode(osm, point[0], point[1]);
    interned.set(osm, made);
    return made;
  };
  const stopNode = (osm: number, point: [number, number]): number => (input.blocked.has(osm) ? makeNode(-1, point[0], point[1]) : sharedNode(osm, point));

  const pieces: Piece[] = [];
  for (const way of ways) {
    const last = way.nodes.length - 1;
    let tail = stopNode(way.nodes[0] as number, way.coords[0] as [number, number]);
    let shape: number[] = [];
    let lengthM = 0;
    let previous = way.coords[0] as [number, number];
    let seq = 0;
    for (let i = 1; i <= last; i++) {
      const osm = way.nodes[i] as number;
      const at = way.coords[i] as [number, number];
      lengthM += distanceM(previous, at);
      previous = at;
      const blockedHere = input.blocked.has(osm);
      if (i === last || blockedHere || (uses.get(osm) ?? 0) >= 2) {
        const head = i === last || blockedHere ? stopNode(osm, at) : sharedNode(osm, at);
        if (tail !== head || lengthM > 0) pieces.push({ way, seq: seq++, tail, head, shape, lengthM });
        tail = blockedHere && i < last ? makeNode(-1, at[0], at[1]) : head;
        shape = [];
        lengthM = 0;
      } else {
        shape.push(micro(at[0]), micro(at[1]));
      }
    }
  }

  const degree = new Array<number>(nodeLon.length).fill(0);
  for (const p of pieces) {
    degree[p.tail] = (degree[p.tail] as number) + 1;
    degree[p.head] = (degree[p.head] as number) + 1;
  }
  const density = junctionDensity(nodeLon, nodeLat, (v) => (degree[v] as number) >= MIN_JUNCTION_DEGREE);
  const totals = new Map<number, number>();
  for (const p of pieces) totals.set(p.way.id, (totals.get(p.way.id) ?? 0) + p.lengthM);

  const edges: BaseEdge[] = [];
  const wayEdges = new Map<number, number[]>();
  for (const p of pieces) {
    const { way } = p;
    const midLon = ((nodeLon[p.tail] as number) + (nodeLon[p.head] as number)) / 2;
    const midLat = ((nodeLat[p.tail] as number) + (nodeLat[p.head] as number)) / 2;
    const kmh = options.comparison === true ? speedKmh(way.cls, way.speed) : roadKmh(way.cls, way.speed, { near: density.near(midLon, midLat), wide: density.wide(midLon, midLat), lengthM: p.lengthM });
    const share = (totals.get(way.id) as number) > 0 ? p.lengthM / (totals.get(way.id) as number) : 1;
    const base = way.ferry
      ? ferryDeciseconds(p.lengthM, way.duration === null || way.duration > MAX_FERRY_S ? null : way.duration * share, p.seq === 0)
      : travelDeciseconds(p.lengthM, kmh);
    const penalty = way.ferry || options.comparison === true ? [0, 0] : [degree[p.head] as number, degree[p.tail] as number].map((d) => (d >= MIN_JUNCTION_DEGREE ? junctionPenalty(way.cls) : 0));
    const forward = way.oneway !== 'b';
    const backward = way.oneway !== 'f';
    const index = edges.length;
    edges.push({
      tail: p.tail,
      head: p.head,
      way: way.id,
      seq: p.seq,
      cls: ROAD_CLASSES.indexOf(way.cls),
      forward,
      backward,
      lengthM: p.lengthM,
      shape: p.shape,
      ds: [forward ? base + (penalty[0] as number) : 0, backward ? base + (penalty[1] as number) : 0],
      travel: [forward ? base : 0, backward ? base : 0],
    });
    const list = wayEdges.get(way.id);
    if (list) list.push(index);
    else wayEdges.set(way.id, [index]);
  }
  return dropScraps({ nodeLon, nodeLat, nodeOsm, edges, wayEdges, dropped: { nodes: 0, edges: 0, scraps: 0 } }, options.minComponent ?? 1, options.inside);
}

function dropScraps(graph: BaseGraph, minimum: number, inside?: (lon: number, lat: number) => boolean): BaseGraph {
  const n = graph.nodeLon.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root] as number;
    for (let at = x; parent[at] !== root; ) {
      const next = parent[at] as number;
      parent[at] = root;
      at = next;
    }
    return root;
  };
  for (const e of graph.edges) {
    const a = find(e.tail);
    const b = find(e.head);
    if (a !== b) parent[a] = b;
  }
  const size = new Map<number, number>();
  for (let v = 0; v < n; v++) size.set(find(v), (size.get(find(v)) ?? 0) + 1);
  const touches = new Set<number>();
  if (inside) for (let v = 0; v < n; v++) if (inside((graph.nodeLon[v] as number) / MICRO, (graph.nodeLat[v] as number) / MICRO)) touches.add(find(v));
  const keep = (v: number): boolean => (size.get(find(v)) as number) >= minimum && (!inside || touches.has(find(v)));
  const survivors = new Int32Array(n).fill(-1);
  let count = 0;
  for (let v = 0; v < n; v++) if (keep(v)) survivors[v] = count++;
  if (count === n) return graph;
  const nodeLon: number[] = [];
  const nodeLat: number[] = [];
  const nodeOsm: number[] = [];
  for (let v = 0; v < n; v++) {
    if (survivors[v] === -1) continue;
    nodeLon.push(graph.nodeLon[v] as number);
    nodeLat.push(graph.nodeLat[v] as number);
    nodeOsm.push(graph.nodeOsm[v] as number);
  }
  const edges: BaseEdge[] = [];
  const wayEdges = new Map<number, number[]>();
  for (const e of graph.edges) {
    if (survivors[e.tail] === -1) continue;
    edges.push({ ...e, tail: survivors[e.tail] as number, head: survivors[e.head] as number });
    const list = wayEdges.get(e.way);
    if (list) list.push(edges.length - 1);
    else wayEdges.set(e.way, [edges.length - 1]);
  }
  const scraps = new Set<number>();
  for (let v = 0; v < n; v++) if (survivors[v] === -1) scraps.add(find(v));
  return { nodeLon, nodeLat, nodeOsm, edges, wayEdges, dropped: { nodes: n - count, edges: graph.edges.length - edges.length, scraps: scraps.size } };
}
