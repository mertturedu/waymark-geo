import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { builtPack, searchRows } from '../address/helpers/search-fixture';
import { address, where } from '../pipeline/helpers/mini-work';
import { blob, makeWorld, type World } from './pack-world';

export const bytesOf = (file: string): Uint8Array => new Uint8Array(readFileSync(file));

export async function packWorld(): Promise<{ world: World; v1: Uint8Array; v2: Uint8Array; buildings: Uint8Array }> {
  const v1 = bytesOf(await builtPack());
  const rows = searchRows();
  rows.addresses.push(address('n900', 'Yeni Sokak', '9', 28.69, 40.76, where('r10', 'r20')));
  const v2 = bytesOf(await builtPack(rows));
  const file = join(mkdtempSync(join(tmpdir(), 'bld-')), 'buildings.sqlite');
  const made = new DatabaseSync(file);
  made.exec("CREATE TABLE meta (k TEXT, v TEXT); CREATE TABLE building_cell (cell INTEGER, pts BLOB); INSERT INTO meta VALUES ('format', '1');");
  made.close();
  const buildings = bytesOf(file);
  const world = makeWorld({ regions: [{ id: '34', parts: { address: v1, tiles: blob(5_000, 3), buildings } }, { id: '06', tier: 'basic', parts: { address: blob(4_000, 4), tiles: blob(6_000, 5) } }] });
  return { world, v1, v2, buildings };
}

