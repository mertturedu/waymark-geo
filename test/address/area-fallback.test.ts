import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let search: Search;
let closeStore: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const first = async (text: string) => {
  const result = await search.resolve(text);
  return { status: result.status, best: result.status === 'resolved' ? result.best : 'candidates' in result ? result.candidates[0] : undefined, result };
};

describe('a street the asked area does not have', () => {
  it('answers with the district, not with the same street name in another district', async () => {
    const { status, best } = await first('Atatürk Sokağı 3 Üsküdar İstanbul');
    expect(status).toBe('resolved');
    expect(best).toMatchObject({ precision: 'district', approximate: true, source: 'derived', components: { district: 'Üsküdar' } });
    expect(best?.components.street).toBeUndefined();
  });

  it('answers with the neighbourhood when the street is not in the asked neighbourhood', async () => {
    const { status, best } = await first('Kadıköy Moda Mah. Olmayan Sokak No:5');
    expect(status).toBe('resolved');
    expect(best).toMatchObject({ precision: 'neighbourhood', approximate: true, components: { district: 'Kadıköy', neighbourhood: 'Moda' } });
  });

  it('answers with the neighbourhood when the street is nowhere in the pack', async () => {
    const { best } = await first('Fener Mah. Üsküdar Hiç Yok Caddesi 7');
    expect(best).toMatchObject({ precision: 'neighbourhood', approximate: true, components: { district: 'Üsküdar', neighbourhood: 'Fener' } });
  });

  it('lowers the confidence below the plain area answer because the street was not found', async () => {
    const plain = await first('Kadıköy Moda Mah.');
    const lost = await first('Kadıköy Moda Mah. Olmayan Sokak No:5');
    expect(lost.best?.confidence).toBeLessThan(plain.best?.confidence ?? 0);
    expect(lost.best?.confidence).toBeGreaterThan(0.5);
  });

  it('keeps the other district street as a lower candidate', async () => {
    const result = await search.resolve('Atatürk Sokağı 3 Üsküdar İstanbul');
    const ids = result.status === 'region_missing' ? [] : result.candidates.map((c) => c.components.district);
    expect(ids[0]).toBe('Üsküdar');
    expect(ids).toContain('Kadıköy');
  });

  it('never calls the area answer an exact address', async () => {
    for (const text of ['Atatürk Sokağı 3 Üsküdar İstanbul', 'Kadıköy Moda Mah. Olmayan Sokak No:5', 'Fener Mah. Üsküdar Hiç Yok Caddesi 7']) {
      const { best } = await first(text);
      expect(best?.precision).not.toBe('address');
      expect(best?.approximate).toBe(true);
    }
  });
});

describe('unchanged behaviour', () => {
  it('still finds a street that is in the asked district', async () => {
    const { best } = await first('Gül Sokak 12 Üsküdar İstanbul');
    expect(best).toMatchObject({ precision: 'address', components: { district: 'Üsküdar', street: 'Gül Sokak', houseNumber: '12' } });
  });

  it('still finds nothing for an unknown street when no area was asked', async () => {
    expect((await first('Hiç Yok Caddesi 7')).status).toBe('not_found');
  });

  it('still answers with the street in the right district when only the street is asked', async () => {
    const { best } = await first('Bahariye Caddesi 14');
    expect(best).toMatchObject({ precision: 'address', components: { street: 'Bahariye Caddesi' } });
  });
});
