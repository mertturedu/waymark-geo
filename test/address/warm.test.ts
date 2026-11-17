import { createSearch } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

describe('Search.warm', () => {
  it('opens an installed region ahead of the first query and says no for one that is not installed', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    expect(await search.warm('34')).toBe(true);
    expect(await search.warm('06')).toBe(false);
    expect(await search.warm('34')).toBe(true);
    await close();
  });
});
