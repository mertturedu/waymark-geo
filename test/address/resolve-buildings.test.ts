import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildBuildingPack } from '../../pipeline/build/building-pack';
import { createSearch } from '../../src/core/address/search';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

const GUESS_AREA: [number, number] = [28.652, 40.7201];

async function withBuildings(pack: string): Promise<{ store: PackStore; close: () => Promise<void> }> {
  const dir = dirname(pack);
  const source = openSqlite(pack);
  const rows = await source.all<{ lon: number; lat: number }>('SELECT lon, lat FROM address');
  await source.close();
  const list = rows.map((r, i) => ({ id: `w${i}`, lon: r.lon / 1e6, lat: r.lat / 1e6, area_m2: 100, building: 'yes' }));
  list.push({ id: 'w900', lon: GUESS_AREA[0], lat: GUESS_AREA[1], area_m2: 100, building: 'yes' });
  mkdirSync(`${dir}/buildings/34`, { recursive: true });
  writeFileSync(`${dir}/buildings/34/buildings.jsonl`, list.map((b) => JSON.stringify(b)).join('\n') + '\n');
  const out = `${dir}/buildings.sqlite`;
  const result = await buildBuildingPack({ province: '34', workDir: dir, addressFile: pack, outFile: out, osmTimestamp: 't' });
  expect(result.written).toBe(true);
  const base = await memoryStore({ '34': pack });
  const opened: SqlDb[] = [];
  return {
    store: { ...base.store, openPart: async () => (opened.push(openSqlite(out)), opened[opened.length - 1] as SqlDb) },
    close: async () => {
      for (const db of opened) await db.close();
      await base.close();
    },
  };
}

describe('a guessed number with a building part installed', () => {
  it('lands on the free building near the guess and stays a guess', async () => {
    const pack = await builtPack();
    const plain = createSearch({ store: (await memoryStore({ '34': pack })).store, borders: turkeyBorders() });
    const before = await plain.resolve('Zeytin Sokak 3');
    const { store, close } = await withBuildings(pack);
    const snapped = await createSearch({ store, borders: turkeyBorders() }).resolve('Zeytin Sokak 3');
    expect(before.status === 'resolved' && before.best.precision).toBe('interpolated');
    expect(snapped.status).toBe('resolved');
    if (snapped.status !== 'resolved') return;
    expect(snapped.best).toMatchObject({ precision: 'interpolated', approximate: true, source: 'interpolated' });
    expect(snapped.best.coordinate).toEqual(GUESS_AREA);
    await close();
  });

  it('does not touch a real door', async () => {
    const pack = await builtPack();
    const { store, close } = await withBuildings(pack);
    const result = await createSearch({ store, borders: turkeyBorders() }).resolve('Zeytin Sokak 5');
    expect(result.status === 'resolved' && result.best).toMatchObject({ precision: 'address', approximate: false, coordinate: [28.654, 40.72] });
    await close();
  });
});
