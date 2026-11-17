import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const precisionOf = async (text: string): Promise<string> => {
  const r = await search.resolve(text, { hints: { city: 'İstanbul' } });
  return r.status === 'resolved' ? r.best.precision : r.status;
};

describe('a number far outside what the street has', () => {
  it('still guesses a number just past the last door', async () => {
    expect(await precisionOf('bahariye caddesi 22')).toBe('interpolated');
    expect(await precisionOf('bahariye caddesi 34')).toBe('interpolated');
  });

  it('answers with the street when the number is far past the last door', async () => {
    expect(await precisionOf('bahariye caddesi 9999')).toBe('street');
    expect(await precisionOf('bahariye caddesi 999999')).toBe('street');
    expect(await precisionOf('bahariye caddesi 36')).toBe('street');
  });

  it('answers with the street for number zero', async () => {
    expect(await precisionOf('bahariye caddesi 0')).toBe('street');
  });

  it('keeps guessing between doors however far apart they are', async () => {
    expect(await precisionOf('bahariye caddesi 15')).toBe('interpolated');
  });
});
