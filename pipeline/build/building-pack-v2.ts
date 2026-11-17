import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { BUILDING_CELL_DEGREES, BUILDING_CELL_ROW, BUILDING_FORMAT_V2 } from '../../src/core/address/buildings2';
import { encodeLine } from '../../src/core/region/geom';
import { nameKey } from '../../src/core/text/fold';
import { encodePostings } from '../../src/core/text/trigram';
import type { BuildingNumber, RangeRow } from './building-numbers';
import { componentsOf, floorsOf, indexOf, link, LINK_M, metres, MIN_AREA_M2, sequence, type Alt, type Cand, type Chain, type Link, type Pt } from './building-link';

export type Trace = {
  id: string;
  lon: number;
  lat: number;
  area: number;
  ring: Pt[];
  height: number | null;
  floors: number | null;
  name: string | null;
  cls: string | null;
  src: string | null;
  rec: string | null;
};

export const BUILDING2_APPLICATION_ID = 0x59474232;

export type OsmBuildingTag = { id: string; levels: number | null; name: string | null; street: string | null; number: string | null };
export type Entrance = { id: string; lon: number; lat: number; kind: string | null; ref: string | null; flats: string | null; unit: string | null };

export const BUILDING_FORMAT = BUILDING_FORMAT_V2;
const CELL_DEGREES = BUILDING_CELL_DEGREES;
const CELL_ROW = BUILDING_CELL_ROW;
const ENTRANCE_M = 15;
const REGION_CELL = 0.02;
const MIN_REGION = 8;

const cellKey = (lon: number, lat: number): number => Math.floor(lat / CELL_DEGREES) * CELL_ROW + Math.floor(lon / CELL_DEGREES);

const e6 = (v: number): number => Math.round(v * 1e6);
const num = (v: number | null | undefined): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

const shortId = (id: string): string => id.replace(/-/g, '').slice(0, 16);

const bucketOf = (area: number): number => (area < 100 ? 0 : area < 300 ? 1 : 2);

export type Door = { lon: number; lat: number; street: number };

const NEIGHBOUR_M = 45;
const SUPPORT_WEIGHT_M = 6;
const SUPPORT_CAP = 3;

function pointInRing(point: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function rerank(traces: Trace[], links: (Link | null)[], doors: Door[]): void {
  const grid = new Map<number, number[]>();
  traces.forEach((t, i) => {
    if (!links[i]) return;
    const key = cellKey(t.lon, t.lat);
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  const label = new Map<number, number>();
  for (const d of doors) {
    const cx = Math.floor(d.lon / CELL_DEGREES);
    const cy = Math.floor(d.lat / CELL_DEGREES);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) {
      for (const i of grid.get((cy + dy) * CELL_ROW + cx + dx) ?? []) {
        if (pointInRing([d.lon, d.lat], (traces[i] as Trace).ring)) {
          found = i;
          break;
        }
      }
    }
    if (found >= 0 && !label.has(found)) label.set(found, d.street);
  }
  const reach = Math.ceil(NEIGHBOUR_M / 55);
  const changes: [number, Link][] = [];
  traces.forEach((t, i) => {
    const l = links[i];
    if (!l || l.candidates.length < 2) return;
    const support = new Map<number, number>();
    const cx = Math.floor(t.lon / CELL_DEGREES);
    const cy = Math.floor(t.lat / CELL_DEGREES);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const j of grid.get((cy + dy) * CELL_ROW + cx + dx) ?? []) {
        if (j === i) continue;
        const street = label.get(j);
        if (street === undefined) continue;
        const o = traces[j] as Trace;
        if (metres([t.lon, t.lat], [o.lon, o.lat]) <= NEIGHBOUR_M) support.set(street, (support.get(street) ?? 0) + 1);
      }
    }
    if (support.size === 0) return;
    const scored = l.candidates.map((c) => ({ c, score: c.distanceM - SUPPORT_WEIGHT_M * Math.min(SUPPORT_CAP, support.get(c.chain) ?? 0) })).sort((a, b) => a.score - b.score || a.c.distanceM - b.c.distanceM);
    const best = scored.find((x) => x.c.distanceM <= LINK_M) ?? scored[0];
    if (!best) return;
    const rest = scored.filter((x) => x !== best);
    const toAlt = (x: { c: Cand } | undefined): Alt | null => (x ? { chain: x.c.chain, distanceM: x.c.distanceM } : null);
    changes.push([i, { chain: best.c.chain, component: best.c.component, side: best.c.side, distanceM: best.c.distanceM, s: best.c.s, second: toAlt(rest[0]), third: toAlt(rest[1]), candidates: l.candidates }]);
  });
  for (const [i, l] of changes) links[i] = l;
}

export type RoadLink = { id: number; distanceM: number };
export type Row = { trace: Trace; link: Link | null; road?: RoadLink | null; seq: number | null; floors: number; floorsSource: 1 | 2 | 3 | 4; osmStreet: string | null; osmNumber: string | null };

export const MIN_STORED_AREA_M2 = 1;

export function prepare(all: Trace[], chains: Chain[], tags: Map<string, OsmBuildingTag>, doors: Door[] = []): Row[] {
  const traces = all.filter((t) => t.area >= MIN_STORED_AREA_M2);
  const index = indexOf(componentsOf(chains));
  const links = traces.map((t) => link(index, { id: t.id, lon: t.lon, lat: t.lat, area: t.area, ring: t.ring }));
  if (doors.length > 0) rerank(traces, links, doors);
  const order = sequence(traces.flatMap((t, i) => (links[i] ? [{ id: t.id, link: links[i] as Link, area: t.area }] : [])));
  const known: { cell: string; bucket: number; levels: number }[] = [];
  const osmOf = (t: Trace): OsmBuildingTag | undefined => (t.rec && t.rec.startsWith('w') ? tags.get(t.rec.split('@')[0] as string) : undefined);
  for (const t of traces) {
    const levels = num(t.floors) ?? osmOf(t)?.levels ?? (num(t.height) ? Math.max(1, Math.round((t.height as number) / 3)) : null);
    if (levels !== null) known.push({ cell: `${Math.floor(t.lon / REGION_CELL)}:${Math.floor(t.lat / REGION_CELL)}:${bucketOf(t.area)}`, bucket: bucketOf(t.area), levels });
  }
  const byCell = new Map<string, number[]>();
  const byBucket = new Map<number, number[]>();
  for (const k of known) {
    byCell.set(k.cell, [...(byCell.get(k.cell) ?? []), k.levels]);
    byBucket.set(k.bucket, [...(byBucket.get(k.bucket) ?? []), k.levels]);
  }
  const regional = (t: Trace): number => {
    const cell = byCell.get(`${Math.floor(t.lon / REGION_CELL)}:${Math.floor(t.lat / REGION_CELL)}:${bucketOf(t.area)}`);
    if (cell && cell.length >= MIN_REGION) return median(cell) as number;
    return median(byBucket.get(bucketOf(t.area)) ?? []) ?? 2;
  };
  return traces.map((t, i) => {
    const osm = osmOf(t);
    const f = floorsOf({ numFloors: num(t.floors), osmLevels: osm?.levels ?? null, height: num(t.height), fallback: regional(t) });
    return { trace: t, link: links[i] ?? null, seq: order.get(t.id) ?? null, floors: f.floors, floorsSource: f.source, osmStreet: osm?.street ?? null, osmNumber: osm?.number ?? null };
  });
}

export function attachEntrances(rows: Row[], entrances: Entrance[]): Map<string, Entrance[]> {
  const grid = new Map<number, Row[]>();
  for (const r of rows) {
    const key = cellKey(r.trace.lon, r.trace.lat);
    const list = grid.get(key);
    if (list) list.push(r);
    else grid.set(key, [r]);
  }
  const out = new Map<string, Entrance[]>();
  for (const e of entrances) {
    const cx = Math.floor(e.lon / CELL_DEGREES);
    const cy = Math.floor(e.lat / CELL_DEGREES);
    let best: Row | null = null;
    let bestD = ENTRANCE_M + 20;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const r of grid.get((cy + dy) * CELL_ROW + cx + dx) ?? []) {
        const d = edgeDistance(r.trace.ring, [e.lon, e.lat]);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
    }
    if (best && bestD <= ENTRANCE_M) out.set(best.trace.id, [...(out.get(best.trace.id) ?? []), e]);
  }
  return out;
}

export function edgeDistance(ring: Pt[], p: Pt): number {
  let best = Infinity;
  const k = Math.cos((p[1] * Math.PI) / 180) * 111_320;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % ring.length] as Pt;
    const ax = (a[0] - p[0]) * k;
    const ay = (a[1] - p[1]) * 111_320;
    const bx = (b[0] - p[0]) * k;
    const by = (b[1] - p[1]) * 111_320;
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export type PlaceNode = { id: string; name: string; kind: string | null; lon: number; lat: number };
export type Settlement = { name: string; kind: string | null; lon: number; lat: number; buildings: number };

const SETTLEMENT_M = 300;
const MIN_CLUSTER = 3;

export function settlementsOf(nodes: PlaceNode[], rows: Row[]): Settlement[] {
  const grid = new Map<number, Trace[]>();
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const r of rows) {
    const key = cellKey(r.trace.lon, r.trace.lat);
    const list = grid.get(key);
    if (list) list.push(r.trace);
    else grid.set(key, [r.trace]);
    west = Math.min(west, r.trace.lon);
    east = Math.max(east, r.trace.lon);
    south = Math.min(south, r.trace.lat);
    north = Math.max(north, r.trace.lat);
  }
  const reach = Math.ceil(SETTLEMENT_M / 55) + 1;
  const out: Settlement[] = [];
  for (const node of nodes) {
    if (node.lon < west || node.lon > east || node.lat < south || node.lat > north) continue;
    const cx = Math.floor(node.lon / CELL_DEGREES);
    const cy = Math.floor(node.lat / CELL_DEGREES);
    const near: Trace[] = [];
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const t of grid.get((cy + dy) * CELL_ROW + cx + dx) ?? []) if (metres([node.lon, node.lat], [t.lon, t.lat]) <= SETTLEMENT_M) near.push(t);
    }
    if (near.length >= MIN_CLUSTER) out.push({ name: node.name, kind: node.kind, lon: median(near.map((t) => t.lon)) as number, lat: median(near.map((t) => t.lat)) as number, buildings: near.length });
    else if (near.length === 0 && grid.size > 0) continue;
    else out.push({ name: node.name, kind: node.kind, lon: node.lon, lat: node.lat, buildings: near.length });
  }
  return out;
}

export const MIN_NAME_KEY = 3;
export const MIN_NAME_LETTERS = 2;

export function namedBuildings(rows: readonly { trace: { name: string | null } }[]): [string, number][] {
  const out: [string, number][] = [];
  rows.forEach((r, i) => {
    const key = r.trace.name ? nameKey(r.trace.name) : '';
    if (key.length >= MIN_NAME_KEY && key.replace(/[\d\s]/g, '').length >= MIN_NAME_LETTERS) out.push([key, i + 1]);
  });
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}

export type PackStats = { buildings: number; linked: number; entrances: number; bytes: number };

export function writeBuildingPack(file: string, province: string, rows: Row[], entrances: Map<string, Entrance[]>, osmTimestamp: string, settlements: Settlement[] = [], hoods: (number | null)[] = [], roads: { id: number; hood: number | null; path: Pt[] }[] = [], numbers: (BuildingNumber | null)[] = [], ranges: RangeRow[] = []): PackStats {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  db.exec(`
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE building (id INTEGER PRIMARY KEY, gid TEXT NOT NULL, lon INTEGER NOT NULL, lat INTEGER NOT NULL, area INTEGER NOT NULL, ring BLOB NOT NULL, levels INTEGER NOT NULL, lsrc INTEGER NOT NULL, height INTEGER, name TEXT, chain INTEGER, comp INTEGER, side INTEGER, dist INTEGER, s INTEGER, seq INTEGER, chain2 INTEGER, dist2 INTEGER, chain3 INTEGER, dist3 INTEGER, hood INTEGER, road INTEGER, road_dist INTEGER, num TEXT, nsrc INTEGER, pnum INTEGER, prad INTEGER, pconf INTEGER, pext INTEGER);
    CREATE TABLE street_range (chain INTEGER NOT NULL, comp INTEGER NOT NULL, side INTEGER NOT NULL, parity INTEGER NOT NULL, min INTEGER NOT NULL, max INTEGER NOT NULL, pmin INTEGER, pmax INTEGER, anchors INTEGER NOT NULL, quality INTEGER NOT NULL, PRIMARY KEY (chain, comp, side)) WITHOUT ROWID;
    CREATE TABLE road (id INTEGER PRIMARY KEY, hood INTEGER, geom BLOB NOT NULL);
    CREATE TABLE building_cell (cell INTEGER PRIMARY KEY, ids BLOB NOT NULL);
    CREATE TABLE entrance (id INTEGER PRIMARY KEY, building INTEGER NOT NULL, lon INTEGER NOT NULL, lat INTEGER NOT NULL, kind TEXT, ref TEXT, flats TEXT, unit TEXT);
    CREATE TABLE building_name (key TEXT NOT NULL, id INTEGER NOT NULL, PRIMARY KEY (key, id)) WITHOUT ROWID;
    CREATE TABLE settlement (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT, lon INTEGER NOT NULL, lat INTEGER NOT NULL, n INTEGER NOT NULL);
    CREATE INDEX building_chain ON building (chain, side, seq);
    CREATE INDEX entrance_building ON entrance (building);
  `);
  db.exec('BEGIN');
  const insert = db.prepare('INSERT INTO building (id, gid, lon, lat, area, ring, levels, lsrc, height, name, chain, comp, side, dist, s, seq, chain2, dist2, chain3, dist3, hood, road, road_dist, num, nsrc, pnum, prad, pconf, pext) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const cells = new Map<number, number[]>();
  const ids = new Map<string, number>();
  let linked = 0;
  rows.forEach((r, i) => {
    const id = i + 1;
    ids.set(r.trace.id, id);
    const l = r.link;
    if (l) linked++;
    insert.run(id, shortId(r.trace.id), e6(r.trace.lon), e6(r.trace.lat), Math.round(r.trace.area), encodeLine(r.trace.ring), r.floors, r.floorsSource, num(r.trace.height) === null ? null : Math.round(num(r.trace.height) as number), r.trace.name, l ? l.chain : null, l ? l.component : null, l ? l.side : null, l ? Math.round(l.distanceM * 10) : null, l ? Math.round(l.s) : null, r.seq, l?.second ? l.second.chain : null, l?.second ? Math.round(l.second.distanceM * 10) : null, l?.third ? l.third.chain : null, l?.third ? Math.round(l.third.distanceM * 10) : null, hoods[i] ?? null, r.road ? r.road.id : null, r.road ? Math.round(r.road.distanceM * 10) : null, numbers[i]?.known ?? null, numbers[i]?.source ?? null, numbers[i]?.predicted?.value ?? null, numbers[i]?.predicted?.radiusM ?? null, numbers[i]?.predicted?.confidence ?? null, numbers[i]?.predicted ? (numbers[i]?.predicted?.extrapolated ? 1 : 0) : null);
    const xs = r.trace.ring.map((p) => p[0]);
    const ys = r.trace.ring.map((p) => p[1]);
    for (let cy = Math.floor(Math.min(...ys) / CELL_DEGREES); cy <= Math.floor(Math.max(...ys) / CELL_DEGREES); cy++) {
      for (let cx = Math.floor(Math.min(...xs) / CELL_DEGREES); cx <= Math.floor(Math.max(...xs) / CELL_DEGREES); cx++) {
        const key = cy * CELL_ROW + cx;
        const list = cells.get(key);
        if (list) list.push(id);
        else cells.set(key, [id]);
      }
    }
  });
  const insertCell = db.prepare('INSERT INTO building_cell (cell, ids) VALUES (?, ?)');
  for (const [cell, list] of [...cells].sort((a, b) => a[0] - b[0])) insertCell.run(cell, encodePostings(list));
  const insertEntrance = db.prepare('INSERT INTO entrance (id, building, lon, lat, kind, ref, flats, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let count = 0;
  for (const [gid, list] of entrances) {
    const building = ids.get(gid);
    if (!building) continue;
    for (const e of list) insertEntrance.run(++count, building, e6(e.lon), e6(e.lat), e.kind, e.ref, e.flats, e.unit);
  }
  const insertRange = db.prepare('INSERT INTO street_range (chain, comp, side, parity, min, max, pmin, pmax, anchors, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of ranges) insertRange.run(r.chain, r.component, r.side, r.parity, r.min, r.max, r.predictedMin, r.predictedMax, r.anchors, r.quality);
  const insertRoad = db.prepare('INSERT INTO road (id, hood, geom) VALUES (?, ?, ?)');
  const usedRoads = new Set(rows.flatMap((r) => (r.road ? [r.road.id] : [])));
  for (const road of roads) if (usedRoads.has(road.id)) insertRoad.run(road.id, road.hood, encodeLine(road.path));
  const insertName = db.prepare('INSERT INTO building_name (key, id) VALUES (?, ?)');
  for (const [key, id] of namedBuildings(rows)) insertName.run(key, id);
  const insertSettlement = db.prepare('INSERT INTO settlement (id, name, kind, lon, lat, n) VALUES (?, ?, ?, ?, ?, ?)');
  settlements.forEach((p, i) => insertSettlement.run(i + 1, p.name, p.kind, e6(p.lon), e6(p.lat), p.buildings));
  const meta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
  const entries: [string, string][] = [['format', BUILDING_FORMAT], ['province', province], ['osm', osmTimestamp], ['buildings', String(rows.length)], ['min_area', String(MIN_AREA_M2)]];
  for (const [k, v] of entries) meta.run(k, v);
  db.exec('COMMIT');
  db.exec(`PRAGMA user_version = ${BUILDING_FORMAT}; PRAGMA application_id = ${BUILDING2_APPLICATION_ID};`);
  db.close();
  return { buildings: rows.length, linked, entrances: count, bytes: 0 };
}
