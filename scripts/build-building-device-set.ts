import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachEntrances, prepare, settlementsOf, writeBuildingPack, type Entrance, type OsmBuildingTag, type PlaceNode, type Trace } from '../pipeline/build/building-pack-v2';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openSqlite } from '../src/node/sqlite';
import { setsDir, repoRoot } from './addr-sets';
import { addressPackOf } from './build-buildings-v2';
import { readChains } from './addr-buildings-eval';

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

export const BOX = { west: 29.0, south: 40.97, east: 29.07, north: 41.02 };

export type BuildingCase = { kind: 'at' | 'near' | 'street'; point?: [number, number]; chain?: number; side?: 'left' | 'right'; expected: unknown };

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const raw = lines<Trace & { height?: number | null; floors?: number | null }>(join(work, 'building-traces', `${plate}.jsonl`));
  const traces = raw.filter((t) => t.lon >= BOX.west && t.lon <= BOX.east && t.lat >= BOX.south && t.lat <= BOX.north).map((t) => ({ ...t, height: t.height ?? null, floors: t.floors ?? null }));
  const tags = new Map(lines<OsmBuildingTag>(join(work, 'building-tags', 'osm-buildings.jsonl')).map((t) => [t.id, t]));
  const entrances = lines<Entrance>(join(work, 'building-tags', 'entrances.jsonl')).filter((e) => e.lon >= BOX.west && e.lon <= BOX.east && e.lat >= BOX.south && e.lat <= BOX.north);
  const nodes = lines<PlaceNode>(join(work, 'building-tags', 'settlements.jsonl'));
  const pack = readChains(plate, addressPackOf(plate));
  const rows = prepare(traces, pack.chains, tags);
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `buildings2-${plate}.sqlite`);
  const stats = writeBuildingPack(file, plate, rows, attachEntrances(rows, entrances), 'osm-261028', settlementsOf(nodes, rows));
  const db = openSqlite(file);
  const reader = await openBuildings2(db);
  const cases: BuildingCase[] = [];
  for (let i = 0; i < 160; i++) {
    const r = rows[(i * 131) % rows.length]!;
    const dx = ((i % 5) - 2) * 0.00004;
    const point: [number, number] = [r.trace.lon + dx, r.trace.lat + ((i % 3) - 1) * 0.00003];
    const at = await reader.at(point);
    cases.push({ kind: 'at', point, expected: at ? { gid: at.gid, levels: at.levels, chain: at.chain, side: at.side, sequence: at.sequence } : null });
  }
  for (let i = 0; i < 30; i++) {
    const r = rows[(i * 577 + 5) % rows.length]!;
    const near = await reader.near([r.trace.lon, r.trace.lat], 40, 5);
    cases.push({ kind: 'near', point: [r.trace.lon, r.trace.lat], expected: near.map((n) => n.building.gid) });
  }
  const chains = [...new Set(rows.filter((r) => r.link).map((r) => r.link!.chain))].slice(0, 10);
  for (const chain of chains) {
    const list = await reader.ofStreet(chain, 'left');
    cases.push({ kind: 'street', chain, side: 'left', expected: list.map((b) => [b.gid, b.sequence]) });
  }
  await db.close();
  const { DatabaseSync } = await import('node:sqlite');
  const raw2 = new DatabaseSync(file, { readOnly: true });
  const b64 = (v: unknown): unknown => (v instanceof Uint8Array ? { b64: Buffer.from(v).toString('base64') } : v);
  const dump: Record<string, unknown[]> = {};
  for (const table of ['meta', 'building', 'building_cell', 'entrance', 'settlement']) dump[table] = (raw2.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, b64(v)])));
  raw2.close();
  writeFileSync(join(dir, `buildings2-${plate}.dump.json`), JSON.stringify(dump));
  writeFileSync(join(dir, `buildings2-${plate}.json`), JSON.stringify(cases));
  console.log(`${plate}: ${stats.buildings} bina, ${stats.entrances} giriş, ${(statSync(file).size / 1e6).toFixed(1)} MB, ${cases.length} vaka`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
