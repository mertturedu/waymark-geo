import { predictNumber } from '../../src/core/address/predict';
import { createSearch } from '../../src/core/address/search';
import type { LayerNeighbour, LayerScope, Place, PointLayer } from '../../src/core/address/types';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { miniRegion } from './helpers/mini-pack';
import { LINE, streetRows } from './helpers/predict-fixture';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

const SIDE = 0.00005;
const at = (n: number): [number, number] => [28.6 + (n / 20) * 0.01, 40.7 - SIDE];
const neighbour = (int: number, trusted = true): LayerNeighbour => ({ int, coordinate: at(int), trusted });
const odd = (n: number) => ({ int: n, key: String(n), parity: 1 as const });

async function empty() {
  const fixture = await miniRegion(streetRows({ even: [], odd: [] }));
  const street = (await fixture.region.allNames('street')).find((n) => n.key === 'test') as { ref: number };
  const loc = (await fixture.region.hoodsOfStreet([street.ref]))[0] as { districtId: number; hoodId: number | null };
  return { ...fixture, street: { id: street.ref, districtId: loc.districtId, hoodId: loc.hoodId } };
}

describe('predictNumber with learned neighbours', () => {
  it('walks between two learned numbers on a street the map has no doors for', async () => {
    const { region, street, close } = await empty();
    const p = await predictNumber(region, street, odd(7), { extra: [neighbour(5), neighbour(9)] });
    expect(p).toMatchObject({ precision: 'interpolated', variant: 'B' });
    expect(p?.coordinate[0]).toBeCloseTo(at(7)[0], 6);
    expect(p?.coordinate[1]).toBeCloseTo(at(7)[1], 6);
    await close();
  });

  it('falls back to the street line when there is nobody to learn from', async () => {
    const { region, street, close } = await empty();
    expect((await predictNumber(region, street, odd(7), { extra: [] }))?.precision).toBe('street');
    expect((await predictNumber(region, street, odd(7)))?.precision).toBe('street');
    await close();
  });

  it('only listens to the same side of the street', async () => {
    const { region, street, close } = await empty();
    expect((await predictNumber(region, street, odd(7), { extra: [neighbour(6), neighbour(8)] }))?.precision).toBe('street');
    await close();
  });

  it('does not take the asked number itself as a neighbour', async () => {
    const { region, street, close } = await empty();
    const p = await predictNumber(region, street, odd(7), { extra: [neighbour(7), neighbour(9)] });
    expect(p?.variant).toBe('one-sided');
    expect(p?.coordinate).toEqual(at(9));
    await close();
  });

  it('is one sided with a single learned number', async () => {
    const { region, street, close } = await empty();
    const p = await predictNumber(region, street, odd(7), { extra: [neighbour(5)] });
    expect(p).toMatchObject({ variant: 'one-sided', precision: 'interpolated' });
    expect(p?.coordinate).toEqual(at(5));
    await close();
  });

  it('picks the nearest numbers out of the map doors and the learned ones together', async () => {
    const fixture = await miniRegion(streetRows({ even: [], odd: [3, 11] }));
    const street = (await fixture.region.allNames('street')).find((n) => n.key === 'test') as { ref: number };
    const loc = (await fixture.region.hoodsOfStreet([street.ref]))[0] as { districtId: number; hoodId: number | null };
    const target = { id: street.ref, districtId: loc.districtId, hoodId: loc.hoodId };
    const mixed = await predictNumber(fixture.region, target, odd(7), { extra: [neighbour(5), neighbour(9)] });
    const mapOnly = await predictNumber(fixture.region, target, odd(7));
    expect(mixed?.coordinate[0]).toBeCloseTo(at(7)[0], 6);
    expect(mapOnly?.coordinate[0]).toBeCloseTo(at(7)[0], 6);
    const tight = await predictNumber(fixture.region, target, odd(7), { extra: [{ int: 5, coordinate: [28.6025, 40.6999], trusted: true }, { int: 9, coordinate: [28.6045, 40.6999], trusted: true }] });
    expect(tight?.coordinate[0]).toBeGreaterThan(28.6025);
    expect(tight?.coordinate[0]).toBeLessThan(28.6045);
    expect(LINE[0]).toBeDefined();
    await fixture.close();
  });
});

describe('the resolver asks the layers for neighbours', () => {
  let pack = '';
  beforeAll(async () => {
    pack = await builtPack();
  });

  const searchWith = async (layer: PointLayer) => {
    const { store } = await memoryStore({ '34': pack });
    return createSearch({ store, borders: turkeyBorders(), layers: [layer] });
  };
  const kadikoy = async (s: Awaited<ReturnType<typeof searchWith>>, text: string): Promise<Place> => {
    const r = await s.resolve(text);
    const list = r.status === 'resolved' || r.status === 'ambiguous' ? r.candidates : [];
    return list.find((p) => p.components.district === 'Kadıköy') as Place;
  };

  it('passes the district, neighbourhood and street of the place', async () => {
    const asked: LayerScope[] = [];
    const s = await searchWith({ name: 'learned', lookup: async () => null, nearby: async (scope) => (asked.push(scope), []) });
    await kadikoy(s, 'Gül Sokak 20');
    expect(asked).toContainEqual({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' });
    expect(asked).toContainEqual({ region: '34', district: 'uskudar', neighbourhood: 'fener', street: 'gul~sokak' });
  });

  it('predicts between learned numbers instead of leaning on the one map door', async () => {
    const nearby = async (scope: LayerScope): Promise<LayerNeighbour[]> =>
      scope.district === 'kadikoy' ? [{ int: 18, coordinate: [28.64, 40.7], trusted: true }, { int: 24, coordinate: [28.66, 40.7], trusted: true }] : [];
    const s = await searchWith({ name: 'learned', lookup: async () => null, nearby });
    const place = await kadikoy(s, 'Gül Sokak 20');
    expect(place).toMatchObject({ source: 'interpolated', approximate: true, precision: 'interpolated' });
    expect(place.coordinate[0]).toBeGreaterThan(28.64);
    expect(place.coordinate[0]).toBeLessThan(28.66);
  });

  it('is not asked when a layer already knows the very number', async () => {
    let asked = 0;
    const s = await searchWith({ name: 'learned', lookup: async () => ({ coordinate: [28.66, 40.76], trusted: true }), nearby: async () => (asked++, []) });
    await kadikoy(s, 'Gül Sokak 20');
    expect(asked).toBe(0);
  });

  it('is not asked when the map has the number', async () => {
    let asked = 0;
    const s = await searchWith({ name: 'learned', lookup: async () => null, nearby: async (scope) => (scope.district === 'kadikoy' && asked++, []) });
    await kadikoy(s, 'Gül Sokak 14');
    expect(asked).toBe(0);
  });
});

describe('Learning.nearby', () => {
  const make = async (neighbours?: 'trusted' | 'all') => createLearning({ store: learnStore(), now: () => 1_700_000_000, neighbours });
  const gul = (houseNumber: string, district = 'Kadıköy', neighbourhood = 'Moda', street: string | null = 'Gül Sokak'): Place => ({
    id: 'x', label: 'x', components: { province: 'İstanbul', district, neighbourhood, street: street ?? undefined, houseNumber }, coordinate: [28.6, 40.7], precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.5, region: '34',
  });
  const scope: LayerScope = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' };

  it('lists the learned numbers of one street with their trust', async () => {
    const learning = await make('all');
    await learning.confirm({ place: gul('18'), point: [28.64, 40.7], source: 'pin' });
    await learning.confirm({ place: gul('24'), point: [28.66, 40.7], source: 'delivery' });
    const list = await (learning.layer.nearby as NonNullable<PointLayer['nearby']>)(scope);
    expect(list).toEqual([{ int: 18, coordinate: [28.64, 40.7], trusted: true }, { int: 24, coordinate: [28.66, 40.7], trusted: false }]);
  });

  it('can be told to listen to trusted points only', async () => {
    const learning = await make('trusted');
    await learning.confirm({ place: gul('18'), point: [28.64, 40.7], source: 'pin' });
    await learning.confirm({ place: gul('24'), point: [28.66, 40.7], source: 'delivery' });
    expect((await (learning.layer.nearby as NonNullable<PointLayer['nearby']>)(scope)).map((n) => n.int)).toEqual([18]);
  });

  it('keeps other streets, other districts, other neighbourhoods and street-less doors out', async () => {
    const learning = await make('all');
    await learning.confirm({ place: gul('18', 'Üsküdar', 'Fener'), point: [29.1, 40.7], source: 'pin' });
    await learning.confirm({ place: gul('20', 'Kadıköy', 'Moda', 'Atatürk Caddesi'), point: [28.64, 40.8], source: 'pin' });
    await learning.confirm({ place: gul('22', 'Kadıköy', 'Fener'), point: [28.64, 40.8], source: 'pin' });
    await learning.confirm({ place: gul('26', 'Kadıköy', 'Moda', null), point: [28.65, 40.7], source: 'pin' });
    expect(await (learning.layer.nearby as NonNullable<PointLayer['nearby']>)(scope)).toEqual([]);
  });

  it('drops a door from the list when it is forgotten and sorts the list by number', async () => {
    const learning = await make('all');
    for (const n of ['30', '4', '18']) await learning.confirm({ place: gul(n), point: [28.64, 40.7], source: 'pin' });
    const call = learning.layer.nearby as NonNullable<PointLayer['nearby']>;
    expect((await call(scope)).map((n) => n.int)).toEqual([4, 18, 30]);
    await learning.forget('34|kadikoy|moda|gul~sokak|18');
    expect((await call(scope)).map((n) => n.int)).toEqual([4, 30]);
  });

  it('leaves out a number that has no leading digits', async () => {
    const learning = await make('all');
    await learning.confirm({ place: gul('A'), point: [28.64, 40.7], source: 'pin' });
    expect(await (learning.layer.nearby as NonNullable<PointLayer['nearby']>)(scope)).toEqual([]);
  });

  it('serves what was learned after a restart', async () => {
    const store = learnStore();
    const first = await createLearning({ store, now: () => 1, neighbours: 'all' });
    await first.confirm({ place: gul('18'), point: [28.64, 40.7], source: 'pin' });
    const again = await createLearning({ store, neighbours: 'all' });
    expect((await (again.layer.nearby as NonNullable<PointLayer['nearby']>)(scope)).map((n) => n.int)).toEqual([18]);
  });
});

describe('a learned neighbourhood end to end', () => {
  it('predicts an unlearned number between two confirmed ones', async () => {
    const pack = await builtPack();
    const { store } = await memoryStore({ '34': pack });
    const learning = await createLearning({ store: learnStore(), now: () => 5, neighbours: 'all' });
    const s = createSearch({ store, borders: turkeyBorders(), layers: [learning.layer] });
    const first = await s.resolve('Gül Sokak 18');
    const base = first.status === 'resolved' || first.status === 'ambiguous' ? (first.candidates.find((p) => p.components.district === 'Kadıköy') as Place) : null;
    await learning.confirm({ place: base as Place, point: [28.64, 40.7], source: 'pin' });
    await learning.confirm({ place: { ...(base as Place), components: { ...(base as Place).components, houseNumber: '24' } }, point: [28.66, 40.7], source: 'pin' });
    const result = await s.resolve('Gül Sokak 20');
    const list = result.status === 'resolved' || result.status === 'ambiguous' ? result.candidates : [];
    const place = list.find((p) => p.components.district === 'Kadıköy') as Place;
    expect(place).toMatchObject({ source: 'interpolated', approximate: true });
    expect(place.coordinate[0]).toBeGreaterThan(28.64);
    expect(place.coordinate[0]).toBeLessThan(28.66);
  });
});
