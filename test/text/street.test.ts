import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressRecord } from '../../scripts/build-address-records';
import { sameStreet, streetKey } from '../../src/core/text/street';

const { records } = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/address-records.json'), 'utf8')) as { records: AddressRecord[] };

describe('streetKey', () => {
  it('drops the street word and keeps the name', () => {
    expect(streetKey('Atatürk Caddesi')).toMatchObject({ key: 'ataturk', kind: 'cadde', numberOnly: false });
    expect(streetKey('Gül Sk.')).toMatchObject({ key: 'gul', kind: 'sokak' });
    expect(streetKey('Bağdat Cd')).toMatchObject({ key: 'bagdat', kind: 'cadde' });
    expect(streetKey('Atatürk Bulvarı')).toMatchObject({ key: 'ataturk', kind: 'bulvar' });
  });

  it('drops a leading street word of the prefix languages', () => {
    expect(streetKey('улица Ататюрк')).toMatchObject({ key: 'ataturk', kind: 'sokak' });
    expect(streetKey('Οδός Ατατούρκ')).toMatchObject({ key: 'ataturk', kind: 'sokak' });
    expect(streetKey('شارع أتاتورك').kind).toBe('sokak');
    expect(streetKey('Atatürk Street')).toMatchObject({ key: 'ataturk', kind: 'sokak' });
    expect(streetKey('Atatürk Straße')).toMatchObject({ key: 'ataturk', kind: 'sokak' });
  });

  it('keeps a lone street word as the name', () => {
    expect(streetKey('Sokak')).toMatchObject({ key: 'sokak', kind: null });
    expect(streetKey('Yol')).toMatchObject({ key: 'yol', kind: null });
  });

  it('recognises numbered streets', () => {
    expect(streetKey('1707. Sk.')).toMatchObject({ key: '1707', number: 1707, numberOnly: true, kind: 'sokak' });
    expect(streetKey('1. Sokak')).toMatchObject({ key: '1', number: 1, numberOnly: true });
    expect(streetKey('1707 Sokak')).toMatchObject({ number: 1707, numberOnly: true });
    expect(streetKey('1 nolu sokak')).toMatchObject({ key: '1', number: 1, numberOnly: true });
    expect(streetKey('١٧٠٧ شارع')).toMatchObject({ key: '1707', number: 1707 });
    expect(streetKey('01707 Sokak').numbers).toEqual(['1707']);
  });

  it('keeps numbers that are part of a longer name', () => {
    expect(streetKey('4. Levent Caddesi')).toMatchObject({ key: '4 levent', numberOnly: false, numbers: ['4'], number: null });
    expect(streetKey('30 Ağustos Zafer Sokağı')).toMatchObject({ key: '30 agustos zafer', numbers: ['30'] });
  });

  it('builds the compact form without spaces and without honorific prefixes', () => {
    expect(streetKey('Yeni Pınar Sokağı').compact).toBe('yenipinar');
    expect(streetKey('Şehit Mehmet Sokağı')).toMatchObject({ key: 'sehit mehmet', compact: 'mehmet' });
    expect(streetKey('Mehmet Sokağı').compact).toBe('mehmet');
    expect(streetKey('Şehit Dr. Ali Gazi').compact).toBe('aligazi');
    expect(streetKey('Şehit').compact).toBe('sehit');
  });

  it('collapses doubled letters in the loose form', () => {
    expect(streetKey('Pamukkale Cd.').loose).toBe('pamukale');
    expect(streetKey('Παμούκαλε').loose).toBe('pamukale');
  });

  it('treats y and i alike and drops doubled letters in the loose form', () => {
    expect(streetKey('Karatay Cd.').loose).toBe(streetKey('Καρατάϊ').loose);
    expect(streetKey('Hatay').loose).toBe('hatai');
  });

  it('survives empty and odd input', () => {
    expect(streetKey('')).toMatchObject({ key: '', compact: '', kind: null, number: null, numberOnly: false, numbers: [] });
    expect(streetKey('   ---   ').key).toBe('');
    expect(streetKey('😀').key).toBe('');
  });

  it('peels every outer street word into the bare form and keeps the inner one in the key', () => {
    expect(streetKey('İzmir Yolu Caddesi')).toMatchObject({ key: 'izmir yolu', bare: { key: 'izmir', compact: 'izmir', loose: 'izmir' } });
    expect(streetKey('Espiri Çıkmazı Sokağı').bare.key).toBe('espiri');
    expect(streetKey('Atatürk Caddesi').bare).toEqual({ key: 'ataturk', compact: 'ataturk', loose: 'ataturk' });
    expect(streetKey('Sokak Caddesi').bare.key).toBe('sokak');
    expect(streetKey('Cadde Sokak Gül Yolu').bare.key).toBe('gul');
    expect(streetKey('').bare).toEqual({ key: '', compact: '', loose: '' });
  });

  it('gives the same bare form when a key is fed back in', () => {
    for (const { street } of records) {
      const once = streetKey(street);
      expect(streetKey(once.key).bare).toEqual(once.bare);
    }
  });

  it('keeps the numbers of any name', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), fc.constantFrom('Sokak', 'Cd.', 'Caddesi', 'Bulvarı', ''), fc.constantFrom('', 'Gül', 'Yeni Mahalle'), (n, kind, name) => {
        const key = streetKey(`${name} ${n} ${kind}`.trim());
        expect(key.numbers).toContain(String(n));
        expect(key.key).toContain(String(n));
      }),
      { numRuns: 1500, seed: 21 },
    );
  });
});

describe('sameStreet', () => {
  it.each([
    ['Atatürk Cd.', 'ataturk caddesi'],
    ['Yeni pınar', 'Yenipınar'],
    ['Yeni Pınar Sokağı', 'YENİPINAR SK'],
    ['Ататюрк улица', 'Atatürk Caddesi'],
    ['Ατατούρκ', 'Atatürk Sokağı'],
    ['Marmara-Ereğlisi', 'Marmara Ereğlisi'],
    ['Pamukkale', 'Παμούκαλε'],
    ['1707 Sokak', '1707. Sk.'],
    ['1707 Sokak', '01707 sk'],
    ['١٧٠٧', '1707 sk'],
    ['İzmir Yolu Caddesi', 'İzmir Yolu'],
    ['İzmir Yolu Caddesi', 'izmir'],
    ['Espiri Çıkmazı Sokağı', 'Espiri Çıkmazı'],
  ])('%s equals %s', (a, b) => {
    expect(sameStreet(a, b)).toBe(true);
    expect(sameStreet(b, a)).toBe(true);
  });

  it.each([
    ['1707 Sokak', '1708 Sokak'],
    ['1707 Sokak', '707 Sokak'],
    ['1 Sokak', '11 Sokak'],
    ['4. Levent', '5. Levent'],
    ['Atatürk Cd.', 'Atatürk Akaretler'],
    ['Şehit Mehmet', 'Mehmet'],
    ['Gül', 'Gülşen'],
    ['', ''],
    ['Sokak', ''],
    ['5. Cadde', '5. Sokak'],
    ['1707 Cd.', '1707 Sk.'],
    ['5. Bulvar', '5. Sokak'],
  ])('%s differs from %s', (a, b) => {
    expect(sameStreet(a, b)).toBe(false);
    expect(sameStreet(b, a)).toBe(false);
  });

  it('is true for every fixture street against the key built from it', () => {
    for (const { street } of records) expect(sameStreet(street, streetKey(street).key)).toBe(true);
  });

  it('lets a numbered street match across scripts and kinds the other languages cannot tell apart', () => {
    expect(sameStreet('5. Cadde', '5 улица')).toBe(true);
    expect(sameStreet('5. Sokak', '5. Sk.')).toBe(true);
    expect(sameStreet('5. Sokak', '5')).toBe(true);
  });

  it('is reflexive for every name with a key', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        expect(sameStreet(text, text)).toBe(streetKey(text).key !== '');
      }),
      { numRuns: 2000, seed: 22 },
    );
  });

  it('never matches two different numbers whatever else is in the name', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 99999 }), fc.constantFrom('Sokak', 'Cd.', ''), (a, b, kind) => {
        fc.pre(a !== b);
        expect(sameStreet(`${a} ${kind}`, `${b} ${kind}`)).toBe(false);
      }),
      { numRuns: 1500, seed: 23 },
    );
  });
});
