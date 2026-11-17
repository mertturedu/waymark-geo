import fc from 'fast-check';
import { createSearch, type Search } from '../../src/core/address/search';
import { validPlace } from '../../scripts/measure-quality';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const SPECIAL = ['😀🏠', '‮‭Atatürk', 'a​b‌c‍d', "'; DROP TABLE address; --", '" OR 1=1 --', '%_', '\0\0', '\ud800', 'x'.repeat(5000), '9'.repeat(400), '١٢٣٤٥', '../../etc/passwd', '\n\t\r', '   ', '1.2.3.4.5.6.7', 'No:-1', 'sk.sk.sk.cd.cd.mah', 'İİİİİİ', 'ǅ', 'ß'.repeat(200), '(((((', '\\'.repeat(50)];
const anyText = fc.oneof(fc.constantFrom(...SPECIAL), fc.string({ maxLength: 60 }), fc.string({ unit: 'binary', maxLength: 60 }), fc.array(fc.constantFrom('bahariye', 'cd', 'no', '14', 'moda', 'mah', '😀', '‮', 'x', '0', 'kadikoy'), { maxLength: 12 }).map((w) => w.join(' ')));

describe('fuzz', () => {
  it('never throws and always returns a sound answer for 10000 odd inputs', async () => {
    const inputs = fc.sample(anyText, { numRuns: 10_000, seed: 61 });
    let answers = 0;
    for (const [index, text] of inputs.entries()) {
      const result = await search.resolve(text, index % 5 === 0 ? { limit: 3, hints: { city: 'İstanbul', district: 'Kadıköy' } } : {});
      expect(['resolved', 'ambiguous', 'not_found', 'region_missing']).toContain(result.status);
      if (result.status !== 'region_missing') expect(result.candidates.every(validPlace)).toBe(true);
      if (index % 4 === 0) expect((await search.autocomplete(text)).every(validPlace)).toBe(true);
      answers += 1;
    }
    expect(answers).toBe(10_000);
  }, 120_000);

  it('survives odd structured queries, hints, points and limits', async () => {
    const part = fc.option(anyText, { nil: undefined });
    const structured = fc.record({ province: part, district: part, neighbourhood: part, street: part, houseNumber: part, building: part, door: part, poiName: part });
    for (const q of fc.sample(structured, { numRuns: 500, seed: 62 })) expect(['resolved', 'ambiguous', 'not_found', 'region_missing']).toContain((await search.resolve(q)).status);
    const odd = [Number.NaN, Infinity, -Infinity, 0, -1, 1e9, 0.5];
    for (const lng of [...odd, 28.6, -180, 180]) {
      for (const lat of [...odd, 40.7, -90, 90]) {
        const place = await search.reverse([lng, lat]);
        if (place) expect(validPlace(place)).toBe(true);
        expect(['resolved', 'ambiguous', 'not_found', 'region_missing']).toContain((await search.resolve('bahariye cd 14', { near: [lng, lat] })).status);
      }
    }
    for (const limit of odd) {
      const result = await search.resolve('bahariye', { limit });
      if (result.status !== 'region_missing') expect(result.candidates.length).toBeLessThanOrEqual(Math.max(1, Math.floor(limit > 0 && Number.isFinite(limit) ? limit : 5)));
      expect(Array.isArray(await search.autocomplete('baha', { limit }))).toBe(true);
    }
  }, 120_000);

  it('treats a limit that is not a sensible number as the default', async () => {
    for (const limit of [Number.NaN, Infinity, -Infinity]) {
      const result = await search.resolve('bahariye cd 14', { limit });
      expect(result.status).toBe('resolved');
      if (result.status === 'resolved') expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect((await search.autocomplete('baha', { limit })).length).toBeGreaterThanOrEqual(1);
    }
    const huge = await search.autocomplete('a', { limit: 1e9 });
    expect(huge.length).toBeLessThanOrEqual(50);
    expect((await search.resolve('bahariye', { limit: 1e9 })).status === 'region_missing').toBe(false);
  });
});
