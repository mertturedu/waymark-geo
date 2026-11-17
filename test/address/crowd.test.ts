import { createSearch, type Search } from '../../src/core/address/search';
import { crowdRows } from './helpers/crowd-fixture';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack(crowdRows()) });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const typed = async (text: string) => (await search.autocomplete(text)).map((p) => `${p.id}:${p.confidence}:${p.components.street ?? p.components.poiName ?? p.components.neighbourhood}`);
const resolved = async (text: string) => {
  const r = await search.resolve(text);
  return `${r.status} ${r.status === 'ambiguous' || r.status === 'resolved' ? r.candidates.map((p) => `${p.id}:${p.confidence}`).join(' ') : ''}`.trim();
};

describe('autocomplete with many streets with the same start', () => {
  const lale = [
    '34:s:10:2:1:Lale Bulvarı', '34:s:11:2:1:Lale Caddesi', '34:s:12:2:1:Lale Çıkmazı', '34:s:13:1:1:Lale Meydanı',
    '34:s:14:1:1:Lale Sokak', '34:s:15:1:1:Lale Yolu', '34:s:9:1:1:Karanfil Sokak', '34:s:19:1:0.8:Lalezar Sokak',
  ];

  it('keeps the eight best and puts the whole-name matches first', async () => {
    expect(await typed('lale')).toEqual(lale);
  });

  it('scores the shorter fragment lower and keeps the same order', async () => {
    const out = await typed('lal');
    expect(out.map((l) => l.split(':').slice(0, 4).join(':'))).toEqual(lale.map((l) => l.split(':').slice(0, 4).join(':')));
    expect(out.map((l) => l.split(':')[4])).toEqual(['0.862', '0.862', '0.862', '0.862', '0.862', '0.862', '0.862', '0.75']);
  });

  it('finds a street through its other name and scores it by the better name', async () => {
    expect(await typed('lale karanfil')).toEqual(['34:s:9:1:1:Karanfil Sokak']);
    expect(await typed('lale s')).toEqual(['34:s:18:2:0.791:Lale Sitesi']);
  });

  it('lowers the streets of other districts and keeps the district first', async () => {
    expect(await typed('kadikoy lale')).toEqual([
      '34:s:13:1:1:Lale Meydanı', '34:s:14:1:1:Lale Sokak', '34:s:15:1:1:Lale Yolu', '34:s:9:1:1:Karanfil Sokak',
      '34:s:19:1:0.8:Lalezar Sokak', '34:s:10:2:0.55:Lale Bulvarı', '34:s:11:2:0.55:Lale Caddesi', '34:s:12:2:0.55:Lale Çıkmazı',
    ]);
    expect(await typed('uskudar lale')).toEqual([
      '34:s:10:2:1:Lale Bulvarı', '34:s:11:2:1:Lale Caddesi', '34:s:12:2:1:Lale Çıkmazı', '34:s:13:1:0.55:Lale Meydanı',
      '34:s:14:1:0.55:Lale Sokak', '34:s:15:1:0.55:Lale Yolu', '34:s:9:1:0.55:Karanfil Sokak', '34:s:19:1:0.44:Lalezar Sokak',
    ]);
  });

  it('finds a street on the first word when only part of the name was typed', async () => {
    expect(await typed('deniz')).toEqual(['34:s:6:3:1:Deniz Sokak']);
  });
});

describe('autocomplete with many places with the same start', () => {
  const eight = ['10', '11', '13', '14', '15', '16', '4', '5'];

  it('keeps eight places and orders equal scores by id as text', async () => {
    expect(await typed('ada')).toEqual(eight.map((n) => `34:o:${n}:0.619:Ada Eczanesi`));
    expect(await typed('ada ecz')).toEqual(eight.map((n) => `34:o:${n}:0.724:Ada Eczanesi`));
  });

  it('gives nothing for a fragment that runs words together', async () => {
    expect(await typed('adaecz')).toEqual([]);
  });
});

describe('autocomplete of neighbourhoods with two words', () => {
  it('matches with and without the space', async () => {
    expect(await typed('yeni mo')).toEqual(['34:h:3:0.785:Yeni Moda']);
    expect(await typed('yenimo')).toEqual(['34:h:3:0.75:Yeni Moda']);
  });

  it('keeps to the district that was typed', async () => {
    expect(await typed('kadikoy yeni')).toEqual(['34:h:3:0.68:Yeni Moda']);
    expect(await typed('uskudar yeni')).toEqual([]);
  });
});

describe('places with the same name in several districts', () => {
  it('lists five of them in id order when nothing says where', async () => {
    expect(await resolved('ada eczanesi')).toBe('ambiguous 34:o:10:0.9 34:o:11:0.9 34:o:13:0.9 34:o:14:0.9 34:o:15:0.9');
    expect(await resolved('istanbul ada eczanesi')).toBe('ambiguous 34:o:10:0.9 34:o:11:0.9 34:o:13:0.9 34:o:14:0.9 34:o:15:0.9');
  });

  it('puts the places before the district named in the text, and the district no more than once', async () => {
    expect(await resolved('kadikoy ada eczanesi')).toBe('ambiguous 34:o:10:0.9 34:o:11:0.9 34:o:4:0.9 34:o:5:0.9 34:o:6:0.9');
    expect(await resolved('kadikoy kadikoy ada eczanesi')).toBe('ambiguous 34:o:10:0.9 34:o:11:0.9 34:o:4:0.9 34:o:5:0.9 34:o:6:0.9');
    expect(await resolved('uskudar ada eczanesi')).toBe('ambiguous 34:o:13:0.9 34:o:14:0.9 34:o:15:0.9 34:o:16:0.9 34:d:2:0.9');
  });

  it('says not found for a place whose kind is not known', async () => {
    expect(await resolved('ada kahvesi')).toBe('not_found');
  });
});

describe('near as a tie breaker', () => {
  const ids = async (text: string, near?: [number, number]) => {
    const r = await search.resolve(text, { limit: 8, ...(near ? { near } : {}) });
    return r.status === 'region_missing' ? [] : r.candidates;
  };

  it('puts the equally good candidate nearest to the point first', async () => {
    const plain = await ids('ada eczanesi');
    const last = plain[plain.length - 1]!;
    expect(plain[0]!.id).not.toBe(last.id);
    const near = await ids('ada eczanesi', last.coordinate);
    expect(near[0]!.id).toBe(last.id);
    expect(near.map((p) => p.id).sort()).toEqual(plain.map((p) => p.id).sort());
  });

  it('leaves the order alone when the point is not a point', async () => {
    const plain = (await ids('ada eczanesi')).map((p) => p.id);
    expect((await ids('ada eczanesi', [Number.NaN, 40.7])).map((p) => p.id)).toEqual(plain);
    expect((await ids('ada eczanesi', [28.8, Number.POSITIVE_INFINITY])).map((p) => p.id)).toEqual(plain);
  });

  it('does not let nearness beat a better score', async () => {
    const far = await search.resolve('lale sokak', { near: [28.76, 40.8] });
    const plain = await search.resolve('lale sokak');
    if (far.status === 'region_missing' || plain.status === 'region_missing') throw new Error('region');
    expect(far.candidates[0]!.confidence).toBeGreaterThanOrEqual(plain.candidates[0]!.confidence);
  });
});

describe('equally good doors in one neighbourhood', () => {
  it('asks which one when they are far apart', async () => {
    const r = await search.resolve('moda mahallesi kadikoy 7', { hints: { city: 'İstanbul' }, limit: 50 });
    if (r.status === 'region_missing') throw new Error('region');
    expect(r.candidates.map((p) => `${p.precision}:${p.confidence}`)).toEqual(['address:0.9', 'address:0.9', 'address:0.9']);
    expect(r.status).toBe('ambiguous');
  });

  it('settles on one when the equal doors are the same spot', async () => {
    const r = await search.resolve('moda mahallesi kadikoy 9', { hints: { city: 'İstanbul' } });
    expect(r.status).toBe('resolved');
  });
});

describe('a province name that is also a place name', () => {
  it('answers with the province, not the place', async () => {
    const r = await search.resolve('istanbul');
    expect(r).toMatchObject({ status: 'resolved', best: { precision: 'province', components: { province: 'İstanbul' } } });
  });

  it('still finds the place when more than the province is typed', async () => {
    const r = await search.resolve('istanbul kadikoy istanbul avm');
    expect(r.status === 'region_missing' ? [] : r.candidates.map((p) => p.precision)).not.toContain('province');
  });
});

describe('a neighbourhood typed without its marker word', () => {
  const found = async (text: string) => {
    const r = await search.resolve(text, { hints: { city: 'İstanbul' } });
    return r.status === 'region_missing' ? null : r.candidates[0];
  };

  it('is told apart from the street name in front of it', async () => {
    expect(await found('Yeni Moda Deniz Sokak Kadıköy 1')).toMatchObject({ precision: 'address', components: { street: 'Deniz Sokak', neighbourhood: 'Yeni Moda', houseNumber: '1' } });
    expect(await found('Yeni Moda Deniz Sokak Kadıköy')).toMatchObject({ precision: 'street', components: { street: 'Deniz Sokak', neighbourhood: 'Yeni Moda' } });
  });

  it('does the same as with the marker word', async () => {
    expect(await found('Yeni Moda Mah Deniz Sokak Kadıköy 1')).toMatchObject({ components: { street: 'Deniz Sokak', houseNumber: '1' } });
  });

  it('does not make up a neighbourhood for a street that does not exist', async () => {
    const r = await found('Yeni Moda Olmayan Sokak Kadıköy 1');
    expect(r?.precision === 'address' && r.components.street === 'Deniz Sokak').toBe(false);
  });
});

describe('a kind of place in an area', () => {
  it('lists the places of that kind in the district that was typed', async () => {
    const r = await search.resolve('eczane kadikoy', { limit: 20 });
    if (r.status === 'region_missing') throw new Error('region');
    const places = r.candidates.filter((p) => p.precision === 'poi');
    expect(places.length).toBeGreaterThanOrEqual(4);
    expect(places.every((p) => p.components.district === 'Kadıköy' && /Eczanesi$/.test(p.components.poiName ?? ''))).toBe(true);
  });

  it('uses the area around the user when no district is typed', async () => {
    const r = await search.resolve('eczane', { near: [28.8, 40.7], limit: 20 });
    if (r.status === 'region_missing') throw new Error('region');
    expect(r.candidates.filter((p) => p.precision === 'poi').length).toBeGreaterThan(0);
  });

  it('asks for nothing it cannot place: a kind alone, or a kind with other words, is left to the name search', async () => {
    const alone = await search.resolve('eczane');
    expect(alone.status === 'region_missing' || alone.status === 'not_found' || alone.candidates.every((p) => p.precision !== 'poi' || p.components.poiName !== undefined)).toBe(true);
    const named = await search.resolve('selçuk eczane kadikoy');
    if (named.status === 'region_missing') throw new Error('region');
    expect(named.candidates.every((p) => p.components.poiName !== 'Ada Eczanesi' || p.confidence < 0.9)).toBe(true);
  });
});

describe('validate suggestions', () => {
  it('suggests the neighbourhood and the district that were mistyped by a letter', async () => {
    const hood = await search.validate('yeni modda mahallesi kadikoy');
    expect(hood.suggestions.neighbourhood).toBe('Yeni Moda');
    const district = await search.validate('yeni moda mahallesi kadikoyy');
    expect(district.suggestions.district).toBe('Kadıköy');
    const right = await search.validate('yeni moda mahallesi kadikoy');
    expect(right.suggestions).toEqual({});
  });

  it('answers not found with nothing to compare, and region_missing with a note', async () => {
    expect((await search.validate('zzzzzzzz')).status).toBe('not_found');
    expect((await search.validate('izmir bornova gul sokak 3')).notes.map((n) => n.code)).toEqual(['outside_installed_regions']);
  });
});

describe('typing a neighbourhood and then a street', () => {
  it('lists the streets of a neighbourhood that was typed in full, the busiest first', async () => {
    const list = await search.autocomplete('moda mahallesi', { limit: 5 });
    expect(list[0]?.precision).toBe('neighbourhood');
    expect(list.slice(1).every((p) => p.precision === 'street' && p.components.neighbourhood === 'Moda')).toBe(true);
    expect(list[1]?.components.street).toBe('Bahariye Caddesi');
    expect(list[1]?.completion).toBe('Bahariye Caddesi ');
  });

  it('reads the street fragment after the neighbourhood and prefers streets of that neighbourhood', async () => {
    const list = await search.autocomplete('moda mah. lal', { limit: 8 });
    expect(list.length).toBeGreaterThan(0);
    expect(list.slice(0, 3).every((p) => p.components.neighbourhood === 'Moda')).toBe(true);
  });

  it('ranks places near the user first and keeps the same set', async () => {
    const away = await search.autocomplete('lale', { limit: 8, near: [29.2, 40.8] });
    const home = await search.autocomplete('lale', { limit: 8, near: [28.62, 40.7] });
    expect(away[0]?.components.street).toBe('Karanfil Sokak');
    expect(home[0]?.components.street).not.toBe('Karanfil Sokak');
    expect(new Set(away.map((p) => p.id))).toEqual(new Set(home.map((p) => p.id)));
    expect(await search.autocomplete('lale', { limit: 3, near: [Number.NaN, 1] as never })).toHaveLength(3);
  });
});
