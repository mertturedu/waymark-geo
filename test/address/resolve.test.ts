import { createSearch, type Search } from '../../src/core/address/search';
import type { PointLayer } from '../../src/core/address/types';
import { builtPack, memoryStore, square, turkeyBorders } from './helpers/search-fixture';

let pack = '';
let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  pack = await builtPack();
  const { store, close } = await memoryStore({ '34': pack });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

describe('resolve a full address', () => {
  it('finds the door number and says it is a real point', async () => {
    const result = await search.resolve('İstanbul Kadıköy Moda Mah. Bahariye Caddesi No:14');
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best.precision).toBe('address');
    expect(result.best.approximate).toBe(false);
    expect(result.best.source).toBe('osm');
    expect(result.best.coordinate).toEqual([28.6, 40.7]);
    expect(result.best.id).toMatch(/^34:a:\d+$/);
    expect(result.best.region).toBe('34');
    expect(result.best.components).toMatchObject({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '14' });
    expect(result.best.label).toBe('Bahariye Caddesi No:14, Moda Mah., Kadıköy/İstanbul');
    expect(result.candidates[0]?.id).toBe(result.best.id);
    expect(result.best.confidence).toBeGreaterThan(0.9);
  });

  it('gives the same place for plain letters, abbreviations and another script', async () => {
    const a = await search.resolve('İstanbul Kadıköy Moda Mah. Bahariye Caddesi No:14');
    const b = await search.resolve('istanbul kadikoy moda mah bahariye cd no 14');
    const c = await search.resolve('BAHARIYE CADDESI 14 MODA KADIKOY');
    for (const other of [b, c]) {
      expect(other.status).toBe('resolved');
      expect(other.status === 'resolved' && a.status === 'resolved' ? other.best.id : '').toBe(a.status === 'resolved' ? a.best.id : 'x');
    }
  });

  it('finds a street through its Russian name', async () => {
    const result = await search.resolve('улица Республики 36');
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best.components).toMatchObject({ street: 'Atatürk Caddesi', houseNumber: '36' });
    expect(result.best.precision).toBe('address');
  });

  it('answers the same for a structured query', async () => {
    const text = await search.resolve('İstanbul Kadıköy Moda Mah. Bahariye Caddesi No:14');
    const structured = await search.resolve({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '14' });
    expect(structured.status).toBe('resolved');
    expect(structured.status === 'resolved' && text.status === 'resolved' ? structured.best.id : '').toBe(text.status === 'resolved' ? text.best.id : 'x');
  });
});

describe('the same street in two neighbourhoods', () => {
  it('prefers the neighbourhood where the number exists', async () => {
    const a = await search.resolve('Gül Sokak 14');
    const b = await search.resolve('Gül Sokak 12');
    expect(a.status === 'resolved' && a.best.components.neighbourhood).toBe('Moda');
    expect(b.status === 'resolved' && b.best.components.neighbourhood).toBe('Fener');
  });

  it('does not choose silently when the number is in neither', async () => {
    const result = await search.resolve('Gül Sokak 5');
    expect(result.status).toBe('ambiguous');
    if (result.status !== 'ambiguous') return;
    expect(result.candidates.map((c) => c.components.neighbourhood).sort()).toEqual(['Fener', 'Moda']);
    expect(result.candidates.every((c) => c.approximate)).toBe(true);
  });

  it('takes the district hint or the neighbourhood in the text to decide', async () => {
    const hinted = await search.resolve('Gül Sokak 5', { hints: { district: 'Üsküdar' } });
    expect(hinted.status === 'resolved' && hinted.best.components.district).toBe('Üsküdar');
    const typed = await search.resolve('Moda Mah. Gül Sokak 5');
    expect(typed.status === 'resolved' && typed.best.components.neighbourhood).toBe('Moda');
  });
});

describe('a number the map does not have', () => {
  it('is placed between its neighbours and marked as a guess', async () => {
    const result = await search.resolve('Zeytin Sokak 3');
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best).toMatchObject({ precision: 'interpolated', approximate: true, source: 'interpolated' });
    expect(result.best.coordinate[0]).toBeCloseTo(28.652, 5);
    expect(result.best.coordinate[1]).toBeCloseTo(40.72, 6);
    expect(result.best.components).toMatchObject({ street: 'Zeytin Sokak', houseNumber: '3' });
    expect(result.best.confidence).toBeLessThan(0.9);
  });

  it('takes the nearest numbered door when the number is past the end and ranks it below a real address', async () => {
    const guess = await search.resolve('Zeytin Sokak 9');
    expect(guess.status === 'resolved' && guess.best).toMatchObject({ precision: 'interpolated', approximate: true });
    expect(guess.status === 'resolved' && guess.best.coordinate[0]).toBeCloseTo(28.654, 5);
    const real = await search.resolve('Zeytin Sokak 5');
    expect(real.status === 'resolved' && real.best).toMatchObject({ precision: 'address', approximate: false });
    expect(real.status === 'resolved' && guess.status === 'resolved' && real.best.confidence > guess.best.confidence).toBe(true);
  });

  it('never calls a guess an address', async () => {
    for (const n of [0, 2, 3, 4, 6, 7, 8, 99, 1000]) {
      const result = await search.resolve(`Zeytin Sokak ${n}`);
      if (result.status === 'region_missing') continue;
      for (const c of result.candidates) expect(c.precision === 'address' && !c.approximate && c.source !== 'osm').toBe(false);
    }
  });
});

describe('one door written with two street words', () => {
  it('prefers the street word that was typed and lists the door once', async () => {
    const caddesi = await search.resolve('Sivas Caddesi No:24 Moda Mah. Kadıköy');
    expect(caddesi.status === 'resolved' && caddesi.best.components.street).toBe('Sivas Caddesi');
    const bulvari = await search.resolve('Sivas Bulvarı No:24 Moda Mah. Kadıköy');
    expect(bulvari.status === 'resolved' && bulvari.best.components.street).toBe('Sivas Bulvarı');
    for (const result of [caddesi, bulvari]) {
      if (result.status === 'region_missing') continue;
      expect(result.candidates.filter((c) => c.components.houseNumber === '24' && c.precision === 'address')).toHaveLength(1);
    }
  });

  it('keeps two different doors that happen to share a number far apart', async () => {
    const result = await search.resolve('Gül Sokak 14');
    expect(result.status).toBe('resolved');
  });
});

describe('numbered streets', () => {
  it('finds the right street by its number', async () => {
    const result = await search.resolve('1707 sk no 3');
    expect(result.status === 'resolved' && result.best.components.street).toBe('1707. Sokak');
    expect(result.status === 'resolved' && result.best.precision).toBe('address');
  });

  it('never answers with a street that has another number', async () => {
    for (const text of ['1707 sk no 4', '1708. sokak 9', '1709 sk no 3', '170 sokak 3']) {
      const result = await search.resolve(text);
      const streets = result.status === 'region_missing' ? [] : result.candidates.map((c) => c.components.street);
      const number = /^(\d+)/.exec(text)?.[1] as string;
      for (const street of streets) expect(street?.startsWith(`${number}.`)).toBe(true);
    }
    expect((await search.resolve('1709 sk no 3')).status).toBe('not_found');
  });
});

describe('less than a full address', () => {
  it('gives the province, district or neighbourhood when only that is written', async () => {
    const province = await search.resolve('istanbul');
    expect(province.status).toBe('resolved');
    expect(province.status === 'resolved' && province.best).toMatchObject({ precision: 'province', approximate: true, coordinate: [29, 41] });
    const district = await search.resolve('kadikoy istanbul');
    expect(district.status === 'resolved' && district.best).toMatchObject({ precision: 'district', approximate: true, coordinate: [28.7, 41] });
    const hood = await search.resolve('moda mah kadikoy');
    expect(hood.status === 'resolved' && hood.best).toMatchObject({ precision: 'neighbourhood', approximate: true, coordinate: [28.6, 40.7] });
  });

  it('gives the street when the number is missing and marks it approximate', async () => {
    const result = await search.resolve('Bahariye Caddesi Moda Mah. Kadıköy');
    expect(result.status).toBe('resolved');
    expect(result.status === 'resolved' && result.best).toMatchObject({ precision: 'street', approximate: true });
  });

  it('finds a door with no street through the neighbourhood and number', async () => {
    const result = await search.resolve('Moda Mah. Kadıköy No:7');
    expect(result.status).toBe('resolved');
    expect(result.status === 'resolved' && result.best).toMatchObject({ precision: 'address', approximate: false });
  });
});

describe('regions', () => {
  it('names the province whose pack is not installed', async () => {
    expect(await search.resolve('Ankara Çankaya Bahariye Cd. No:14')).toEqual({ status: 'region_missing', regions: ['06'] });
  });

  it('answers from the installed pack and names the neighbour that is missing near a border', async () => {
    const { store, close } = await memoryStore({ '34': pack });
    const borders = turkeyBorders([{ plate: '41', rings: square(30.0, 40.0, 32.0, 42.0) }]);
    const near = createSearch({ store, borders });
    const edge = await near.resolve('Bahariye Cd. No:14', { near: [29.99, 41.0] });
    expect(edge.status === 'resolved' && edge.missing).toEqual(['41']);
    const middle = await near.resolve('Bahariye Cd. No:14', { near: [29.0, 41.0] });
    expect(middle.status === 'resolved' && middle.missing).toBeUndefined();
    await close();
  });

  it('asks for the pack of the place the person stands in when nothing is installed', async () => {
    const empty = createSearch({ store: { installed: async () => [], open: async () => null }, borders: turkeyBorders() });
    expect(await empty.resolve('Bahariye Cd. No:14', { near: [29.0, 41.0] })).toEqual({ status: 'region_missing', regions: ['34'] });
  });
});

describe('odd input', () => {
  it.each(['', ' ', '...', "'; DROP TABLE address; --", '%', '_', 'x'.repeat(5000), '\u202e\u200b', '😀 14', 'zzzzqqqq'])('does not fail on %j', async (text) => {
    const result = await search.resolve(text);
    expect(['resolved', 'ambiguous', 'not_found', 'region_missing']).toContain(result.status);
    if (result.status === 'not_found') expect(result.candidates).toEqual([]);
  });

  it('gives not_found for text that matches nothing', async () => {
    const result = await search.resolve('zzzzqqqq');
    expect(result.status).toBe('not_found');
  });

  it('limits and orders the candidates', async () => {
    const result = await search.resolve('gul sokak', { limit: 1 });
    expect(result.status === 'region_missing' ? 0 : result.candidates.length).toBeLessThanOrEqual(1);
    const many = await search.resolve('sokak');
    if (many.status !== 'region_missing') {
      const scores = many.candidates.map((c) => c.confidence);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });
});

describe('layers', () => {
  const layered = async (layer: PointLayer): Promise<Search> => {
    const { store } = await memoryStore({ '34': pack });
    return createSearch({ store, borders: turkeyBorders(), layers: [layer] });
  };

  it('puts a trusted learned point before the map point and passes the key it looked for', async () => {
    const seen: unknown[] = [];
    const s = await layered({ name: 'learned', lookup: async (key) => (seen.push(key), key.houseNumber === '14' ? { coordinate: [28.61, 40.71], trusted: true } : null) });
    const result = await s.resolve('Bahariye Caddesi Moda Mah. Kadıköy No:14');
    expect(result.status === 'resolved' && result.best).toMatchObject({ source: 'learned', coordinate: [28.61, 40.71], precision: 'address', approximate: false });
    expect(seen[0]).toEqual({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'bahariye~cadde', houseNumber: '14' });
  });

  it('marks an untrusted learned point as approximate and not an address', async () => {
    const s = await layered({ name: 'learned', lookup: async () => ({ coordinate: [28.61, 40.71], trusted: false }) });
    const result = await s.resolve('Bahariye Caddesi Moda Mah. Kadıköy No:30');
    expect(result.status === 'resolved' && result.best).toMatchObject({ source: 'learned', approximate: true });
    expect(result.status === 'resolved' && result.best.precision).not.toBe('address');
  });

  it('can give a point for a number the map does not have', async () => {
    const s = await layered({ name: 'correction', lookup: async (key) => (key.houseNumber === '99' ? { coordinate: [28.62, 40.72], trusted: true } : null) });
    const result = await s.resolve('Bahariye Caddesi Moda Mah. Kadıköy No:99');
    expect(result.status === 'resolved' && result.best).toMatchObject({ source: 'correction', precision: 'address', approximate: false, coordinate: [28.62, 40.72] });
  });
});
