import { createReadStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInterface } from 'node:readline';
import { cellOf } from '../../src/core/geo/cells';
import { createWriter } from '../../src/core/region/geom';
import { centroidRatio, indexBuildings, nearStreet, qualifies, sampleDoors, type Building } from './building-select';

export const BUILDING_FORMAT = 1;
export const CELL_E6 = 2000;
const ROW = 65536;
export const APPLICATION_ID = 0x59474254;

export type BuildingPackInput = { province: string; workDir: string; addressFile: string; outFile: string; osmTimestamp: string };
export type BuildingPackResult = { written: boolean; ratio: number; buildings: number; bytes: number };

async function readBuildings(file: string): Promise<Building[]> {
  const out: Building[] = [];
  if (!existsSync(file)) return out;
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (line === '') continue;
    const row = JSON.parse(line) as { id: string; lon: number; lat: number; area_m2: number };
    out.push({ id: row.id, lng: row.lon, lat: row.lat, area: row.area_m2 });
  }
  return out;
}

export function encodeCell(points: { x: number; y: number }[]): Uint8Array {
  const writer = createWriter();
  writer.varint(points.length);
  for (const p of points) {
    writer.varint(p.x);
    writer.varint(p.y);
  }
  return Uint8Array.from(writer.bytes);
}

export async function buildBuildingPack(input: BuildingPackInput): Promise<BuildingPackResult> {
  const buildings = await readBuildings(join(input.workDir, 'buildings', input.province, 'buildings.jsonl'));
  const source = new DatabaseSync(input.addressFile, { readOnly: true });
  let doors;
  let streetCells: Set<number>;
  try {
    doors = (source.prepare('SELECT id, lon, lat FROM address ORDER BY id').all() as { id: number; lon: number; lat: number }[]).map((r) => ({ id: r.id, point: [r.lon / 1e6, r.lat / 1e6] as [number, number] }));
    streetCells = new Set((source.prepare('SELECT cell FROM street_cell').all() as { cell: number }[]).map((r) => r.cell));
  } finally {
    source.close();
  }
  const ratio = Math.round(centroidRatio(sampleDoors(doors), indexBuildings(buildings)) * 1000) / 1000;
  if (!qualifies(ratio)) {
    rmSync(input.outFile, { force: true });
    return { written: false, ratio, buildings: 0, bytes: 0 };
  }
  const useful = buildings.filter((b) => nearStreet(b, streetCells));
  const cells = new Map<number, { x: number; y: number }[]>();
  for (const b of useful) {
    const cell = cellOf(b.lng, b.lat);
    const cy = Math.floor(cell / ROW);
    const cx = cell - cy * ROW;
    const point = { x: Math.round(b.lng * 1e6) - cx * CELL_E6, y: Math.round(b.lat * 1e6) - cy * CELL_E6 };
    const bucket = cells.get(cell);
    if (bucket) bucket.push(point);
    else cells.set(cell, [point]);
  }
  const tmp = `${input.outFile}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  try {
    db.exec('PRAGMA page_size = 4096; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA auto_vacuum = 0; PRAGMA encoding = "UTF-8";');
    db.exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE building_cell (cell INTEGER PRIMARY KEY, pts BLOB NOT NULL);');
    db.exec('BEGIN');
    const meta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
    for (const [k, v] of [['format', String(BUILDING_FORMAT)], ['osm_time', input.osmTimestamp], ['province', input.province], ['buildings', String(useful.length)], ['ratio', String(ratio)]] as [string, string][]) meta.run(k, v);
    const insert = db.prepare('INSERT INTO building_cell (cell, pts) VALUES (?, ?)');
    for (const cell of [...cells.keys()].sort((a, b) => a - b)) insert.run(cell, encodeCell((cells.get(cell) as { x: number; y: number }[]).sort((a, b) => a.y - b.y || a.x - b.x)));
    db.exec('COMMIT');
    db.exec(`PRAGMA user_version = ${BUILDING_FORMAT}; PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec('VACUUM');
    const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') throw new Error(`integrity_check: ${check.integrity_check}`);
    db.close();
    renameSync(tmp, input.outFile);
    return { written: true, ratio, buildings: useful.length, bytes: statSync(input.outFile).size };
  } catch (error) {
    try {
      db.close();
    } catch {
      // already closed
    }
    rmSync(tmp, { force: true });
    throw error;
  }
}
