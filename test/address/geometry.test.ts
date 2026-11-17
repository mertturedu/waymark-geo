import { shapeOf } from '../../src/core/address/geometry';
import type { Region } from '../../src/core/address/pack';
import { createSearch } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import type { LngLat } from '../../src/core/geo/cells';
import { inBbox } from '../../src/core/geo/simplify';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

const place = (over: Partial<Place>): Place => ({ id: '34:s:7:5', label: '', components: { district: 'Kadıköy', street: 'Moda Sokak' }, coordinate: [29, 41], precision: 'street', approximate: true, source: 'derived', confidence: 1, region: '34', ...over });
const line = (n: number): LngLat[] => Array.from({ length: n }, (_, i) => [29 + i * 0.0001, 41 + (i % 2) * 0.00001] as LngLat);
const ring: LngLat[] = [[29, 41], [29.01, 41], [29.01, 41.01], [29, 41.01], [29, 41]];

function region(over: Partial<Record<string, unknown>> = {}): Region {
  const parts: Record<number, { id: number; districtId: number; hoodId: number | null; lines: LngLat[][] }[]> = {
    7: [{ id: 1, districtId: 1, hoodId: 5, lines: [line(30)] }, { id: 2, districtId: 1, hoodId: 6, lines: [line(20), [[29.5, 41.5]] as LngLat[]] }, { id: 3, districtId: 2, hoodId: 9, lines: [line(10)] }],
    8: [{ id: 4, districtId: 1, hoodId: null, lines: [[[29.2, 41.2], [29.21, 41.2]]] }],
    9: [{ id: 5, districtId: 1, hoodId: null, lines: [[[29.3, 41.3]]] }],
  };
  return {
    id: '34',
    districts: [{ id: 1, name: 'Kadıköy', key: 'kadikoy', center: [29, 41] }, { id: 2, name: 'Üsküdar', key: 'uskudar', center: [29.1, 41] }],
    hoods: [{ id: 5, districtId: 1, name: 'Moda', key: 'moda' }, { id: 6, districtId: 1, name: 'Fenerbahçe', key: 'fenerbahce' }],
    streetsByIds: async (ids: number[]) => ids.filter((i) => i in parts || i === 10).map((id) => ({ id, name: 'Moda Sokak', key: 'moda sokak', kind: id === 10 ? 'cadde' : 'sokak', number: null })),
    streetCandidates: async () => [{ nameId: 7, key: 'moda sokak' }, { nameId: 8, key: 'moda sokak' }, { nameId: 10, key: 'moda sokak' }, { nameId: 11, key: 'baska' }],
    partsOf: async (id: number) => parts[id] ?? [],
    db: { all: async () => [{ lo: 2, hi: 84 }] },
    districtPolygons: async () => new Map([[1, [[ring]]]]),
    hoodPolygons: async () => new Map([[5, [[ring, ring]]]]),
    ...over,
  } as unknown as Region;
}

const bounds = (plate: string) => (plate === '34' ? ([27, 40, 30, 42] as [number, number, number, number]) : null);

describe('shapeOf for a street', () => {
  it('joins the parts of that street in its district, marks the ones in the written neighbourhood and gives the number range', async () => {
    const shape = await shapeOf(region(), place({}), bounds);
    expect(shape?.geometry).toMatchObject({ kind: 'street', numbers: [2, 84], parts: 3 });
    const g = shape?.geometry as Extract<NonNullable<typeof shape>['geometry'], { kind: 'street' }>;
    expect(g.lines).toHaveLength(3);
    expect(g.local).toEqual([0]);
    expect(inBbox(shape?.bbox as never, [29, 41])).toBe(true);
    expect(inBbox(shape?.bbox as never, [29.205, 41.2])).toBe(true);
  });

  it('keeps every part when the district is not known or has none of it, and works with no hood', async () => {
    const lost = await shapeOf(region(), place({ id: '34:s:7:0', components: { district: 'Yok' } }), bounds);
    expect((lost?.geometry as { lines: unknown[]; local: number[] }).lines).toHaveLength(4);
    expect((lost?.geometry as { local: number[] }).local).toEqual([]);
    const other = await shapeOf(region(), place({ id: '34:s:7:0', components: { district: 'Üsküdar' }, local: { district: 'Üsküdar' } }), bounds);
    expect((other?.geometry as { lines: unknown[] }).lines).toHaveLength(1);
    const none = await shapeOf(region(), place({ components: {} }), bounds);
    expect(none?.geometry).not.toBeNull();
    const nowhere = await shapeOf(region({ db: { all: async () => [{ lo: null, hi: null }] } }), place({ id: '34:s:8:0' }), bounds);
    expect((nowhere?.geometry as { numbers: unknown }).numbers).toBeNull();
    expect((await shapeOf(region({ db: { all: async () => [] } }), place({ id: '34:s:8:0' }), bounds))?.geometry).toMatchObject({ numbers: null });
  });

  it('thins a long street to the point budget and gives nothing for a street without lines or rows', async () => {
    const big = region({ partsOf: async () => [{ id: 1, districtId: 1, hoodId: 5, lines: [Array.from({ length: 6000 }, (_, i) => [29 + i * 0.00002, 41 + ((i * 7919) % 100) * 0.000004] as LngLat)] }] });
    const shape = await shapeOf(big, place({}), bounds);
    expect((shape?.geometry as { points: number }).points).toBeLessThanOrEqual(1500);
    expect(await shapeOf(region({ streetCandidates: async () => [] }), place({ id: '34:s:9:0' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:s:99:0' }), bounds)).toBeNull();
    expect(await shapeOf(region({ partsOf: async () => [] }), place({}), bounds)).toBeNull();
  });
});

describe('shapeOf for areas and others', () => {
  it('gives the boundary of a neighbourhood and a district, and only a box for a province', async () => {
    const hood = await shapeOf(region(), place({ id: '34:h:5', precision: 'neighbourhood' }), bounds);
    expect(hood?.geometry).toMatchObject({ kind: 'area', level: 'neighbourhood' });
    expect(hood?.bbox).toEqual([29, 41, 29.01, 41.01]);
    expect((await shapeOf(region(), place({ id: '34:d:1', precision: 'district' }), bounds))?.geometry).toMatchObject({ kind: 'area', level: 'district' });
    expect(await shapeOf(region(), place({ id: '34:h:99', precision: 'neighbourhood' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:d:99', precision: 'district' }), bounds)).toBeNull();
    expect(await shapeOf(region({ hoods: [] }), place({ id: '34:h:5', precision: 'neighbourhood' }), bounds)).toBeNull();
    expect(await shapeOf(region({ hoodPolygons: async () => new Map([[5, []]]) }), place({ id: '34:h:5', precision: 'neighbourhood' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:p:0', precision: 'province' }), bounds)).toEqual({ geometry: null, bbox: [27, 40, 30, 42] });
    expect(await shapeOf(region(), place({ id: '06:p:0', precision: 'province', region: '06' }), () => null)).toBeNull();
  });

  it('has no shape for a door, a place, another region or an id it cannot read', async () => {
    expect(await shapeOf(region(), place({ id: '34:a:5', precision: 'address' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '06:s:7:0' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:s:x:0' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:h:x', precision: 'neighbourhood' }), bounds)).toBeNull();
    expect(await shapeOf(region(), place({ id: '34:d:x', precision: 'district' }), bounds)).toBeNull();
  });
});

describe('search with geometry', () => {
  it('attaches the line and the box to a street result only when asked, and answers geometry() for a place', async () => {
    const made = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store: made.store, borders: turkeyBorders() });
    const plain = await search.resolve('Bahariye Caddesi Kadıköy İstanbul');
    const asked = await search.resolve('Bahariye Caddesi Kadıköy İstanbul', { geometry: true });
    const top = asked.status === 'resolved' ? asked.best : asked.status === 'ambiguous' ? asked.candidates[0] : undefined;
    const bare = plain.status === 'resolved' ? plain.best : plain.status === 'ambiguous' ? plain.candidates[0] : undefined;
    expect(top?.precision).toBe('street');
    expect(top?.geometry?.kind).toBe('street');
    expect(inBbox(top?.bbox as never, top?.coordinate as LngLat)).toBe(true);
    expect(bare?.geometry).toBeUndefined();
    expect(await search.geometry(top as Place)).toMatchObject({ geometry: { kind: 'street' } });
    expect(await search.geometry({ ...(top as Place), id: '06:s:1:0' })).toBeNull();
    expect(await search.geometry({ ...(top as Place), id: '' })).toBeNull();
    expect(await search.geometry({ ...(top as Place), id: '34:o:1', precision: 'poi' })).toBeNull();
    const hood = await search.resolve('Moda Mahallesi Kadıköy', { geometry: true });
    const area = hood.status === 'resolved' ? hood.best : hood.status === 'ambiguous' ? hood.candidates[0] : undefined;
    expect(area?.bbox).toBeDefined();
    expect((await search.resolve('Yok Yok 99 Yok', { geometry: true })).status).not.toBe('region_missing');
    const missing = createSearch({ store: (await memoryStore({})).store, borders: turkeyBorders() });
    expect((await missing.resolve('Bahariye Caddesi 14 Kadıköy İstanbul', { geometry: true })).status).toBe('region_missing');
    await made.close();
  });
});
