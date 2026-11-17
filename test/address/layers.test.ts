import fc from 'fast-check';
import { createSearch, type Search } from '../../src/core/address/search';
import type { LayerKey, LayerPoint, Place, PointLayer } from '../../src/core/address/types';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let pack = '';

beforeAll(async () => {
  pack = await builtPack();
});

const searchWith = async (...layers: PointLayer[]): Promise<Search> => {
  const { store } = await memoryStore({ '34': pack });
  return createSearch({ store, borders: turkeyBorders(), layers });
};

const stub = (name: PointLayer['name'], pick: (key: LayerKey) => LayerPoint | null, seen: LayerKey[] = []): PointLayer => ({
  name,
  lookup: async (key) => (seen.push(key), pick(key)),
});

const candidates = async (s: Search, text: string): Promise<Place[]> => {
  const result = await s.resolve(text);
  return result.status === 'resolved' || result.status === 'ambiguous' ? result.candidates : [];
};

const inDistrict = (list: Place[], district: string): Place => list.find((p) => p.components.district === district) as Place;

const KADIKOY: LayerPoint = { coordinate: [28.66, 40.76], trusted: true };
const USKUDAR: LayerPoint = { coordinate: [29.15, 40.71], trusted: true };

describe('the key a layer is asked with', () => {
  it('carries the district, the neighbourhood and the street kind of every place the street runs through', async () => {
    const seen: LayerKey[] = [];
    await candidates(await searchWith(stub('learned', () => null, seen)), 'Gül Sokak 20');
    expect(seen).toContainEqual({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' });
    expect(seen).toContainEqual({ region: '34', district: 'uskudar', neighbourhood: 'fener', street: 'gul~sokak', houseNumber: '20' });
  });
});

describe('a learned point belongs to one district', () => {
  it('lands on the district it was learned in and not on the same street of another district', async () => {
    const list = await candidates(await searchWith(stub('learned', (k) => (k.district === 'kadikoy' ? KADIKOY : null))), 'Gül Sokak 20');
    expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'learned', coordinate: KADIKOY.coordinate, precision: 'address', approximate: false });
    expect(inDistrict(list, 'Üsküdar')).toMatchObject({ source: 'interpolated', approximate: true });
  });

  it('also lands on a district that is not the first one the street runs through', async () => {
    const list = await candidates(await searchWith(stub('learned', (k) => (k.district === 'uskudar' ? USKUDAR : null))), 'Gül Sokak 20');
    expect(inDistrict(list, 'Üsküdar')).toMatchObject({ source: 'learned', coordinate: USKUDAR.coordinate });
    expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'interpolated' });
  });

  it('lands on one neighbourhood only', async () => {
    const list = await candidates(await searchWith(stub('learned', (k) => (k.neighbourhood === 'fener' ? USKUDAR : null))), 'Gül Sokak 20');
    expect(inDistrict(list, 'Üsküdar').source).toBe('learned');
    expect(inDistrict(list, 'Kadıköy').source).toBe('interpolated');
  });
});

describe('a learned point and the map', () => {
  it('lets a trusted learned point stand in front of a map address', async () => {
    const list = await candidates(await searchWith(stub('learned', (k) => (k.district === 'kadikoy' ? KADIKOY : null))), 'Gül Sokak 14');
    expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'learned', precision: 'address', approximate: false, coordinate: KADIKOY.coordinate });
  });

  it('keeps the map address when the learned point is not trusted', async () => {
    const list = await candidates(await searchWith(stub('learned', () => ({ coordinate: KADIKOY.coordinate, trusted: false }))), 'Gül Sokak 14');
    expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'osm', precision: 'address', approximate: false, coordinate: [28.65, 40.75] });
  });

  it('uses an untrusted learned point where the map has no such number, as an estimate', async () => {
    const list = await candidates(await searchWith(stub('learned', (k) => (k.district === 'kadikoy' ? { coordinate: KADIKOY.coordinate, trusted: false } : null))), 'Gül Sokak 20');
    expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'learned', precision: 'interpolated', approximate: true, coordinate: KADIKOY.coordinate });
  });
});

describe('which layer wins', () => {
  const learned = (trusted: boolean) => stub('learned', (k) => (k.district === 'kadikoy' ? { coordinate: [28.61, 40.71], trusted } : null));
  const correction = (trusted: boolean) => stub('correction', (k) => (k.district === 'kadikoy' ? { coordinate: [28.62, 40.72], trusted } : null));
  const winner = async (...layers: PointLayer[]): Promise<Place> => inDistrict(await candidates(await searchWith(...layers), 'Gül Sokak 20'), 'Kadıköy');

  it('lets a trusted correction beat an untrusted learned point whatever the order', async () => {
    expect(await winner(learned(false), correction(true))).toMatchObject({ source: 'correction', approximate: false });
    expect(await winner(correction(true), learned(false))).toMatchObject({ source: 'correction', approximate: false });
  });

  it('lets the earlier layer win between two trusted points', async () => {
    expect(await winner(learned(true), correction(true))).toMatchObject({ source: 'learned' });
    expect(await winner(correction(true), learned(true))).toMatchObject({ source: 'correction' });
  });

  it('lets the earlier layer win between two untrusted points', async () => {
    expect(await winner(learned(false), correction(false))).toMatchObject({ source: 'learned', approximate: true });
  });
});

describe('what the learner gives back to the resolver', () => {
  it('serves a confirmed door on the next search, for any way of writing it', async () => {
    const learning = await createLearning({ store: learnStore(), now: () => 1_700_000_000 });
    const s = await searchWith(learning.layer);
    const first = inDistrict(await candidates(s, 'Gül Sokak 20'), 'Kadıköy');
    expect(first.source).toBe('interpolated');
    expect(await learning.confirm({ place: first, point: [28.6601, 40.7601], source: 'pin' })).toMatchObject({ ok: true, trusted: true });
    for (const text of ['Gül Sokak 20', 'gul sk no 20 moda kadikoy', 'İstanbul Kadıköy Moda Mah. Gül Sokak No:20']) {
      const list = await candidates(s, text);
      expect(inDistrict(list, 'Kadıköy')).toMatchObject({ source: 'learned', coordinate: [28.6601, 40.7601], approximate: false });
      expect(inDistrict(list, 'Üsküdar')?.source ?? 'interpolated').toBe('interpolated');
    }
  });

  it('does not serve it for a neighbouring number', async () => {
    const learning = await createLearning({ store: learnStore(), now: () => 1 });
    const s = await searchWith(learning.layer);
    await learning.confirm({ place: inDistrict(await candidates(s, 'Gül Sokak 20'), 'Kadıköy'), point: [28.6601, 40.7601], source: 'pin' });
    expect(inDistrict(await candidates(s, 'Gül Sokak 22'), 'Kadıköy').source).toBe('interpolated');
  });
});

describe('the honesty of a result that did not come from the map', () => {
  it('never calls an untrusted point an address, whatever the layer says', () => {
    return fc.assert(
      fc.asyncProperty(fc.constantFrom('Gül Sokak 12', 'Gül Sokak 14', 'Gül Sokak 20', 'Bahariye Caddesi 14', 'Bahariye Caddesi 30'), fc.boolean(), fc.double({ min: 28.5, max: 29.3, noNaN: true }), fc.double({ min: 40.5, max: 40.9, noNaN: true }), async (text, trusted, lng, lat) => {
        const s = await searchWith(stub('learned', () => ({ coordinate: [lng, lat], trusted })), stub('correction', () => ({ coordinate: [lng, lat], trusted: false })));
        for (const p of await candidates(s, text)) {
          const real = p.source === 'osm' || (p.source === 'learned' && trusted);
          if (!real) {
            expect(p.approximate).toBe(true);
            expect(p.precision).not.toBe('address');
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});

describe('doors without a street', () => {
  const MODA = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: '' };
  const find = async (s: Search, text: string): Promise<Place | undefined> => (await candidates(s, text)).find((p) => p.components.district === 'Kadıköy');

  it('asks the layers with an empty street part', async () => {
    const seen: LayerKey[] = [];
    await find(await searchWith(stub('learned', () => null, seen)), 'Moda Mahallesi Kadıköy No:21');
    expect(seen).toContainEqual({ ...MODA, houseNumber: '21' });
  });

  it('lets a trusted learned point stand in front of the map door', async () => {
    const s = await searchWith(stub('learned', (k) => (k.street === '' && k.houseNumber === '7' ? KADIKOY : null)));
    expect(await find(s, 'Moda Mahallesi Kadıköy No:7')).toMatchObject({ source: 'learned', coordinate: KADIKOY.coordinate, precision: 'address', approximate: false });
  });

  it('keeps the map door when the learned point is not trusted', async () => {
    const s = await searchWith(stub('learned', () => ({ coordinate: KADIKOY.coordinate, trusted: false })));
    expect(await find(s, 'Moda Mahallesi Kadıköy No:7')).toMatchObject({ source: 'osm', precision: 'address' });
  });

  it('gives an untrusted learned point as an estimate where the map has no such door', async () => {
    const s = await searchWith(stub('learned', (k) => (k.street === '' && k.houseNumber === '21' ? { coordinate: KADIKOY.coordinate, trusted: false } : null)));
    expect(await find(s, 'Moda Mahallesi Kadıköy No:21')).toMatchObject({ source: 'learned', precision: 'interpolated', approximate: true, label: 'Moda Mah. No:21, Kadıköy/İstanbul' });
  });

  it('answers nothing for a door nobody learned and the map does not have', async () => {
    const s = await searchWith(stub('learned', () => null));
    expect(await find(s, 'Moda Mahallesi Kadıköy No:21')).toBeUndefined();
  });

  it('serves what the learner was told about a door of a neighbourhood', async () => {
    const learning = await createLearning({ store: learnStore(), now: () => 1 });
    const s = await searchWith(learning.layer);
    const hood = (await find(s, 'Moda Mahallesi Kadıköy')) as Place;
    expect(hood.precision).toBe('neighbourhood');
    expect(await learning.confirm({ place: hood, houseNumber: '21', point: [28.66, 40.76], source: 'pin' })).toMatchObject({ ok: true, trusted: true });
    expect(await find(s, 'Moda Mahallesi Kadıköy No:21')).toMatchObject({ source: 'learned', coordinate: [28.66, 40.76], approximate: false });
  });
});
