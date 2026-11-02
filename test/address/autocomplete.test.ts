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

describe('autocomplete street names', () => {
  it('finishes a half typed street name', async () => {
    const out = await search.autocomplete('bahar');
    expect(out[0]).toMatchObject({ precision: 'street', approximate: true, components: { street: 'Bahariye Caddesi', district: 'Kadıköy', neighbourhood: 'Moda' } });
    expect(out[0]?.id).toMatch(/^34:s:\d+:\d+$/);
  });

  it('finishes a street name after the district is typed', async () => {
    const out = await search.autocomplete('kadikoy bahar');
    expect(out[0]?.components.street).toBe('Bahariye Caddesi');
  });

  it('ignores a street word that is already complete', async () => {
    const out = await search.autocomplete('bahariye cd');
    expect(out[0]?.components.street).toBe('Bahariye Caddesi');
  });

  it('puts streets in other districts last when the district is hinted', async () => {
    const kadikoy = await search.autocomplete('gul', { hints: { district: 'Kadıköy' } });
    const uskudar = await search.autocomplete('gul', { hints: { district: 'Üsküdar' } });
    const streets = (list: typeof kadikoy) => list.filter((p) => p.precision === 'street').map((p) => p.components.district);
    expect(streets(kadikoy)).toEqual(['Kadıköy', 'Üsküdar']);
    expect(streets(uskudar)).toEqual(['Üsküdar', 'Kadıköy']);
  });
});

describe('autocomplete areas and places', () => {
  it('finishes a neighbourhood after the district', async () => {
    const out = await search.autocomplete('kadikoy mod');
    expect(out[0]).toMatchObject({ precision: 'neighbourhood', approximate: true, components: { neighbourhood: 'Moda', district: 'Kadıköy' } });
  });

  it('finishes a district name', async () => {
    const out = await search.autocomplete('kadik');
    expect(out[0]).toMatchObject({ precision: 'district', components: { district: 'Kadıköy' } });
  });

  it('finishes a place name', async () => {
    const out = await search.autocomplete('devlet');
    expect(out.find((p) => p.precision === 'poi')).toMatchObject({ approximate: false, components: { poiName: 'Devlet Hastanesi', district: 'Kadıköy' } });
  });
});

describe('autocomplete with a house number', () => {
  it('gives a real door when the number exists', async () => {
    const out = await search.autocomplete('bahar 14');
    expect(out[0]).toMatchObject({ precision: 'address', approximate: false, components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
    expect(out[0]?.coordinate).toEqual([28.6, 40.7]);
  });

  it('marks a guessed number as approximate', async () => {
    const out = await search.autocomplete('zeytin 3');
    expect(out[0]).toMatchObject({ precision: 'interpolated', approximate: true, components: { street: 'Zeytin Sokak', houseNumber: '3' } });
  });
});

describe('autocomplete limits', () => {
  it.each(['', ' ', '   ', 'a', ' b ', '\n'])('returns nothing for %j', async (text) => {
    expect(await search.autocomplete(text)).toEqual([]);
  });

  it('copes with very long text', async () => {
    const out = await search.autocomplete(`${'bahariye '.repeat(100)}cd`);
    expect(Array.isArray(out)).toBe(true);
    expect(await search.autocomplete('a'.repeat(5000))).toEqual([]);
  });

  it('never returns more than the limit', async () => {
    expect((await search.autocomplete('gul', { limit: 1 })).length).toBe(1);
    expect((await search.autocomplete('a', { limit: 0 }))).toEqual([]);
    expect((await search.autocomplete('ata')).length).toBeLessThanOrEqual(8);
  });

  it('answers the same twice and lists each place once', async () => {
    const a = await search.autocomplete('ata');
    const b = await search.autocomplete('ata');
    expect(b).toEqual(a);
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
  });

  it('only calls a point approximate when it is not a real door or place', async () => {
    for (const text of ['bahar', 'bahar 14', 'zeytin 3', 'kadik', 'devlet', 'kadikoy mod', 'gul']) {
      for (const p of await search.autocomplete(text)) expect(p.approximate).toBe(p.precision !== 'address' && p.precision !== 'poi');
    }
  });
});
