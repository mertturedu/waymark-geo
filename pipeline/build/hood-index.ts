import { DatabaseSync } from 'node:sqlite';
import { decodeRings, pointInRings, type Point, type Polygon } from '../../src/core/region/geom';

const GRID_DEGREES = 0.02;
const SOURCE_OSM_POLYGON = 0;

type Entry = { id: number; source: number; rings: Polygon[]; box: [number, number, number, number]; center: Point | null };

export type HoodIndex = { at(lon: number, lat: number): number | null };

const boxOf = (rings: Polygon[]): [number, number, number, number] => {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of rings) for (const [x, y] of polygon[0] ?? []) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
};

export function createHoodIndex(entries: { id: number; source: number; rings: Polygon[]; center: Point | null }[]): HoodIndex {
  const list: Entry[] = entries.filter((e) => e.rings.length > 0).map((e) => ({ ...e, box: boxOf(e.rings) }));
  const grid = new Map<string, Entry[]>();
  for (const entry of list) {
    for (let x = Math.floor(entry.box[0] / GRID_DEGREES); x <= Math.floor(entry.box[2] / GRID_DEGREES); x++) {
      for (let y = Math.floor(entry.box[1] / GRID_DEGREES); y <= Math.floor(entry.box[3] / GRID_DEGREES); y++) {
        const key = `${x}:${y}`;
        const cell = grid.get(key);
        if (cell) cell.push(entry);
        else grid.set(key, [entry]);
      }
    }
  }
  return {
    at(lon, lat) {
      const hits = (grid.get(`${Math.floor(lon / GRID_DEGREES)}:${Math.floor(lat / GRID_DEGREES)}`) ?? []).filter((e) => lon >= e.box[0] && lon <= e.box[2] && lat >= e.box[1] && lat <= e.box[3] && pointInRings([lon, lat], e.rings));
      if (hits.length === 0) return null;
      const osm = hits.filter((e) => e.source === SOURCE_OSM_POLYGON);
      const pool = osm.length > 0 ? osm : hits;
      if (pool.length === 1) return (pool[0] as Entry).id;
      const near = (e: Entry): number => (e.center ? Math.hypot(e.center[0] - lon, e.center[1] - lat) : Infinity);
      return [...pool].sort((a, b) => near(a) - near(b) || a.id - b.id)[0]?.id ?? null;
    },
  };
}

export function readHoodIndex(addressFile: string): HoodIndex {
  const db = new DatabaseSync(addressFile, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, source, cx, cy, poly FROM neighbourhood WHERE poly IS NOT NULL ORDER BY id').all() as { id: number; source: number; cx: number | null; cy: number | null; poly: Uint8Array }[];
    return createHoodIndex(rows.map((r) => ({ id: r.id, source: r.source, rings: decodeRings(r.poly), center: r.cx === null || r.cy === null ? null : ([r.cx / 1e6, (r.cy as number) / 1e6] as Point) })));
  } finally {
    db.close();
  }
}
