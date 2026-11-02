import fc from 'fast-check';
import { createSearch } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import type { ConfirmSource } from '../../src/core/learn/types';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

const M = 111_195;
let pack = '';
beforeAll(async () => {
  pack = await builtPack();
});

const session = async () => {
  const { store } = await memoryStore({ '34': pack });
  const learning = await createLearning({ store: learnStore(), now: () => 1_700_000_000, neighbours: 'all' });
  const search = createSearch({ store, borders: turkeyBorders(), layers: [learning.layer] });
  const find = async (text: string): Promise<Place> => {
    const r = await search.resolve(text);
    const list = r.status === 'resolved' || r.status === 'ambiguous' ? r.candidates : [];
    return list.find((p) => p.components.district === 'Kadıköy') as Place;
  };
  return { learning, find };
};

const east = (m: number): [number, number] => [28.66 + m / (M * Math.cos((40.76 * Math.PI) / 180)), 40.76];

describe('K4.6 what a learned point may be called', () => {
  it('never lets a single delivery stand as an exact address', async () => {
    await fc.assert(
      fc.asyncProperty(fc.double({ min: 26, max: 44, noNaN: true }), fc.double({ min: 36, max: 42, noNaN: true }), fc.option(fc.double({ min: 0.1, max: 500, noNaN: true }), { nil: undefined }), async (lng, lat, accuracyM) => {
        const { learning, find } = await session();
        const base = await find('Gül Sokak 20');
        const result = await learning.confirm({ place: base, point: [lng, lat], source: 'delivery', accuracyM });
        expect(result).toMatchObject({ ok: true, trusted: false });
        const after = await find('Gül Sokak 20');
        expect(after).toMatchObject({ source: 'learned', approximate: true });
        expect(after.precision).not.toBe('address');
      }),
      { numRuns: 25 },
    );
  });

  it('lets a single pin stand as an exact address', async () => {
    const { learning, find } = await session();
    await learning.confirm({ place: await find('Gül Sokak 20'), point: east(0), source: 'pin' });
    expect(await find('Gül Sokak 20')).toMatchObject({ source: 'learned', approximate: false, precision: 'address' });
  });

  it('lets a manual point stand as an exact address too', async () => {
    const { learning, find } = await session();
    await learning.confirm({ place: await find('Gül Sokak 20'), point: east(0), source: 'manual' });
    expect(await find('Gül Sokak 20')).toMatchObject({ source: 'learned', approximate: false });
  });

  it('lets two deliveries that agree stand as an exact address and not two that do not', async () => {
    const close = await session();
    await close.learning.confirm({ place: await close.find('Gül Sokak 20'), point: east(0), source: 'delivery' });
    await close.learning.confirm({ place: await close.find('Gül Sokak 20'), point: east(30), source: 'delivery' });
    expect(await close.find('Gül Sokak 20')).toMatchObject({ source: 'learned', approximate: false });
    const far = await session();
    await far.learning.confirm({ place: await far.find('Gül Sokak 20'), point: east(0), source: 'delivery' });
    await far.learning.confirm({ place: await far.find('Gül Sokak 20'), point: east(100), source: 'delivery' });
    expect(await far.find('Gül Sokak 20')).toMatchObject({ source: 'learned', approximate: true });
  });

  it('lets a lone outlier among agreeing deliveries change nothing about trust', async () => {
    const { learning, find } = await session();
    for (const m of [0, 8, 400]) await learning.confirm({ place: await find('Gül Sokak 20'), point: east(m), source: 'delivery' });
    expect(await find('Gül Sokak 20')).toMatchObject({ approximate: false });
  });

  it('only trusts deliveries after at least two of them, whatever they say', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.double({ min: -500, max: 500, noNaN: true }), fc.constantFrom<ConfirmSource>('delivery')), { minLength: 1, maxLength: 6 }), async (list) => {
        const { learning, find } = await session();
        let last = { ok: false } as Awaited<ReturnType<typeof learning.confirm>>;
        for (const [m, source] of list) last = await learning.confirm({ place: await find('Gül Sokak 20'), point: east(m), source });
        if (list.length === 1) expect(last).toMatchObject({ trusted: false });
        const after = await find('Gül Sokak 20');
        if (!after.approximate) expect(list.length).toBeGreaterThanOrEqual(2);
      }),
      { numRuns: 25 },
    );
  });
});
