import type { LngLat } from '../../src/core/geo/cells';
import { arrivalOf, chainLines, chooseEntrance, entranceOf } from '../../src/core/address/arrival';
import type { EntranceInfo } from '../../src/core/address/buildings2';
import type { NamedPart, Region, StreetRow } from '../../src/core/address/pack';
import type { Place } from '../../src/core/address/types';

const place = (extra: Partial<Place> = {}): Place => ({ id: '34:a:1', label: 'x', components: { street: 'Bahariye Caddesi' }, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra });

const near: LngLat[][] = [[[28.9995, 41], [29.0005, 41]]];
const other: LngLat[][] = [[[28.9995, 41.0004], [29.0005, 41.0004]]];
const far: LngLat[][] = [[[29.05, 41.05], [29.06, 41.05]]];

const region = (parts: NamedPart[], names: StreetRow[], hoods: { id: number; districtId: number; key: string }[] = [], districts: { id: number; key: string }[] = []): Region =>
  ({ partsInCells: async () => parts, streetsByIds: async (ids: number[]) => names.filter((n) => ids.includes(n.id)), hoods, districts }) as unknown as Region;

const row = (id: number, name: string): StreetRow => ({ id, name, key: name, kind: null, number: null });
const part = (id: number, nameId: number, lines: LngLat[][], hoodId: number | null = null, districtId = 1): NamedPart => ({ id, districtId, hoodId, lines, nameId });

describe('chainLines', () => {
  it('keeps only the parts of the same street that run near the target', async () => {
    const r = region([part(1, 10, near), part(2, 11, other), part(3, 10, far)], [row(10, 'Bahariye Cd.'), row(11, 'Moda Sokak')]);
    expect(await chainLines(r, place(), [29, 41])).toEqual(near);
  });

  it('prefers the Turkish form of the street when the label is localized', async () => {
    const r = region([part(1, 10, near)], [row(10, 'Bahariye Caddesi')]);
    expect(await chainLines(r, place({ components: { street: 'Bahariye Street' }, local: { street: 'Bahariye Caddesi' } }), [29, 41])).toEqual(near);
  });

  it('is empty without a street, without parts or when no name matches', async () => {
    const r = region([part(1, 11, near)], [row(11, 'Moda Sokak')]);
    expect(await chainLines(r, place({ components: {} }), [29, 41])).toEqual([]);
    expect(await chainLines(r, place(), [29, 41])).toEqual([]);
    expect(await chainLines(region([], []), place(), [29, 41])).toEqual([]);
  });
});

describe('chainLines picks the street the place belongs to', () => {
  const twin: LngLat[][] = [[[28.9996, 41.0001], [29.0004, 41.0001]]];
  const names = [row(10, 'Moda Sokak'), row(11, 'Moda Sokak')];
  const hoods = [{ id: 5, districtId: 1, key: 'moda' }, { id: 6, districtId: 2, key: 'moda' }, { id: 7, districtId: 1, key: 'fenerbahce' }];
  const districts = [{ id: 1, key: 'kadikoy' }, { id: 2, key: 'besiktas' }];
  const parts = [part(1, 10, near, 5, 1), part(2, 11, twin, 6, 2)];

  it('keeps the street of the written neighbourhood and district', async () => {
    const asked = place({ components: { street: 'Moda Sokak', neighbourhood: 'Moda', district: 'Kadıköy' } });
    expect(await chainLines(region(parts, names, hoods, districts), asked, [29, 41])).toEqual(near);
    const other = place({ components: { street: 'Moda Sokak', neighbourhood: 'Moda', district: 'Beşiktaş' } });
    expect(await chainLines(region(parts, names, hoods, districts), other, [29, 41])).toEqual(twin);
  });

  it('falls back to the district, then to every street of that name', async () => {
    const district = place({ components: { street: 'Moda Sokak', neighbourhood: 'Fenerbahçe', district: 'Kadıköy' } });
    expect(await chainLines(region(parts, names, hoods, districts), district, [29, 41])).toEqual(near);
    const lost = place({ components: { street: 'Moda Sokak', neighbourhood: 'Yok', district: 'Yok' } });
    expect(await chainLines(region(parts, names, hoods, districts), lost, [29, 41])).toEqual([...near, ...twin]);
    expect(await chainLines(region(parts, names, hoods, districts), place({ components: { street: 'Moda Sokak' } }), [29, 41])).toEqual([...near, ...twin]);
  });

  it('prefers the exact street name and refuses another kind of street', async () => {
    const longer = [row(10, 'Ankara Caddesi'), row(11, 'Ankara Yolu Caddesi')];
    const two = [part(1, 10, near), part(2, 11, twin)];
    expect(await chainLines(region(two, longer), place({ components: { street: 'Ankara Caddesi' } }), [29, 41])).toEqual(near);
    const kinds = [row(10, 'Moda Caddesi'), row(11, 'Moda Sokak')];
    expect(await chainLines(region(two, kinds), place({ components: { street: 'Moda Sokak' } }), [29, 41])).toEqual(twin);
  });
});

describe('entranceOf and arrivalOf', () => {
  it('prefers the unit entrance, then the place entrance, then nothing', () => {
    const unitEntrance = { id: 1, ref: '2', kind: 'main', flats: null, building: 1, unit: null, point: [29.0001, 41.0001] as LngLat };
    const unit = { block: null, entrance: unitEntrance, floor: null, door: null, levels: null, perFloor: null, notes: [] };
    expect(entranceOf(place({ unit, entrance: [29.5, 41.5] }))).toEqual([29.0001, 41.0001]);
    expect(entranceOf(place({ entrance: [29.5, 41.5] }))).toEqual([29.5, 41.5]);
    expect(entranceOf(place())).toBeUndefined();
  });

  it('gives the door, the entrance and the chain, and works without a region', async () => {
    const r = region([part(1, 10, near)], [row(10, 'Bahariye Caddesi')]);
    expect(await arrivalOf(r, place({ entrance: [29.0001, 41.0001] }))).toEqual({ door: [29, 41], entrance: [29.0001, 41.0001], chain: near });
    expect(await arrivalOf(null, place())).toEqual({ door: [29, 41] });
    expect(await arrivalOf(region([], []), place())).toEqual({ door: [29, 41] });
  });
});

const entrance = (id: number, point: LngLat, extra: Partial<EntranceInfo> = {}): EntranceInfo => ({ id, building: 1, point, kind: null, ref: null, flats: null, unit: null, ...extra });

describe('chooseEntrance', () => {
  const road: LngLat[][] = [[[29, 41], [29.001, 41]]];
  const onRoad = entrance(1, [29.0005, 41.00005]);
  const back = entrance(2, [29.0005, 41.0004]);

  it('takes the only one, the one holding the flat, then the main one', () => {
    expect(chooseEntrance([], null, road)).toBeNull();
    expect(chooseEntrance([back], null, [])).toBe(back);
    const a = entrance(3, [29, 41.1], { flats: '1-10' });
    const b = entrance(4, [29, 41.2], { flats: '11-20' });
    expect(chooseEntrance([a, b], 14, [])).toBe(b);
    const main = entrance(5, [29, 41.3], { kind: 'main' });
    expect(chooseEntrance([a, main, b], null, [])).toBe(main);
  });

  it('takes the one nearest the street, and none when nothing tells them apart', () => {
    expect(chooseEntrance([back, onRoad], null, road)).toBe(onRoad);
    expect(chooseEntrance([back, onRoad], null, [])).toBeNull();
    const twin = entrance(0, [29.0005, 41.00005]);
    expect(chooseEntrance([onRoad, twin], null, road)).toBe(twin);
  });
});

describe('arrivalOf with an entrance finder', () => {
  const r = region([part(1, 10, near)], [row(10, 'Bahariye Caddesi')]);
  it('asks the finder only when the place has no entrance and keeps its ref', async () => {
    const seen: LngLat[][][] = [];
    const find = async (chain: LngLat[][]) => (seen.push(chain), { point: [29.0001, 41.0001] as LngLat, ref: '3' });
    expect(await arrivalOf(r, place(), find)).toEqual({ door: [29, 41], entrance: [29.0001, 41.0001], entranceRef: '3', chain: near });
    expect(seen).toEqual([near]);
    expect(await arrivalOf(r, place({ entrance: [29.0002, 41.0001] }), find)).toEqual({ door: [29, 41], entrance: [29.0002, 41.0001], chain: near });
    expect(seen).toHaveLength(1);
    expect(await arrivalOf(r, place(), async () => null)).toEqual({ door: [29, 41], chain: near });
    expect(await arrivalOf(null, place(), async () => ({ point: [1, 2] as LngLat }))).toEqual({ door: [29, 41], entrance: [1, 2] });
  });
});
