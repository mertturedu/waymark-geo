import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { firstContaining } from '../src/core/address/reverse';
import { createSearch } from '../src/core/address/search';
import type { LngLat } from '../src/core/geo/cells';
import type { PackStore } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { repoRoot, setsDir } from './addr-sets';

export const NAME_CASES = 40;
const PLATE = '34';
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export type NamesExpected = { status: string; top: { id: string; coordinate: [number, number]; poiName: string | null }[] };
export type NamesCase = { id: string; text: string; expected: NamesExpected };

const typo = (text: string, rand: () => number): string => {
  const at = Math.max(1, Math.floor(rand() * (text.length - 2)) + 1);
  return /\s/.test(text.charAt(at)) ? text : text.slice(0, at) + text.slice(at + 1);
};

export function namesPack(source: string, target: string): number {
  rmSync(target, { force: true });
  const from = new DatabaseSync(source, { readOnly: true });
  const to = new DatabaseSync(target);
  for (const row of from.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type = 'table' ORDER BY rowid").all() as { sql: string }[]) to.exec(row.sql);
  const ids = (from.prepare('SELECT DISTINCT id FROM building_name ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  const copy = (sql: string, params: unknown[], table: string, columns: number): void => {
    const insert = to.prepare(`INSERT INTO ${table} VALUES (${Array.from({ length: columns }, () => '?').join(', ')})`);
    for (const row of from.prepare(sql).all(...(params as never[])) as Record<string, never>[]) insert.run(...Object.values(row));
  };
  to.exec('BEGIN');
  const columns = (from.prepare('PRAGMA table_info(building)').all() as unknown[]).length;
  for (const id of ids) copy('SELECT * FROM building WHERE id = ?', [id], 'building', columns);
  copy('SELECT * FROM building_name ORDER BY key, id', [], 'building_name', 2);
  for (const row of from.prepare('SELECT k, v FROM meta').all() as { k: string; v: string }[]) to.prepare('INSERT INTO meta VALUES (?, ?)').run(row.k, row.k === 'buildings' ? String(ids.length) : row.v);
  to.exec('COMMIT');
  to.exec(`PRAGMA user_version = ${(from.prepare('PRAGMA user_version').get() as { user_version: number }).user_version}; PRAGMA application_id = ${(from.prepare('PRAGMA application_id').get() as { application_id: number }).application_id};`);
  from.close();
  to.close();
  return ids.length;
}

export async function nameCases(addressFile: string, namesFile: string): Promise<NamesCase[]> {
  const address = openSqlite(addressFile);
  const buildings = openSqlite(namesFile);
  const region = await openRegion(address);
  const polygons = await region.districtPolygons();
  const store: PackStore = { installed: async () => [PLATE], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) };
  const search = createSearch({ store, borders: embeddedBorders() });
  const rows = await buildings.all<{ key: string; name: string; lon: number; lat: number }>('SELECT n.key AS key, b.name AS name, b.lon AS lon, b.lat AS lat FROM building_name n JOIN building b ON b.id = n.id ORDER BY n.key, n.id');
  const seen = new Set<string>();
  const unique = rows.filter((r) => r.key.includes(' ') && !seen.has(r.key) && seen.add(r.key));
  const rand = rng(1717);
  const out: NamesCase[] = [];
  for (const row of shuffle(unique, rand)) {
    if (out.length >= NAME_CASES) break;
    const point: LngLat = [row.lon / 1e6, row.lat / 1e6];
    const district = region.districts.find((d) => d.id === firstContaining(polygons, point))?.name;
    if (!district) continue;
    const text = out.length % 2 === 0 ? `${row.name} ${district}` : `${typo(row.name, rand)} ${district}`;
    const result = await search.resolve(text, { limit: 5 });
    const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
    out.push({ id: `name-${out.length}`, text, expected: { status: result.status, top: top.map((p) => ({ id: p.id, coordinate: [round(p.coordinate[0]), round(p.coordinate[1])], poiName: p.components.poiName ?? null })) } });
  }
  await address.close();
  await buildings.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const work = join(repoRoot, 'dist', 'work', '261028', 'packs', PLATE);
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const namesFile = join(dir, `buildings2-names-${PLATE}.sqlite`);
  const count = namesPack(join(work, 'buildings2.sqlite'), namesFile);
  nameCases(join(dir, `reverse-${PLATE}-address.sqlite`), namesFile).then((cases) => {
    writeFileSync(join(dir, 'names.json'), JSON.stringify(cases));
    console.log(JSON.stringify({ buildings: count, cases: cases.length, withResult: cases.filter((c) => c.expected.top.length > 0).length }));
  });
}
