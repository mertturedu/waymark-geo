import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { foldText, nameKey } from '../../src/core/text/fold';
import { parseAddress } from '../../src/core/text/parse';
import { streetKey } from '../../src/core/text/street';
import type { GoldenFile } from './helpers/golden';

const golden = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/text-golden.json'), 'utf8')) as GoldenFile;
const turkish = golden.cases.filter((c) => c.lang === 'tr');

const PLAIN: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U', â: 'a', î: 'i', û: 'u' };
const plain = (text: string): string => Array.from(text).map((ch) => PLAIN[ch] ?? ch).join('');

const summary = (text: string) => {
  const p = parseAddress(text);
  return [p.province?.id, p.district?.id, p.neighbourhood, p.street?.key, p.street?.kind, p.houseNumber, p.door, p.floor, p.block, p.building, p.postcode, p.leftover.join(' ')].join('|');
};

describe('K1.2: normalising twice changes nothing', () => {
  it('holds for foldText, nameKey and the street key on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (text) => {
        expect(foldText(foldText(text))).toBe(foldText(text));
        expect(nameKey(nameKey(text))).toBe(nameKey(text));
        const key = streetKey(text).key;
        expect(streetKey(key).key).toBe(key);
      }),
      { numRuns: 3000, seed: 31 },
    );
  });
});

describe('K1.2: Turkish spelling with and without special letters gives the same key', () => {
  it('gives the same parse for every Turkish golden sentence written without special letters', () => {
    const different = turkish.filter((c) => summary(c.text) !== summary(plain(c.text)));
    expect(different.map((c) => c.text)).toEqual([]);
  });

  it('gives the same parse in upper and lower case', () => {
    const upper = (text: string) => Array.from(text).map((ch) => (ch === 'i' ? 'İ' : ch === 'ı' ? 'I' : ch.toUpperCase())).join('');
    const different = turkish.slice(0, 600).filter((c) => !/[a-zçğıöşü][A-ZÇĞİÖŞÜ]/.test(c.text) && summary(c.text) !== summary(upper(c.text)));
    expect(different.map((c) => c.text)).toEqual([]);
  });
});

describe('K1.2: a number in a street name stays', () => {
  it('keeps the number in the key and never confuses two numbers', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 99999 }), fc.constantFrom('Sokak', 'Sk.', 'Caddesi', 'Cd.', ''), fc.constantFrom('', 'Yeni', 'Gül Çiçek'), (a, b, kind, name) => {
        const first = streetKey(`${name} ${a} ${kind}`.trim());
        expect(first.numbers).toContain(String(a));
        expect(first.key).toContain(String(a));
        if (a !== b) expect(first.numbers).not.toEqual(streetKey(`${name} ${b} ${kind}`.trim()).numbers);
      }),
      { numRuns: 2000, seed: 32 },
    );
  });

  it('reads a numbered street from a sentence with the same number', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 99999 }), fc.integer({ min: 1, max: 300 }), (street, house) => {
        const parsed = parseAddress(`Moda Mah. ${street}. Sokak No: ${house}`);
        expect(parsed.street?.key).toBe(String(street));
        expect(parsed.street?.number).toBe(street);
        expect(parsed.houseNumber).toBe(String(house));
      }),
      { numRuns: 1500, seed: 33 },
    );
  });
});
