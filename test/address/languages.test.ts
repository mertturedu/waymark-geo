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

const best = async (text: string) => {
  const result = await search.resolve(text);
  return result.status === 'resolved' ? result.best : null;
};

describe('addresses written in other languages', () => {
  it('reads English words for street, district and number', async () => {
    expect(await best('36 Ataturk Street, Kadikoy, Istanbul')).toMatchObject({ precision: 'address', components: { street: 'Atatürk Caddesi', houseNumber: '36' } });
    expect(await best('Bahariye Avenue No. 14 Moda Neighbourhood Kadikoy')).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
  });

  it('reads German words', async () => {
    expect(await best('Kadıköy, Moda Ortsteil, Bahariye Straße Nummer 14')).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
    expect(await best('KADIKOY/ISTANBUL MODA ORTSTEIL BAHARIYE STRASSE NR. 14')).toMatchObject({ components: { houseNumber: '14' } });
  });

  it('reads Russian and Greek words', async () => {
    expect(await best('улица Республики 36')).toMatchObject({ components: { street: 'Atatürk Caddesi', houseNumber: '36' } });
    expect(await best('Οδός Bahariye αρ. 14, Καντικοϊ')).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
  });

  it('reads Arabic words around a Latin street name', async () => {
    expect(await best('شارع Bahariye رقم 14، Kadıköy')).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
  });

  it('mixes languages in one sentence', async () => {
    expect(await best('Kadıköy Moda mahallesi Bahariye улица 14')).toMatchObject({ components: { street: 'Bahariye Caddesi', houseNumber: '14' } });
  });

  it('does not invent a real door for a fully Arabic text it cannot read', async () => {
    const result = await search.resolve('شارع الاستقلال رقم 5 اسطنبول');
    const found = result.status === 'region_missing' ? [] : result.candidates;
    for (const place of found) expect(place.precision === 'address' && !place.approximate && place.components.houseNumber === '5').toBe(false);
    expect(result.status === 'resolved' ? result.best.confidence : 0).toBeLessThan(0.9);
  });
});
