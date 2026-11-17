import { editDistance } from '../../src/core/address/names';
import { asciiFold, buildQueries, noisyStreet, osmName, typoOf, type GoldenQuery, type PoiSource, type RowSource } from '../../scripts/build-address-golden';

const rng = (seed: number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const street = (i: number): string => ['Bahariye Caddesi', 'Gül Sokağı', 'Atatürk Bulvarı', 'Çınar Sokak', 'Kuyubaşı Caddesi', 'Zeytinburnu Yolu', 'Papatya Sokağı', 'Mimar Sinan Caddesi'][i % 8] as string;

const rows = (count: number, numbered = 0): RowSource[] =>
  Array.from({ length: count }, (_, i) => ({
    osm: `n${1000 + i}`,
    number: String(1 + (i % 40)),
    province: '34',
    provinceName: 'İstanbul',
    district: ['Kadıköy', 'Üsküdar', 'Şişli'][i % 3] as string,
    hood: ['Moda', 'Fener', 'Çağlayan', 'Acıbadem'][i % 4] as string,
    street: i < numbered ? `${1700 + i}. Sokak` : street(i),
    streetNumber: i < numbered ? 1700 + i : null,
    lng: 29 + i / 10000,
    lat: 41,
    conflict: false,
    districtNames: {},
    hoodNames: {},
  }));

const pois = (count: number): PoiSource[] =>
  Array.from({ length: count }, (_, i) => ({ osm: `n${5000 + i}`, name: ['Devlet Hastanesi', 'Kadıköy Belediyesi', 'Atatürk İlkokulu', 'Capitol AVM'][i % 4] as string, kind: ['hospital', 'townhall', 'school', 'mall'][i % 4] as string, district: 'Kadıköy', province: 'İstanbul', lng: 29, lat: 41 }));

const byCategory = (list: GoldenQuery[], category: string): GoldenQuery[] => list.filter((q) => q.category === category);

describe('asciiFold', () => {
  it('writes Turkish letters as plain ones', () => {
    expect(asciiFold('Çağlayan Şişli Öztürk Ünal İnönü Iğdır')).toBe('Caglayan Sisli Ozturk Unal Inonu Igdir');
  });
});

describe('osmName', () => {
  it('turns the stored code into an OSM name', () => {
    expect(osmName(5 * 4)).toBe('n5');
    expect(osmName(7 * 4 + 1)).toBe('w7');
    expect(osmName(9 * 4 + 2)).toBe('r9');
  });
});

describe('noisyStreet', () => {
  it.each(['Bayındır Sokak 2', 'Yeni Yalavo Yolu 7. Km.', 'Öğretmen Caddesi/ Ülgen Sk', 'Atatürk Caddesi Ankara Devlet Karayolu', '405.Cadde (Demet 4)', 'Hürriyet Caddesi D-100 Karayolu 3', 'Gazi Mahallesi', 'Göksu Mah', 'Çanakkale Şehitleri Caddesi Yanyolu', 'Atatürk Bulvarı Servis Yolu'])('calls %j noisy', (name) => {
    expect(noisyStreet(name)).toBe(true);
  });

  it.each(['Sivas Caddesi', 'Mimar Sinan Caddesi', '30 Ağustos Zafer Caddesi', '1707. Sokak', 'Gül Sokak', 'Zübeyde Hanım Caddesi'])('keeps %j', (name) => {
    expect(noisyStreet(name)).toBe(false);
  });
});

describe('typoOf', () => {
  it('changes a long word by exactly one edit and keeps the first letter', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const word = ['Bahariye', 'Kuyubaşı', 'Zeytinburnu', 'Papatya'][seed % 4] as string;
      const changed = typoOf(word, rng(seed));
      expect(changed).not.toBe(word);
      expect(editDistance(asciiFold(word).toLowerCase(), asciiFold(changed).toLowerCase(), 3)).toBeLessThanOrEqual(1);
      expect(changed[0]).toBe(word[0]);
    }
  });
});

describe('buildQueries', () => {
  const all = buildQueries(rows(400, 30), pois(60), '34', 2026);

  it('makes at least three hundred queries covering every category', () => {
    expect(all.length).toBeGreaterThanOrEqual(300);
    for (const category of ['full', 'folded', 'typo', 'numbered', 'hide', 'poi', 'lang', 'hard']) expect(byCategory(all, category).length).toBeGreaterThan(0);
    expect(byCategory(all, 'hard').length).toBeGreaterThanOrEqual(10);
  });

  it('is the same every time and different for another seed', () => {
    expect(buildQueries(rows(400, 30), pois(60), '34', 2026)).toEqual(all);
    expect(buildQueries(rows(400, 30), pois(60), '34', 2027)).not.toEqual(all);
  });

  it('gives each query a unique id, a plate and something to expect', () => {
    expect(new Set(all.map((q) => q.id)).size).toBe(all.length);
    for (const q of all) {
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(q.expect.plate).toBe('34');
      expect(q.expect.osm).toMatch(/^[nwr]\d+$/);
    }
    for (const q of byCategory(all, 'full')) expect(q.expect.number).toBeDefined();
  });

  it('covers every language with enough queries in each', () => {
    const lang = byCategory(all, 'lang');
    for (const l of ['en', 'de', 'ru', 'el', 'ar']) expect(lang.filter((q) => q.lang === l).length).toBeGreaterThanOrEqual(6);
    expect(lang.filter((q) => q.lang === 'ru').every((q) => /[А-Яа-я]/.test(q.text))).toBe(true);
    expect(lang.filter((q) => q.lang === 'ar').every((q) => /[؀-ۿ]/.test(q.text))).toBe(true);
  });

  it('makes typo queries that differ from the written street by one letter only in long plain names', () => {
    const typos = byCategory(all, 'typo');
    expect(typos.length).toBeGreaterThan(20);
    for (const q of typos) {
      expect(q.expect.streetName).toBeDefined();
      expect(q.text).not.toContain(q.expect.streetName as string);
    }
  });

  it('does not make typo queries from a street named like its own neighbourhood', () => {
    const same = rows(400).map((r) => ({ ...r, street: 'Kuyubaşı', hood: 'Kuyubaşı' }));
    expect(byCategory(buildQueries(same, [], '34', 2026), 'typo')).toEqual([]);
  });

  it('leaves out street names with embedded abbreviations, commas or two street words', () => {
    const noisy = rows(400).map((r, i) => ({ ...r, street: ['Yeni Mah. Gül Sokak', 'Gül Sokak, Çarşı', 'Atatürk Caddesi Gül Sokak', 'Bahariye Caddesi'][i % 4] as string }));
    const made = buildQueries(noisy, [], '34', 2026).filter((q) => q.category === 'full' && !q.conflict);
    const clean = made.filter((q) => q.expect.streetName === 'Bahariye Caddesi');
    expect(clean.length).toBeGreaterThan(0);
    expect(made.filter((q) => q.expect.streetName !== 'Bahariye Caddesi').length).toBe(0);
  });

  it('keeps numbered streets apart and records their number', () => {
    const numbered = byCategory(all, 'numbered');
    expect(numbered.length).toBeGreaterThan(10);
    for (const q of numbered) expect(q.expect.streetNumber).toBeGreaterThanOrEqual(1700);
  });

  it('writes places with their kind and some name variants', () => {
    const places = byCategory(all, 'poi');
    expect(places.length).toBeGreaterThan(20);
    expect(new Set(places.map((q) => q.expect.kind)).size).toBeGreaterThanOrEqual(3);
    expect(places.some((q) => /belediye binasi/i.test(asciiFold(q.text)))).toBe(true);
  });

  it('keeps data conflicts out of the counted queries and marks the few it keeps', () => {
    const conflicted = rows(400).map((r, i) => (i % 40 === 0 ? { ...r, conflict: true } : r));
    const made = buildQueries(conflicted, pois(10), '34', 2026);
    expect(made.filter((q) => q.conflict).length).toBeGreaterThan(0);
    expect(made.filter((q) => q.conflict).every((q) => q.category === 'full')).toBe(true);
    expect(made.filter((q) => !q.conflict && ['full', 'folded', 'typo'].includes(q.category)).every((q) => !conflicted.find((r) => r.osm === q.expect.osm)?.conflict)).toBe(true);
  });

  it('still reaches three hundred when the province has few addresses', () => {
    const small = buildQueries(rows(80), pois(8), '34', 2026);
    expect(small.length).toBeGreaterThanOrEqual(300);
  });

  it('copes with no places and no numbered streets', () => {
    const made = buildQueries(rows(60), [], '34', 2026);
    expect(made.length).toBeGreaterThan(100);
    expect(byCategory(made, 'poi')).toEqual([]);
    expect(byCategory(made, 'numbered')).toEqual([]);
  });
});
