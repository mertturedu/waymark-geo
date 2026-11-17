import { createSearch, type Search } from '../../src/core/address/search';
import { poi } from '../pipeline/helpers/mini-work';
import { builtPack, memoryStore, searchRows, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const best = async (text: string, options = {}) => {
  const result = await search.resolve(text, options);
  return result.status === 'resolved' ? result.best : null;
};

describe('named places', () => {
  it('finds the town hall from a different way of saying it', async () => {
    expect(await best('kadikoy belediye binasi')).toMatchObject({ precision: 'poi', approximate: false, source: 'osm', components: { poiName: 'Kadıköy Belediyesi', district: 'Kadıköy' } });
    expect(await best('belediye binasi kadikoy')).toMatchObject({ components: { poiName: 'Kadıköy Belediyesi' } });
  });

  it('finds the hospital by half of its name', async () => {
    expect(await best('devlet hastane')).toMatchObject({ precision: 'poi', components: { poiName: 'Devlet Hastanesi' } });
  });

  it('finds a place from Russian, German and English words', async () => {
    for (const text of ['Государственная больница', 'devlet krankenhaus', 'devlet hospital']) {
      expect(await best(text)).toMatchObject({ components: { poiName: 'Devlet Hastanesi' } });
    }
  });

  it('finds the mall under either name for it', async () => {
    expect(await best('akasya avm')).toMatchObject({ components: { poiName: 'Akasya AVM' } });
    expect(await best('akasya alisveris merkezi')).toMatchObject({ components: { poiName: 'Akasya AVM' } });
  });

  it('asks which one when two districts have a place with the same name', async () => {
    const result = await search.resolve('merkez eczane');
    expect(result.status).toBe('ambiguous');
    expect(result.status === 'ambiguous' && result.candidates.map((c) => c.components.district).sort()).toEqual(['Kadıköy', 'Üsküdar']);
  });

  it('uses the district hint to tell them apart', async () => {
    expect(await best('merkez eczane', { hints: { district: 'Üsküdar' } })).toMatchObject({ components: { district: 'Üsküdar', poiName: 'Merkez Eczanesi' } });
    expect(await best('merkez eczane', { hints: { district: 'Kadıköy' } })).toMatchObject({ components: { district: 'Kadıköy' } });
  });

  it('prefers a street with the same words', async () => {
    expect(await best('hastane caddesi 1')).toMatchObject({ precision: 'address', components: { street: 'Hastane Caddesi', houseNumber: '1' } });
    expect(await best('hastane caddesi')).toMatchObject({ precision: 'street', components: { street: 'Hastane Caddesi' } });
  });

  it('finds a building name written together with its neighbourhood', async () => {
    const rows = searchRows();
    rows.places.push(poi('n47', 'mall', 'Yıldız Sitesi', 28.67, 40.77));
    const { store, close } = await memoryStore({ '34': await builtPack(rows) });
    const named = createSearch({ store, borders: turkeyBorders() });
    const best = async (text: string) => {
      const result = await named.resolve(text);
      return result.status === 'resolved' ? result.best : null;
    };
    for (const text of ['Yıldız Sitesi Kadıköy', 'Moda Mahallesi Yıldız Sitesi Kadıköy', 'Yıldız Sitesi Moda Mah. Kadıköy']) {
      expect(await best(text)).toMatchObject({ precision: 'poi', components: { poiName: 'Yıldız Sitesi', district: 'Kadıköy' } });
    }
    await close();
  });

  it('says nothing was found for a place that does not exist', async () => {
    const result = await search.resolve('zzqx hastanesi');
    expect(result.status).toBe('not_found');
  });
});
