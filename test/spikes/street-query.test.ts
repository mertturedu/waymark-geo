import { DatabaseSync } from 'node:sqlite';
import fc from 'fast-check';
import { buildStreetDb } from '../../scripts/spikes/build-street-db';
import { fold, searchStreets, trigrams, type Driver } from '../../scripts/spikes/street-query';

const STREETS = [
  { name: 'Atatürk Caddesi', lon: 29.01, lat: 41.01 },
  { name: 'Atatürk Bulvarı', lon: 29.02, lat: 41.02 },
  { name: '1707. Sokak', lon: 29.03, lat: 41.03 },
  { name: '1708. Sokak', lon: 29.04, lat: 41.04 },
  { name: 'İstiklal Caddesi', lon: 29.05, lat: 41.05 },
  { name: 'Gazi Mustafa Kemal Paşa Bulvarı', lon: 29.06, lat: 41.06 },
  { name: 'Çiçek Sokağı', lon: 29.07, lat: 41.07 },
];

const makeDriver = (): Driver => {
  const db = new DatabaseSync(':memory:');
  buildStreetDb(db, STREETS);
  return { all: async (sql, params) => db.prepare(sql).all(...params) as Record<string, string | number | null>[] };
};

describe('fold', () => {
  it('folds Turkish letters, case and punctuation', () => {
    expect(fold('İSTİKLAL ÇİÇEK Ğ')).toBe('istiklal cicek g');
    expect(fold('Atatürk  Cad.')).toBe('ataturk cad');
    expect(fold('ISPARTA ıspanak')).toBe('isparta ispanak');
    expect(fold('âîû')).toBe('aiu');
  });

  it('keeps digits and trims', () => {
    expect(fold('  1707. Sokak  ')).toBe('1707 sokak');
    expect(fold('')).toBe('');
    expect(fold('...')).toBe('');
  });
});

describe('trigrams', () => {
  it('pads the text with spaces and lists unique three letter windows', () => {
    expect(trigrams('abc')).toEqual([' ab', 'abc', 'bc ']);
    expect(trigrams('aaaa')).toEqual([' aa', 'aaa', 'aa ']);
  });

  it('is empty for empty text', () => {
    expect(trigrams('')).toEqual([]);
  });
});

describe('searchStreets', () => {
  const driver = makeDriver();

  it('finds a street from an abbreviation without accents', async () => {
    const hits = await searchStreets(driver, 'ataturk cad');
    expect(hits[0]?.name).toBe('Atatürk Caddesi');
  });

  it('survives a missing letter', async () => {
    const hits = await searchStreets(driver, 'ataturk cdadesi', 3);
    expect(hits.map((h) => h.name)).toContain('Atatürk Caddesi');
  });

  it('folds uppercase dotless I', async () => {
    expect((await searchStreets(driver, 'ISTIKLAL'))[0]?.name).toBe('İstiklal Caddesi');
  });

  it('never returns another number for a numbered street', async () => {
    const hits = await searchStreets(driver, '1707 sokak');
    expect(hits[0]?.name).toBe('1707. Sokak');
    expect(hits.map((h) => h.name)).not.toContain('1708. Sokak');
    expect(await searchStreets(driver, '1709 sokak')).toEqual([]);
  });

  it('returns coordinates and a score between 0 and 1', async () => {
    const [hit] = await searchStreets(driver, 'çiçek sokağı');
    expect(hit).toMatchObject({ name: 'Çiçek Sokağı', lon: 29.07, lat: 41.07 });
    expect(hit?.score).toBeGreaterThan(0.9);
    expect(hit?.score).toBeLessThanOrEqual(1);
  });

  it('respects the limit and orders by score', async () => {
    const hits = await searchStreets(driver, 'ataturk', 1);
    expect(hits).toHaveLength(1);
    const more = await searchStreets(driver, 'ataturk', 5);
    for (let i = 1; i < more.length; i++) expect(more[i - 1]!.score).toBeGreaterThanOrEqual(more[i]!.score);
  });

  it('returns nothing for empty or unmatched input', async () => {
    expect(await searchStreets(driver, '')).toEqual([]);
    expect(await searchStreets(driver, '   ')).toEqual([]);
    expect(await searchStreets(driver, 'zzzzqqqq')).toEqual([]);
  });

  it('handles very short queries', async () => {
    await expect(searchStreets(driver, 'a')).resolves.toBeDefined();
    await expect(searchStreets(driver, 'at')).resolves.toBeDefined();
  });

  it('never throws on arbitrary text', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary', maxLength: 80 }), async (text) => {
        await expect(searchStreets(driver, text)).resolves.toBeDefined();
      }),
      { numRuns: 300 },
    );
  });
});
