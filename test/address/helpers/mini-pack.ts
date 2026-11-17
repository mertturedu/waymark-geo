import { join } from 'node:path';
import { buildAddressPack } from '../../../pipeline/build/address-pack';
import { openRegion, type Region } from '../../../src/core/address/pack';
import { openSqlite } from '../../../src/node/sqlite';
import { address, baseRows, where, writeWork, type Rows } from '../../pipeline/helpers/mini-work';

export function richRows(): Rows {
  const rows = baseRows();
  for (let n = 2; n <= 20; n += 2) if (n !== 14 && n !== 16) rows.addresses.push(address(`n${100 + n}`, 'Bahariye Caddesi', String(n), 28.6 + n * 0.0001, 40.7 + n * 0.00005, where('r10', 'r20')));
  for (let n = 1; n <= 9; n += 2) rows.addresses.push(address(`n${200 + n}`, 'Bahariye Caddesi', String(n), 28.6 + n * 0.0001, 40.7005 + n * 0.00005, where('r10', 'r20')));
  return rows;
}

export async function miniRegion(rows: Rows = richRows()): Promise<{ region: Region; dir: string; file: string; close: () => Promise<void> }> {
  const dir = writeWork(rows);
  const file = join(dir, 'pack.sqlite');
  await buildAddressPack({ province: '34', workDir: dir, outFile: file, osmTimestamp: 't' });
  const db = openSqlite(file);
  const region = await openRegion(db);
  return { region, dir, file, close: () => db.close() };
}
