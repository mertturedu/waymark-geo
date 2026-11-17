import { predictNumber } from '../../src/core/address/predict';
import { createSearch } from '../../src/core/address/search';
import type { LayerNeighbour, LayerPoint, Place, PointLayer } from '../../src/core/address/types';
import { miniRegion } from './helpers/mini-pack';
import { crowdRows } from './helpers/crowd-fixture';
import { streetRows } from './helpers/predict-fixture';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

const stub = (name: PointLayer['name'], pick: (k: Parameters<PointLayer['lookup']>[0]) => LayerPoint | null, nearby?: PointLayer['nearby']): PointLayer => ({ name, lookup: async (k) => pick(k), nearby });

describe('H1 a learned door is asked for however many streets the name matches', () => {
  it('shows a pinned door on the last of ten similar streets', async () => {
    const file = await builtPack(crowdRows());
    const { store } = await memoryStore({ '34': file });
    const pinned: LayerPoint = { coordinate: [28.79, 40.8], trusted: true };
    const s = createSearch({ store, borders: turkeyBorders(), layers: [stub('learned', (k) => (k.street === 'lale~yol' && k.houseNumber === '3' ? pinned : null))] });
    const result = await s.resolve('Lale 3');
    const list = result.status === 'resolved' || result.status === 'ambiguous' ? result.candidates : [];
    expect(list.some((p) => p.source === 'learned' && p.coordinate[0] === pinned.coordinate[0])).toBe(true);
  });
});

describe('H2 learned places of one street in two districts', () => {
  it('both reach the answer', async () => {
    const file = await builtPack();
    const { store } = await memoryStore({ '34': file });
    const s = createSearch({ store, borders: turkeyBorders(), layers: [stub('learned', (k) => (k.street === 'gul~sokak' && k.houseNumber === '20' ? { coordinate: k.district === 'kadikoy' ? [28.66, 40.76] : [29.15, 40.71], trusted: true } : null))] });
    const result = await s.resolve('Gül Sokak 20', { limit: 10 });
    const list = result.status === 'resolved' || result.status === 'ambiguous' ? result.candidates : [];
    const learned = list.filter((p) => p.source === 'learned');
    expect(learned.map((p) => p.components.district).sort()).toEqual(['Kadıköy', 'Üsküdar']);
    expect(new Set(learned.map((p) => p.id)).size).toBe(2);
  });
});

describe('neighbours from two layers', () => {
  it('prefers the trusted one for the same number', async () => {
    const file = await builtPack();
    const { store } = await memoryStore({ '34': file });
    const a = stub('learned', () => null, async (scope) => (scope.district === 'kadikoy' ? [{ int: 18, coordinate: [28.64, 40.7], trusted: false }, { int: 24, coordinate: [28.66, 40.7], trusted: true }] : []));
    const b = stub('correction', () => null, async (scope) => (scope.district === 'kadikoy' ? [{ int: 18, coordinate: [28.645, 40.7], trusted: true }] : []));
    const s = createSearch({ store, borders: turkeyBorders(), layers: [a, b] });
    const result = await s.resolve('Gül Sokak 20 Kadıköy');
    const list = result.status === 'resolved' || result.status === 'ambiguous' ? result.candidates : [];
    const place = list.find((p) => p.components.district === 'Kadıköy') as Place;
    expect(place.source).toBe('interpolated');
    expect(place.coordinate[0]).toBeGreaterThan(28.645);
    expect(place.coordinate[0]).toBeLessThan(28.66);
  });
});

describe('learned neighbours count as part of the same neighbourhood', () => {
  it('beat map doors that sit further away in the same district', async () => {
    const fixture = await miniRegion(streetRows({ even: [], odd: [3, 11] }));
    const street = (await fixture.region.allNames('street')).find((n) => n.key === 'test') as { ref: number };
    const loc = (await fixture.region.hoodsOfStreet([street.ref]))[0] as { districtId: number; hoodId: number | null };
    const target = { id: street.ref, districtId: loc.districtId, hoodId: loc.hoodId };
    expect(loc.hoodId).not.toBeNull();
    const shifted = (n: number): LayerNeighbour => ({ int: n, coordinate: [28.6 + (n / 20) * 0.01, 40.7005], trusted: true });
    const p = await predictNumber(fixture.region, target, { int: 7, key: '7', parity: 1 }, { extra: [shifted(5), shifted(9)] });
    expect(p?.coordinate[1]).toBeGreaterThan(40.7004);
    await fixture.close();
  });
});
