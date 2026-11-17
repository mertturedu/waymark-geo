import { createSearch } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

import type { ResolveResult } from '../../src/core/address/types';

const hint = { hints: { city: 'İstanbul' } };
const suggestionOf = (result: ResolveResult) => ('suggestion' in result ? result.suggestion : undefined);

async function search() {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  return { search: createSearch({ store, borders: turkeyBorders() }), close };
}

describe('did you mean', () => {
  it('offers the real spelling when the street was typed with a typo', async () => {
    const { search: s, close } = await search();
    const result = await s.resolve('Bahriye Caddesi 14', hint);
    expect(suggestionOf(result)).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
    await close();
  });

  it('offers nothing when only the spelling of the street type differs', async () => {
    const { search: s, close } = await search();
    for (const text of ['Bahariye Cd. 14', 'bahariye caddesi 14', 'BAHARİYE CADDESİ 14']) {
      const result = await s.resolve(text, hint);
      expect(result.status).toBe('resolved');
      expect(suggestionOf(result)).toBeUndefined();
    }
    await close();
  });

  it('offers nothing when the query has no street', async () => {
    const { search: s, close } = await search();
    const result = await s.resolve('Devlet Hastanesi', hint);
    expect(suggestionOf(result)).toBeUndefined();
    await close();
  });

  it('offers nothing when nothing was found', async () => {
    const { search: s, close } = await search();
    const result = await s.resolve('Zzzzqqq Sokak 3', hint);
    expect(result.status).toBe('not_found');
    expect('suggestion' in result).toBe(false);
    await close();
  });
});
