import { nameKey } from '../../src/core/text/fold';
import { LANGS, POI_ROOTS, isPoiWord, lookupWord, lookupWords, wordsOf } from '../../src/core/text/lexicon';
import type { WordKind } from '../../src/core/text/types';

const KINDS: WordKind[] = ['sokak', 'cadde', 'bulvar', 'yol', 'cikmaz', 'meydan', 'mahalle', 'numara', 'daire', 'kat', 'blok', 'site', 'bina'];

describe('lexicon tables', () => {
  it('knows the six languages in a fixed order', () => {
    expect(LANGS).toEqual(['tr', 'en', 'de', 'ru', 'el', 'ar']);
  });

  it.each(LANGS.flatMap((lang) => KINDS.map((kind) => [lang, kind] as const)))('has words for %s / %s', (lang, kind) => {
    expect(wordsOf(lang, kind).length).toBeGreaterThan(0);
  });

  it('stores every word in its stable key form, one token each', () => {
    for (const lang of LANGS)
      for (const kind of KINDS)
        for (const word of wordsOf(lang, kind)) {
          expect(nameKey(word)).toBe(word);
          expect(word).not.toContain(' ');
          expect(word).not.toBe('');
        }
  });

  it('never sends one key to two kinds inside the same language', () => {
    for (const lang of LANGS) {
      const seen = new Map<string, WordKind>();
      for (const kind of KINDS)
        for (const word of wordsOf(lang, kind)) {
          expect([lang, word, seen.get(word) ?? kind]).toEqual([lang, word, kind]);
          seen.set(word, kind);
        }
    }
  });

  it('keeps a word list free of duplicates', () => {
    for (const lang of LANGS) for (const kind of KINDS) expect(new Set(wordsOf(lang, kind)).size).toBe(wordsOf(lang, kind).length);
  });
});

describe('lookupWord', () => {
  it.each([
    ['sk', 'sokak', ['tr']],
    ['sokagi', 'sokak', ['tr']],
    ['caddesi', 'cadde', ['tr']],
    ['mah', 'mahalle', ['tr', 'en']],
    ['no', 'numara', ['tr', 'en']],
    ['street', 'sokak', ['en']],
    ['strasse', 'sokak', ['de']],
    ['avenue', 'cadde', ['en']],
    ['wohnung', 'daire', ['de']],
    ['شارع', 'sokak', ['ar']],
    ['حي', 'mahalle', ['ar']],
  ])('%s is %s in %j', (word, kind, langs) => {
    const hit = lookupWord(nameKey(word));
    expect(hit?.kind).toBe(kind);
    expect(hit?.langs).toEqual(expect.arrayContaining(langs as string[]));
  });

  it('returns null for words it does not know', () => {
    expect(lookupWord('ataturk')).toBeNull();
    expect(lookupWord('')).toBeNull();
    expect(lookupWords('zzzz')).toEqual([]);
  });

  it('lets the caller prefer a language when a short word means different things', () => {
    expect(lookupWord('d')?.kind).toBe('daire');
    const russian = lookupWord(nameKey('д'), ['ru']);
    const turkishFirst = lookupWords(nameKey('д'));
    expect(turkishFirst.length).toBeGreaterThan(0);
    expect(russian?.langs).toEqual(['ru']);
  });

  it('lists every reading of an ambiguous short word', () => {
    const readings = lookupWords('apt');
    expect(readings).toEqual(expect.arrayContaining([{ kind: 'bina', lang: 'tr' }, { kind: 'daire', lang: 'en' }]));
  });

  it('is case and accent insensitive through the key', () => {
    expect(lookupWord(nameKey('SOKAĞI'))?.kind).toBe('sokak');
    expect(lookupWord(nameKey('Straße'))?.kind).toBe('sokak');
  });
});

describe('POI words', () => {
  it.each(['hastane', 'hastanesi', 'belediye', 'belediyesi', 'universite', 'hospital', 'krankenhaus', 'больница', 'νοσοκομείο', 'مستشفى', 'ptt', 'avm'])('%s is a place word', (word) => {
    expect(isPoiWord(nameKey(word))).toBe(true);
  });

  it.each(['ataturk', 'sokak', 'merkez', 'park', '12', ''])('%s is not', (word) => {
    expect(isPoiWord(nameKey(word))).toBe(false);
  });

  it('exposes the roots as a set of stable keys', () => {
    expect(POI_ROOTS.has('hastane')).toBe(true);
    for (const root of POI_ROOTS) expect(nameKey(root)).toBe(root);
  });
});
