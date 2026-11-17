import { boxAround, clampLimit, clampRadius, isNearbyGroup, NEARBY_GROUPS, NEARBY_MAX_LIMIT, NEARBY_MAX_RADIUS_M } from '../../src/core/address/nearby';
import { createSearch } from '../../src/core/address/search';
import { distanceM } from '../../src/core/geo/distance';
import { SERVICE_ICONS } from '../../src/native/map/style';
import { poi } from '../pipeline/helpers/mini-work';
import { builtPack, memoryStore, searchRows, turkeyBorders } from './helpers/search-fixture';

const HERE: [number, number] = [28.645, 40.745];

async function rig() {
  const rows = searchRows();
  rows.places.push(
    poi('n70', 'pharmacy', 'Yakın Eczane', 28.647, 40.745),
    poi('n71', 'pharmacy', 'Orta Eczane', 28.65, 40.745),
    poi('n72', 'pharmacy', 'Uzak Eczane', 28.7, 40.745),
    poi('n73', 'hospital', 'Şehir Hastanesi', 28.646, 40.746),
    poi('n74', 'fuel', 'Petrol İstasyonu', 28.644, 40.744),
    poi('n75', 'cafe', 'Kafe Moda', 28.6451, 40.7451),
  );
  const file = await builtPack(rows, '34');
  const { store, close } = await memoryStore({ '34': file });
  return { search: createSearch({ store, borders: turkeyBorders() }), close };
}

describe('nearby', () => {
  it('lists the pharmacies from the nearest to the farthest with their distance', async () => {
    const { search, close } = await rig();
    const hits = await search.nearby({ point: HERE, group: 'pharmacy', radiusM: 10000 });
    expect(hits.map((h) => h.place.components.poiName)).toEqual(['Merkez Eczanesi', 'Yakın Eczane', 'Orta Eczane', 'Uzak Eczane']);
    const gaps = hits.map((h) => h.distanceM);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(gaps[0]).toBeLessThan(5);
    for (const hit of hits) expect(hit.distanceM).toBe(Math.round(distanceM(HERE, hit.place.coordinate)));
    await close();
  });

  it('keeps to the group asked for', async () => {
    const { search, close } = await rig();
    expect((await search.nearby({ point: HERE, group: 'health' })).map((h) => h.place.components.poiName)).toEqual(['Şehir Hastanesi']);
    expect((await search.nearby({ point: HERE, group: 'fuel' })).map((h) => h.place.components.poiName)).toEqual(['Petrol İstasyonu']);
    expect(await search.nearby({ point: HERE, group: 'lodging' })).toEqual([]);
    await close();
  });

  it('obeys the limit and the radius', async () => {
    const { search, close } = await rig();
    expect(await search.nearby({ point: HERE, group: 'pharmacy', limit: 2, radiusM: 10000 })).toHaveLength(2);
    const near = await search.nearby({ point: HERE, group: 'pharmacy', radiusM: 500 });
    expect(near.every((h) => h.distanceM <= 500)).toBe(true);
    expect(near.map((h) => h.place.components.poiName)).toEqual(['Merkez Eczanesi', 'Yakın Eczane', 'Orta Eczane']);
    expect((await search.nearby({ point: HERE, group: 'pharmacy', radiusM: 10000 })).length).toBe(4);
    await close();
  });

  it('answers with an empty list for a bad point, an unknown group or a place with no installed region', async () => {
    const { search, close } = await rig();
    expect(await search.nearby({ point: [NaN, 40] as never, group: 'pharmacy' })).toEqual([]);
    expect(await search.nearby({ point: HERE, group: 'bakery' as never })).toEqual([]);
    expect(await search.nearby(null as never)).toEqual([]);
    expect(await search.nearby({ point: [35, 39], group: 'pharmacy', radiusM: 5000 })).toEqual([]);
    await close();
  });

  it('gives places a poi precision and the same answer every time', async () => {
    const { search, close } = await rig();
    const first = await search.nearby({ point: HERE, group: 'pharmacy', radiusM: 10000 });
    const second = await search.nearby({ point: HERE, group: 'pharmacy', radiusM: 10000 });
    expect(second).toEqual(first);
    expect(first.every((h) => h.place.precision === 'poi')).toBe(true);
    await close();
  });
});

describe('nearby helpers', () => {
  it('uses the same service kinds as the map badges', () => {
    for (const [group, kinds] of Object.entries(NEARBY_GROUPS)) expect([...kinds]).toEqual(SERVICE_ICONS[`geo-${group}`]);
  });

  it('knows its groups', () => {
    expect(isNearbyGroup('pharmacy')).toBe(true);
    expect(isNearbyGroup('toString')).toBe(false);
    expect(isNearbyGroup(3)).toBe(false);
    expect(Object.keys(NEARBY_GROUPS)).toHaveLength(9);
  });

  it('clamps the radius and the limit', () => {
    expect(clampRadius(undefined)).toBe(3000);
    expect(clampRadius(5)).toBe(50);
    expect(clampRadius(1e9)).toBe(NEARBY_MAX_RADIUS_M);
    expect(clampRadius(NaN)).toBe(3000);
    expect(clampLimit(undefined)).toBe(10);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(999)).toBe(NEARBY_MAX_LIMIT);
    expect(clampLimit(2.9)).toBe(2);
  });

  it('draws a box that is wider in degrees of longitude than of latitude at 41 degrees', () => {
    const [w, s, e, n] = boxAround([29, 41], 1000);
    expect(e - w).toBeGreaterThan(n - s);
    expect(distanceM([w, 41], [e, 41])).toBeCloseTo(2000, -2);
    expect(distanceM([29, s], [29, n])).toBeCloseTo(2000, -2);
  });
});
