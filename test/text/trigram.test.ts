import fc from 'fast-check';
import { decodePostings, encodePostings, trigramCodes } from '../../src/core/text/trigram';

const code = (text: string): number => ((text.charCodeAt(0) * 1792 + text.charCodeAt(1)) * 1792 + text.charCodeAt(2));

describe('trigramCodes', () => {
  it('pads the key and lists each three letter piece once, sorted', () => {
    const expected = ['  a', ' at', 'ata', 'tat', 'atu', 'tur', 'urk', 'rk '].map(code).sort((a, b) => a - b);
    expect(trigramCodes('ataturk')).toEqual(expected);
  });

  it('gives two pieces for a one letter key and none for an empty key', () => {
    expect(trigramCodes('a')).toEqual(['  a', ' a '].map(code).sort((a, b) => a - b));
    expect(trigramCodes('')).toEqual([]);
  });

  it('drops repeats', () => {
    expect(trigramCodes('aaaaa')).toEqual(['  a', ' aa', 'aaa', 'aa '].map(code).sort((a, b) => a - b));
  });

  it('shares pieces between a name and a misspelling of it', () => {
    const typed = new Set(trigramCodes('atatrk'));
    const shared = trigramCodes('ataturk').filter((c) => typed.has(c));
    expect(shared.length).toBeGreaterThanOrEqual(4);
  });

  it('reads Arabic letters and skips letters outside the table', () => {
    expect(trigramCodes('حي').length).toBe(3);
    expect(trigramCodes('a☃b')).toEqual([code('  a')]);
  });

  it('keeps every piece below the range of a safe integer', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (text) => {
        for (const c of trigramCodes(text)) {
          expect(Number.isSafeInteger(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 1000, seed: 41 },
    );
  });
});

describe('postings', () => {
  it('round-trips sorted ids with big gaps', () => {
    const ids = [1, 2, 3, 500, 100_000, 2_000_000_000];
    expect(decodePostings(encodePostings(ids))).toEqual(ids);
  });

  it('sorts and drops repeats on the way in', () => {
    expect(decodePostings(encodePostings([9, 3, 3, 7, 1]))).toEqual([1, 3, 7, 9]);
    expect(decodePostings(encodePostings([]))).toEqual([]);
  });

  it('is small for close ids', () => {
    expect(encodePostings(Array.from({ length: 1000 }, (_, i) => i * 3)).length).toBeLessThan(1010);
  });

  it('round-trips random id lists', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 4_000_000_000 }), { maxLength: 200 }), (ids) => {
        expect(decodePostings(encodePostings(ids))).toEqual([...new Set(ids)].sort((a, b) => a - b));
      }),
      { numRuns: 1500, seed: 42 },
    );
  });

  it('refuses bytes that end in the middle of a number', () => {
    expect(() => decodePostings(new Uint8Array([0x80]))).toThrow();
  });
});

describe('trigramCodes at the edge of the table', () => {
  it('keeps the last letter of the table and drops the first letter past it, at every position of a piece', () => {
    expect(trigramCodes('\u06ff')).toHaveLength(2);
    expect(trigramCodes('\u0700')).toEqual([]);
    expect(trigramCodes('\u0700ab')).toEqual([code('ab ')]);
    expect(trigramCodes('a\u0700b')).toEqual([code('  a')]);
    expect(trigramCodes('ab\u0700')).toEqual([code('  a'), code(' ab')].sort((x, y) => x - y));
  });

  it('says what is wrong with postings that stop in the middle', () => {
    expect(() => decodePostings(new Uint8Array([0x80]))).toThrow(/^postings end in the middle of a number$/);
    expect(() => decodePostings(new Uint8Array([5, 0xff]))).toThrow(/middle of a number/);
  });

  it('writes a gap of 127 in one byte and of 128 in two', () => {
    expect(Array.from(encodePostings([127]))).toEqual([127]);
    expect(Array.from(encodePostings([128]))).toEqual([128, 1]);
    expect(decodePostings(Uint8Array.from([128, 1]))).toEqual([128]);
  });
});
