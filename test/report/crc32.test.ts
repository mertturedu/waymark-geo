import { crc32 as nodeCrc32 } from 'node:zlib';
import fc from 'fast-check';
import { crc32 } from '../../src/core/report/crc32';

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
  });

  it('is zero for the empty string', () => {
    expect(crc32('')).toBe(0);
  });

  it('hashes UTF-8 bytes, not UTF-16 code units', () => {
    expect(crc32('İ')).toBe(nodeCrc32(Buffer.from('İ', 'utf8')));
    expect(crc32('😀')).toBe(nodeCrc32(Buffer.from('😀', 'utf8')));
  });

  it('agrees with node for arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        expect(crc32(text)).toBe(nodeCrc32(Buffer.from(text, 'utf8')));
      }),
      { numRuns: 500 },
    );
  });
});
