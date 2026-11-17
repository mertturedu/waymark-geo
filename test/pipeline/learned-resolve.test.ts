import { canonicalize, osmPointOf, streetId } from '../../pipeline/build/learned-resolve';
import type { DeliveryRecord } from '../../pipeline/real/records';
import { createSearch } from '../../src/core/address/search';
import { richRows } from '../address/helpers/mini-pack';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';
import { part, where } from './helpers/mini-work';

const record = (over: Partial<DeliveryRecord>): DeliveryRecord => ({ v: 1, src: 'a', week: 2800, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '20', coordSource: 'gps', gps: { lng: 29, lat: 41, accuracyM: 8 }, ...over });

describe('canonicalize', () => {
  it('rewrites typed names to the official ones and remembers the streets it could not place', async () => {
    const { store } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const out = await canonicalize([record({ street: 'gül sk', district: 'kadikoy', neighbourhood: 'MODA' }), record({ street: 'Gül Sokak' }), record({ street: 'Hiç Yok Çıkmaz Sokak' })], search);
    expect(out.records.map((r) => [r.district, r.neighbourhood, r.street])).toEqual([
      ['Kadıköy', 'Moda', 'Gül Sokak'],
      ['Kadıköy', 'Moda', 'Gül Sokak'],
      ['Kadıköy', 'Moda', 'Hiç Yok Çıkmaz Sokak'],
    ]);
    expect(out).toMatchObject({ resolved: 2, renamed: 1, unresolved: 1 });
    expect(out.unknownStreets).toEqual(new Set([streetId('Kadıköy', 'Hiç Yok Çıkmaz Sokak')]));
  });

  it('keeps the original record when nothing can place it', async () => {
    const { store } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const raw = record({ district: 'Olmayan İlçe' });
    const out = await canonicalize([raw], search);
    expect(out.records).toEqual([raw]);
    expect(out.unresolved).toBe(1);
  });
});

describe('osmPointOf', () => {
  it('gives the map point of a door the map has and nothing for a door it does not', async () => {
    const source = richRows();
    source.streets.push(part('Bahariye Caddesi', where('r10', 'r20'), [[[28.6, 40.70025], [28.6026, 40.70155]]], ['w60']));
    const { store } = await memoryStore({ '34': await builtPack(source) });
    const osm = osmPointOf(createSearch({ store, borders: turkeyBorders() }), '34');
    const known = await osm({ district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '12' });
    expect(known?.[0]).toBeCloseTo(28.6 + 12 * 0.0001, 4);
    expect(await osm({ district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '22' })).toBeNull();
    expect(await osm({ district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '12' })).toBeNull();
    expect(await osm({ district: 'Kadıköy' })).toBeNull();
  });
});
