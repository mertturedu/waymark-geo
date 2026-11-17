import { createBorders, encodeBorders } from '../../../src/core/region/borders';
import { openRegion } from '../../../src/core/address/pack';
import type { PackStore, SqlDb } from '../../../src/core/ports';
import type { Rows } from '../../pipeline/helpers/mini-work';
import { address, part, poi, where } from '../../pipeline/helpers/mini-work';
import { buildAddressPack } from '../../../pipeline/build/address-pack';
import { openSqlite } from '../../../src/node/sqlite';
import { join } from 'node:path';
import { writeWork } from '../../pipeline/helpers/mini-work';
import { richRows } from './mini-pack';

export function searchRows(): Rows {
  const rows = richRows();
  rows.addresses.push(
    address('n301', '1707. Sokak', '3', 28.63, 40.71, where('r10', 'r20')),
    address('n302', '1708. Sokak', '3', 28.64, 40.71, where('r10', 'r20')),
    address('n303', '1707. Sokak', '5', 28.6302, 40.7102, where('r10', 'r20')),
    address('n501', 'Sivas Caddesi', '24', 28.66, 40.73, where('r10', 'r20')),
    address('n502', 'Sivas Bulvarı', '24', 28.66003, 40.73, where('r10', 'r20')),
    address('n401', 'Zeytin Sokak', '1', 28.65, 40.72, where('r10', 'r20')),
    address('n405', 'Zeytin Sokak', '5', 28.654, 40.72, where('r10', 'r20')),
    address('n601', 'Hastane Caddesi', '1', 28.67, 40.74, where('r10', 'r20')),
  );
  rows.places.push(
    poi('n43', 'townhall', 'Kadıköy Belediyesi', 28.64, 40.74),
    poi('n44', 'pharmacy', 'Merkez Eczanesi', 28.645, 40.745),
    poi('n45', 'pharmacy', 'Merkez Eczanesi', 29.12, 40.66, where('r11', 'r21')),
    poi('n46', 'mall', 'Akasya AVM', 28.66, 40.76),
  );
  rows.streets.push(
    part('1707. Sokak', where('r10', 'r20'), [[[28.63, 40.71], [28.631, 40.71]]], ['w301']),
    part('1708. Sokak', where('r10', 'r20'), [[[28.64, 40.71], [28.641, 40.71]]], ['w302']),
    part('Zeytin Sokak', where('r10', 'r20'), [[[28.65, 40.72], [28.655, 40.72]]], ['w401']),
    part('Hastane Caddesi', where('r10', 'r20'), [[[28.67, 40.74], [28.675, 40.74]]], ['w601']),
  );
  return rows;
}

export const square = (west: number, south: number, east: number, north: number) => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]] as never;

export const turkeyBorders = (extra: { plate: string; rings: unknown }[] = []) =>
  createBorders(encodeBorders([{ plate: '34', rings: square(28.0, 40.0, 30.0, 42.0) }, ...extra.map((e) => ({ plate: e.plate, rings: e.rings as never }))]));

export async function memoryStore(packs: Record<string, string>): Promise<{ store: PackStore; close: () => Promise<void> }> {
  const dbs = new Map<string, SqlDb>();
  for (const [id, file] of Object.entries(packs)) dbs.set(id, openSqlite(file));
  return {
    store: { installed: async () => [...dbs.keys()].sort(), open: async (id) => dbs.get(id) ?? null },
    close: async () => {
      for (const db of dbs.values()) await db.close();
    },
  };
}

export async function builtPack(rows: Rows = searchRows(), province = '34'): Promise<string> {
  const dir = writeWork(rows, undefined, province);
  const file = join(dir, `${province}.sqlite`);
  await buildAddressPack({ province, workDir: dir, outFile: file, osmTimestamp: 't' });
  return file;
}

export { openRegion };
