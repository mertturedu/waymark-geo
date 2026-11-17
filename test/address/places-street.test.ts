import { join } from 'node:path';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { DIRECTORY_KINDS } from '../../pipeline/build/directory';
import { createSearch } from '../../src/core/address/search';
import type { PackStore } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { address, part, poi, where, writeWork, baseAdmin, type Rows } from '../pipeline/helpers/mini-work';
import { builtPack, turkeyBorders } from './helpers/search-fixture';

const hint = { hints: { city: 'İstanbul' } };
const info = (street: string | null) => ({ cat: 'grocery_store', brand: 'Derya', street, number: null, postcode: null, conf: 87 });

async function directoryPack(): Promise<string> {
  const rows: Rows = {
    admin: baseAdmin(),
    addresses: [address('n1', 'Yeni Sokak', '7', 28.6, 40.65), address('n2', 'Zeytin Sokak', '5', 28.6545, 40.7203)],
    streets: [part('Yeni Sokak', where('r10', 'r20'), [[[28.6, 40.65], [28.6002, 40.6502]]], ['w1'])],
    places: [
      { ...poi('n4', 'market', 'Derya Market', 28.61, 40.66), info: info('Yeni Sokak') },
      { ...poi('n5', 'market', 'Derya Market', 28.62, 40.67), info: info('Zeytin Sokak') },
      { ...poi('n6', 'market', 'Derya Market', 28.63, 40.68), info: info(null) },
    ],
  };
  const dir = writeWork(rows);
  const out = join(dir, 'directory.sqlite');
  await buildAddressPack({ province: '34', workDir: dir, outFile: out, osmTimestamp: 't', kinds: DIRECTORY_KINDS });
  return out;
}

describe('a place named together with its street', () => {
  it('finds the place on that street and not the one of the same name elsewhere', async () => {
    const primary = openSqlite(await builtPack());
    const extra = openSqlite(await directoryPack());
    const store: PackStore = { installed: async () => ['34'], open: async () => primary, openPart: async (_r, kind) => (kind === 'directory' ? extra : null) };
    const search = createSearch({ store, borders: turkeyBorders() });
    const result = await search.resolve('Derya Market Yeni Sokak', hint);
    const places = result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : [];
    const hit = places.find((p) => p.precision === 'poi');
    expect(hit?.components).toMatchObject({ poiName: 'Derya Market', street: 'Yeni Sokak' });
    expect(places.filter((p) => p.precision === 'poi' && p.components.street === 'Zeytin Sokak')).toEqual([]);
    expect((await search.resolve('Yeni Sokak', hint)).status).not.toBe('not_found');
    await primary.close();
    await extra.close();
  });
});
