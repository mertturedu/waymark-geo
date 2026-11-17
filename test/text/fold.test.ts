import fc from 'fast-check';
import { MAX_INPUT, compactKey, foldText, nameKey, truncateInput } from '../../src/core/text/fold';

describe('foldText', () => {
  it.each([
    ['İSTİKLAL Caddesi', 'istiklal caddesi'],
    ['Işık', 'isik'],
    ['IĞDIR', 'igdir'],
    ['ığdır', 'igdir'],
    ['Çamlıca Şehitliği Üsküdar Ömer Ğ', 'camlica sehitligi uskudar omer g'],
    ['Straße', 'strasse'],
    ['STRAẞE', 'strasse'],
    ['Düsseldorf Öl Ärger', 'dusseldorf ol arger'],
    ['Zürich Ångström Œuvre Ærø', 'zurich angstrom oeuvre aero'],
    ['  çok   boşluk\t\n var ', 'cok bosluk var'],
    ['a b c　d', 'a b c d'],
    ['ATATÜRK', 'ataturk'],
  ])('folds %j to %j', (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });

  it('treats decomposed Turkish letters like the precomposed ones', () => {
    expect(foldText('ş')).toBe(foldText('ş'));
    expect(foldText('ğ')).toBe('g');
    expect(foldText('İstanbul')).toBe('istanbul');
    expect(foldText('i̇stanbul')).toBe('istanbul');
    expect(foldText('çay üzeri')).toBe('cay uzeri');
  });

  it('drops zero width and direction marks without touching the letters', () => {
    expect(foldText('‏atat​ürk‎')).toBe('ataturk');
    expect(foldText('‮abc‬')).toBe('abc');
    expect(foldText('﻿kadıköy')).toBe('kadikoy');
    expect(foldText('ata­turk')).toBe('ataturk');
  });

  it('lowers Cyrillic and Greek by table and keeps them as letters', () => {
    expect(foldText('АТАТЮРК')).toBe('ататюрк');
    expect(foldText('ΑΤΑΤΟΎΡΚ')).toBe('ατατουρκ');
    expect(foldText('Ёлка')).toBe('ёлка');
    expect(foldText('Ά Έ Ή Ί Ό Ύ Ώ')).toBe('α ε η ι ο υ ω');
    expect(foldText('Χάταϊ ΪΪ')).toBe('χαταϊ ϊϊ');
    expect(foldText('Χάταΐ')).toBe('χαταϊ');
    expect(foldText('ΣΊΣΥΦΟΣ ς')).toBe('σισυφοσ σ');
  });

  it('normalises Arabic letter variants and drops vowel marks', () => {
    expect(foldText('شَارِعٌ')).toBe('شارع');
    expect(foldText('أحمد إبراهيم آمنة')).toBe('احمد ابراهيم امنة');
    expect(foldText('كـتاب')).toBe('كتاب');
    expect(foldText('کتاب')).toBe('كتاب');
    expect(foldText('علی')).toBe('علي');
    expect(foldText('على')).toBe('علي');
  });

  it('never throws on lone surrogates or private use characters', () => {
    expect(() => foldText('\ud800a\udc00')).not.toThrow();
    expect(foldText('😀 Kadıköy')).toBe('😀 kadikoy');
  });

  it('is idempotent on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => {
        expect(foldText(foldText(text))).toBe(foldText(text));
      }),
      { numRuns: 2000, seed: 11 },
    );
  });
});

describe('nameKey and compactKey', () => {
  it('keeps letters and digits only, one space between words', () => {
    expect(nameKey("Atatürk Cd. No:12/3, D.4!")).toBe('ataturk cd no 12 3 d 4');
    expect(nameKey('  ---  ')).toBe('');
  });

  it('keeps Arabic letters and writes Cyrillic and Greek in Latin', () => {
    expect(nameKey('شارع أتاتورك')).toBe('شارع اتاتورك');
    expect(nameKey('Ататюрк')).toBe('ataturk');
    expect(nameKey('Ατατούρκ')).toBe('ataturk');
  });

  it('compactKey is nameKey without spaces', () => {
    expect(compactKey('Yeni Pınar Sokağı')).toBe('yenipinarsokagi');
    expect(compactKey('')).toBe('');
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => {
        expect(nameKey(nameKey(text))).toBe(nameKey(text));
        expect(compactKey(compactKey(text))).toBe(compactKey(text));
      }),
      { numRuns: 2000, seed: 12 },
    );
  });

  it('gives the same key with and without Turkish diacritics', () => {
    const turkish = fc.stringMatching(/^[a-zçğıöşüİ]{1,12}( [a-zçğıöşüİ]{1,12}){0,3}$/);
    const plain = (w: string) => w.replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/İ/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
    fc.assert(
      fc.property(turkish, (word) => {
        expect(nameKey(word)).toBe(nameKey(plain(word)));
        expect(nameKey(word.toUpperCase())).toBe(nameKey(plain(word)));
      }),
      { numRuns: 2000, seed: 13 },
    );
  });

  it('keeps numbers in street names', () => {
    expect(nameKey('1707. Sokak')).toBe('1707 sokak');
    expect(nameKey('4. Levent 2. Cadde')).toBe('4 levent 2 cadde');
  });
});

describe('truncateInput', () => {
  it('leaves short text alone', () => {
    expect(truncateInput('abc')).toBe('abc');
    expect(truncateInput('')).toBe('');
  });

  it('cuts at 500 UTF-16 units', () => {
    expect(MAX_INPUT).toBe(500);
    expect(truncateInput('a'.repeat(500))).toHaveLength(500);
    expect(truncateInput('a'.repeat(501))).toHaveLength(500);
    expect(truncateInput('a'.repeat(5000))).toHaveLength(500);
  });

  it('never leaves half a surrogate pair at the end', () => {
    const text = 'a'.repeat(499) + '😀';
    const cut = truncateInput(text);
    expect(cut).toBe('a'.repeat(499));
    const last = cut.charCodeAt(cut.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(truncateInput('a'.repeat(498) + '😀')).toHaveLength(500);
  });
});
