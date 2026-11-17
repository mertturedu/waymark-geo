import { join } from 'node:path';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { DIRECTORY_KINDS } from '../../pipeline/build/directory';
import { createSearch } from '../../src/core/address/search';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { address, part, poi, where, writeWork, type Rows } from '../pipeline/helpers/mini-work';
import { baseAdmin } from '../pipeline/helpers/mini-work';
import { builtPack, turkeyBorders } from './helpers/search-fixture';

const hint = { hints: { city: 'İstanbul' } };

async function directoryPack(): Promise<string> {
  const rows: Rows = {
    admin: baseAdmin(),
    addresses: [
      address('n1', 'Yeni Sokak', '7', 28.6, 40.65),
      address('n2', 'Zeytin Sokak', '5', 28.6545, 40.7203),
      address('n3', 'Yeni Sokak', '9', 28.6002, 40.6502),
      address('n6', 'Zeytin Sokak', '3', 28.6522, 40.7201),
    ],
    streets: [part('Yeni Sokak', where('r10', 'r20'), [[[28.6, 40.65], [28.6002, 40.6502]]], ['w1'])],
    places: [
      { ...poi('n4', 'market', 'Derya Market', 28.61, 40.66), info: { cat: 'grocery_store', brand: 'Derya', street: 'Yeni Sokak', number: '7', postcode: '34710', conf: 87 } },
      { ...poi('n6', 'market', 'Dilek Bakkal', 28.63, 40.68), info: { cat: 'grocery_store', brand: null, street: null, number: null, postcode: '06420', conf: 80 } },
      { ...poi('n5', 'food', 'Lale Lokantası', 28.62, 40.67), info: { cat: 'restaurant', brand: null, street: null, number: null, postcode: null, conf: 40 } },
    ],
  };
  const dir = writeWork(rows);
  const out = join(dir, 'directory.sqlite');
  await buildAddressPack({ province: '34', workDir: dir, outFile: out, osmTimestamp: 't', kinds: DIRECTORY_KINDS });
  return out;
}

async function rig(options: { broken?: boolean; noPart?: boolean } = {}) {
  const primary = openSqlite(await builtPack());
  const extra = openSqlite(await directoryPack());
  const broken: SqlDb = { all: async () => { throw new Error('bozuk'); }, close: async () => undefined };
  const store: PackStore = {
    installed: async () => ['34'],
    open: async () => primary,
    openPart: async (_region, kind) => (kind === 'directory' && !options.noPart ? (options.broken ? broken : extra) : null),
  };
  return { search: createSearch({ store, borders: turkeyBorders() }), close: async () => { await primary.close(); await extra.close(); } };
}

describe('directory part next to the address pack', () => {
  it('finds a door that only the directory knows and says where it came from', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Yeni Sokak 7', hint);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best).toMatchObject({ precision: 'interpolated', source: 'overture', approximate: true, region: '34', coordinate: [28.6, 40.65], components: { street: 'Yeni Sokak', houseNumber: '7' } });
    expect(result.best.id).toBe('34+:a:' + result.best.id.split(':a:')[1]);
    await close();
  });

  it('keeps the address pack answer when both know the same door', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Zeytin Sokak 5', hint);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best).toMatchObject({ source: 'osm', approximate: false, coordinate: [28.654, 40.72] });
    expect(result.candidates.filter((c) => c.components.houseNumber === '5' && c.components.street === 'Zeytin Sokak')).toHaveLength(1);
    await close();
  });

  it('finds a business by name', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Derya Market', hint);
    expect(result.status === 'resolved' && result.best).toMatchObject({ precision: 'poi', source: 'overture', components: { poiName: 'Derya Market' } });
    await close();
  });

  it('gives a business its street, door number and category', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Derya Market', hint);
    expect(result.status === 'resolved' && result.best).toMatchObject({
      components: { poiName: 'Derya Market', street: 'Yeni Sokak', houseNumber: '7', postcode: '34710' },
      details: { category: 'grocery_store', brand: 'Derya' },
    });
    expect(result.status === 'resolved' && result.best.label).toContain('Derya Market, Yeni Sokak No:7');
    await close();
  });

  it('keeps the leading zero of a postcode', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Dilek Bakkal', hint);
    expect(result.status === 'resolved' && result.best.components.postcode).toBe('06420');
    await close();
  });

  it('ranks a business of low confidence under a sure one', async () => {
    const { search, close } = await rig();
    const sure = await search.resolve('Derya Market', hint);
    const unsure = await search.resolve('Lale Lokantası', hint);
    expect(sure.status === 'resolved' && unsure.status === 'resolved' && unsure.best.confidence < sure.best.confidence).toBe(true);
    expect(unsure.status === 'resolved' && unsure.best.details).toEqual({ category: 'restaurant' });
    await close();
  });

  it('suggests directory streets while typing', async () => {
    const { search, close } = await rig();
    const places = await search.autocomplete('yeni sok', hint);
    expect(places.some((p) => p.components.street === 'Yeni Sokak')).toBe(true);
    await close();
  });

  it('adds the directory doors to the coverage count', async () => {
    const { search, close } = await rig();
    const plain = await rig({ noPart: true });
    const withIt = await search.coverage([28.62, 40.7]);
    const without = await plain.search.coverage([28.62, 40.7]);
    expect(withIt && without && withIt.addresses > without.addresses).toBe(true);
    await close();
    await plain.close();
  });

  it('answers as before without the part', async () => {
    const { search, close } = await rig({ noPart: true });
    const result = await search.resolve('Yeni Sokak 7', hint);
    expect(result.status).not.toBe('resolved');
    await close();
  });

  it('ignores a directory part that cannot be read', async () => {
    const { search, close } = await rig({ broken: true });
    expect(await search.resolve('Zeytin Sokak 5', hint)).toMatchObject({ status: 'resolved', best: { source: 'osm' } });
    await close();
  });
});

describe('directory doors against guessed numbers', () => {
  it('prefers a listed door over the address pack guess for the same number', async () => {
    const { search, close } = await rig();
    const result = await search.resolve('Zeytin Sokak 3', hint);
    expect(result.status === 'resolved' && result.best).toMatchObject({ source: 'overture', coordinate: [28.6522, 40.7201], approximate: true });
    await close();
  });
});

describe('searching a directory with many businesses', () => {
  it('still finds streets and businesses by name', async () => {
    const { search, close } = await rig();
    const street = await search.resolve('Yeni Sokak 7', hint);
    expect(street.status === 'resolved' && street.best.components.street).toBe('Yeni Sokak');
    const place = await search.resolve('Lale Lokantası', hint);
    expect(place.status === 'resolved' && place.best.components.poiName).toBe('Lale Lokantası');
    const typed = await search.autocomplete('lale lok', hint);
    expect(typed.some((p) => p.components.poiName === 'Lale Lokantası')).toBe(true);
    await close();
  });
});

describe('when the directory is asked', () => {
  async function counted() {
    const primary = openSqlite(await builtPack());
    const extra = openSqlite(await directoryPack());
    let calls = 0;
    const watched: SqlDb = { close: () => extra.close(), all: (sql, params) => (sql.includes('FROM meta') || sql.includes('sqlite_schema') || /FROM (district|neighbourhood|poi_kind)/.test(sql) ? extra.all(sql, params) : (calls += 1, extra.all(sql, params))) };
    const store: PackStore = { installed: async () => ['34'], open: async () => primary, openPart: async (_r, kind) => (kind === 'directory' ? watched : null) };
    return { search: createSearch({ store, borders: turkeyBorders() }), calls: () => calls, reset: () => void (calls = 0), close: async () => { await primary.close(); await extra.close(); } };
  }

  it('leaves it alone when the address pack already has the exact door or place', async () => {
    const { search, calls, reset, close } = await counted();
    await search.resolve('Zeytin Sokak 5', hint);
    reset();
    await search.resolve('Zeytin Sokak 5', hint);
    expect(calls()).toBe(0);
    await close();
  });

  it('asks it when the address pack has no sure answer', async () => {
    const { search, calls, reset, close } = await counted();
    await search.resolve('Yeni Sokak 7', hint);
    reset();
    const result = await search.resolve('Yeni Sokak 7', hint);
    expect(calls()).toBeGreaterThan(0);
    expect(result.status === 'resolved' && result.best.source).toBe('overture');
    await close();
  });
});
