import fc from 'fast-check';
import { createSearch, type Search } from '../../src/core/address/search';
import type { Place, ResolveResult } from '../../src/core/address/types';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const WORDS = ['bahariye', 'cd', 'caddesi', 'sokak', 'sk', 'gul', 'zeytin', 'ataturk', 'kadikoy', 'uskudar', 'moda', 'fener', 'mah', 'no', 'devlet', 'hastane', 'merkez', 'eczane', '14', '3', '5', '36', '1707', '1708', 'istanbul', '12', 'daire', 'avm'];
const query = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 7 }).map((w) => w.join(' '));
const noisy = fc.oneof(query, fc.string({ maxLength: 40 }), fc.constant(''), fc.string({ unit: 'grapheme', maxLength: 20 }));

const candidatesOf = (r: ResolveResult): Place[] => (r.status === 'region_missing' ? [] : r.candidates);

function consistent(place: Place): boolean {
  if (place.precision === 'address') return !place.approximate && ['osm', 'correction', 'learned'].includes(place.source);
  if (place.precision === 'poi') return !place.approximate && place.source === 'osm';
  return place.approximate;
}

describe('resolve properties', () => {
  it('gives the same answer twice', async () => {
    await fc.assert(fc.asyncProperty(noisy, async (text) => expect(await search.resolve(text)).toEqual(await search.resolve(text))), { numRuns: 150, seed: 51 });
  });

  it('keeps to the limit, lists each place once and has the best one among the candidates', async () => {
    await fc.assert(
      fc.asyncProperty(noisy, fc.integer({ min: 1, max: 8 }), async (text, limit) => {
        const result = await search.resolve(text, { limit });
        const list = candidatesOf(result);
        expect(list.length).toBeLessThanOrEqual(limit);
        expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
        if (result.status === 'resolved') expect(list.map((p) => p.id)).toContain(result.best.id);
        if (result.status === 'not_found') expect(list).toEqual([]);
      }),
      { numRuns: 200, seed: 52 },
    );
  });

  it('calls only a real door an address, and every guess a guess', async () => {
    await fc.assert(fc.asyncProperty(noisy, async (text) => candidatesOf(await search.resolve(text)).every(consistent)), { numRuns: 300, seed: 53 });
  });

  it('never gives a street with another street number', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('1707. Sokak', '1707 sk', '1707. sokak no 3', '1708. Sokak 3', '1708 sk 3'), async (text) => {
        const want = text.startsWith('1707') ? '1707. Sokak' : '1708. Sokak';
        for (const p of candidatesOf(await search.resolve(text))) if (p.components.street && /^\d+\./.test(p.components.street)) expect(p.components.street).toBe(want);
      }),
      { numRuns: 30, seed: 54 },
    );
  });

  it('suggestions follow the same rules', async () => {
    await fc.assert(
      fc.asyncProperty(noisy, fc.integer({ min: 1, max: 8 }), async (text, limit) => {
        const list = await search.autocomplete(text, { limit });
        expect(list.length).toBeLessThanOrEqual(limit);
        expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
        expect(list.every(consistent)).toBe(true);
      }),
      { numRuns: 200, seed: 55 },
    );
  });

  it('reverse always keeps the asked point and calls itself approximate', async () => {
    await fc.assert(
      fc.asyncProperty(fc.double({ min: 28.4, max: 29.6, noNaN: true }), fc.double({ min: 40.4, max: 41.6, noNaN: true }), async (lng, lat) => {
        const place = await search.reverse([lng, lat]);
        if (place) {
          expect(place.coordinate).toEqual([lng, lat]);
          expect(place.approximate).toBe(true);
        }
      }),
      { numRuns: 150, seed: 56 },
    );
  });
});
