import { join } from 'node:path';
import { openRegion, type Region } from '../../src/core/address/pack';
import { reverseDetailed, reversePoint } from '../../src/core/address/reverse';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { openSqlite } from '../../src/node/sqlite';
import { address, admin, baseAdmin, baseRows, part, where, writeWork, type Rows } from '../pipeline/helpers/mini-work';
import { searchRows, square, turkeyBorders } from './helpers/search-fixture';

const opened: { close: () => Promise<void> }[] = [];

async function regionOf(rows: Rows, province = '34'): Promise<Region> {
  const dir = writeWork(rows, undefined, province);
  const file = join(dir, `${province}.sqlite`);
  await buildAddressPack({ province, workDir: dir, outFile: file, osmTimestamp: 't' });
  const db = openSqlite(file);
  opened.push(db);
  return openRegion(db);
}

afterAll(async () => {
  for (const db of opened) await db.close();
});

const north = (lat: number, meters: number): number => lat + meters / 111_195;

describe('reverse lookup', () => {
  let region: Region;
  const borders = turkeyBorders();
  beforeAll(async () => {
    region = await regionOf(searchRows());
  });

  it('names the door that is a few metres away and keeps the point it was asked about', async () => {
    const point: [number, number] = [28.59995, 40.7];
    const place = await reversePoint([region], borders, point);
    expect(place).toMatchObject({ precision: 'address', approximate: true, source: 'osm', coordinate: point, components: { street: 'Bahariye Caddesi', houseNumber: '14', neighbourhood: 'Moda', district: 'Kadıköy', province: 'İstanbul' } });
    expect(place?.id).toMatch(/^34:a:\d+$/);
  });

  it('skips a door 60 m away but finds the street within 100 m', async () => {
    const place = await reversePoint([region], borders, [28.6525, north(40.72, 60)]);
    expect(place).toMatchObject({ precision: 'street', approximate: true, components: { street: 'Zeytin Sokak', district: 'Kadıköy', neighbourhood: 'Moda' } });
    expect(place?.components.houseNumber).toBeUndefined();
  });

  it('finds a street 80 m away and nothing 120 m away', async () => {
    expect(await reversePoint([region], borders, [28.65, north(40.9, 80)])).toMatchObject({ precision: 'street', components: { street: 'Atatürk Sokağı' } });
    expect(await reversePoint([region], borders, [28.65, north(40.9, 120)])).toMatchObject({ precision: 'neighbourhood', components: { neighbourhood: 'Moda' } });
  });

  it('falls back from neighbourhood to district to province', async () => {
    expect(await reversePoint([region], borders, [28.55, 40.55])).toMatchObject({ precision: 'neighbourhood', id: expect.stringMatching(/^34:h:\d+$/), components: { neighbourhood: 'Moda', district: 'Kadıköy' } });
    expect(await reversePoint([region], borders, [28.9, 40.9])).toMatchObject({ precision: 'district', components: { district: 'Kadıköy' } });
    expect(await reversePoint([region], borders, [28.2, 41.8])).toMatchObject({ precision: 'province', id: '34:p:0', components: { province: 'İstanbul' } });
  });

  it('says nothing for a point outside every province', async () => {
    expect(await reversePoint([region], borders, [35, 39])).toBeNull();
    expect(await reversePoint([], borders, [28.6, 40.7])).toBeNull();
  });

  it('finds a door across a cell border and just inside the radius', async () => {
    const rows = baseRows();
    rows.addresses.push(address('n801', 'Gül Sokak', '1', 28.9, 40.7999999, where('r10', 'r20')));
    const near = await regionOf(rows);
    const place = await reversePoint([near], borders, [28.9, 40.8004495]);
    expect(place).toMatchObject({ precision: 'address', components: { street: 'Gül Sokak', houseNumber: '1' } });
  });

  it('takes the smaller id when two doors are the same distance away', async () => {
    const rows = baseRows();
    rows.addresses.push(address('n811', 'Gül Sokak', '1', 28.9, 40.8004, where('r10', 'r20')), address('n812', 'Gül Sokak', '3', 28.9, 40.7996, where('r10', 'r20')));
    const tie = await regionOf(rows);
    const found = await reverseDetailed([tie], borders, [28.9, 40.8]);
    expect(found?.place.components.houseNumber).toBe('1');
  });

  it('answers the same twice', async () => {
    const a = await reversePoint([region], borders, [28.59995, 40.7]);
    expect(await reversePoint([region], borders, [28.59995, 40.7])).toEqual(a);
  });

  it('gives the ids behind the answer', async () => {
    const found = await reverseDetailed([region], borders, [28.59995, 40.7]);
    expect(found).toMatchObject({ plate: '34' });
    expect(found?.addressId).toBeGreaterThan(0);
    expect(found?.districtId).toBeGreaterThan(0);
    expect(found?.hoodId).toBeGreaterThan(0);
  });
});

describe('reverse lookup across provinces and holes', () => {
  it('looks into the next province when the point is by the border', async () => {
    const west = await regionOf(baseRows(), '34');
    const rows = baseRows();
    rows.addresses.push(address('n821', 'Gül Sokak', '9', 30.0003, 41.0, where('r10', 'r20')));
    const east = await regionOf(rows, '35');
    const borders = turkeyBorders([{ plate: '35', rings: square(30.0, 40.0, 32.0, 42.0) }]);
    const place = await reversePoint([west, east], borders, [29.99985, 41.0]);
    expect(place).toMatchObject({ precision: 'address', id: expect.stringMatching(/^35:a:\d+$/), components: { houseNumber: '9' } });
  });

  it('takes the lower door id when two doors are equally near', async () => {
    const rows = baseRows();
    rows.addresses = [
      address('n841', 'Gül Sokak', '1', 28.6, 40.7001, where('r10', 'r20')),
      address('n842', 'Gül Sokak', '3', 28.6, 40.6999, where('r10', 'r20')),
    ];
    rows.streets = [part('Gül Sokak', where('r10', 'r20'), [[[28.6, 40.69], [28.6, 40.71]]], ['w1'])];
    const tied = await regionOf(rows);
    const doors = await tied.addressesInCells([...new Set((await tied.db.all<{ cell: number }>('SELECT cell FROM address')).map((r) => r.cell))]);
    const lowest = Math.min(...doors.map((d) => d.id));
    const place = await reversePoint([tied], turkeyBorders(), [28.6, 40.7]);
    expect(place?.id).toBe(`34:a:${lowest}`);
  });

  it('takes the lower plate when doors of two provinces are equally near', async () => {
    const west = await regionOf({ ...baseRows(), addresses: [address('n851', 'Gül Sokak', '5', 29.9997, 41.0, where('r10', 'r20'))] }, '34');
    const east = await regionOf({ ...baseRows(), addresses: [address('n852', 'Gül Sokak', '7', 30.0003, 41.0, where('r10', 'r20'))] }, '35');
    const borders = turkeyBorders([{ plate: '35', rings: square(30.0, 40.0, 32.0, 42.0) }]);
    expect(await reversePoint([west, east], borders, [30.0, 41.0])).toMatchObject({ id: expect.stringMatching(/^34:a:\d+$/), components: { houseNumber: '5' } });
    expect(await reversePoint([east, west], borders, [30.0, 41.0])).toMatchObject({ id: expect.stringMatching(/^34:a:\d+$/) });
  });

  it('does not count a point inside the hole of a district', async () => {
    const rows = baseRows();
    const outer = [[28.5, 40.5], [29.0, 40.5], [29.0, 41.5], [28.5, 41.5], [28.5, 40.5]];
    const hole = [[28.55, 40.55], [28.57, 40.55], [28.57, 40.57], [28.55, 40.57], [28.55, 40.55]];
    rows.admin = [admin('r10', 6, 'r1', { tr: 'Kadıköy' }, [[outer, hole]], [28.7, 41.0]), ...baseAdmin().slice(1).filter((a) => a.id !== 'r20')];
    rows.streets = [part('Gül Sokak', where('r10', null), [[[28.6, 41.4], [28.7, 41.4]]], ['w1'])];
    rows.addresses = [address('n831', 'Gül Sokak', '1', 28.6, 41.4, where('r10', null))];
    const holed = await regionOf(rows);
    const borders = turkeyBorders();
    expect(await reversePoint([holed], borders, [28.56, 40.56])).toMatchObject({ precision: 'province' });
    expect(await reversePoint([holed], borders, [28.8, 40.8])).toMatchObject({ precision: 'district', components: { district: 'Kadıköy' } });
  });
});

describe('reverse through the search object', () => {
  it('opens the pack by itself and speaks the asked language', async () => {
    const { memoryStore, builtPack } = await import('./helpers/search-fixture');
    const { createSearch } = await import('../../src/core/address/search');
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    expect(await search.reverse([28.59995, 40.7])).toMatchObject({ precision: 'address', label: 'Bahariye Caddesi No:14, Moda Mah., Kadıköy/İstanbul' });
    expect((await search.reverse([28.59995, 40.7], { language: 'en' }))?.label).toBe('14 Bahariye Caddesi, Moda, Kadıköy, Istanbul');
    expect(await search.reverse([35, 39])).toBeNull();
    expect(await search.reverse([30.5, 41])).toBeNull();
    await close();
  });
});
