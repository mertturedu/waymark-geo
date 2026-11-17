import fc from 'fast-check';
import { base64Decode, utf8Bytes } from '../../src/core/packs/base64';

describe('base64Decode', () => {
  it('matches Buffer for random bytes, with and without padding and line breaks', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 120 }), (bytes) => {
        const text = Buffer.from(bytes).toString('base64');
        expect(Array.from(base64Decode(text) ?? [])).toEqual(Array.from(bytes));
        expect(Array.from(base64Decode(`${text.replace(/=+$/, '')}\n`) ?? [])).toEqual(Array.from(bytes));
      }),
    );
  });

  it('refuses characters outside the alphabet and impossible lengths', () => {
    expect(base64Decode('ab$d')).toBeNull();
    expect(base64Decode('abcde')).toBeNull();
    expect(base64Decode('ab=c')).toBeNull();
    expect(Array.from(base64Decode('YW Jj\nZA==') ?? [])).toEqual(Array.from(Buffer.from('abcd')));
    expect(Array.from(base64Decode('') ?? [1])).toEqual([]);
  });
});

describe('utf8Bytes', () => {
  it('matches TextEncoder for any text, including emoji and Arabic', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (text) => expect(Array.from(utf8Bytes(text))).toEqual(Array.from(new TextEncoder().encode(text)))));
    for (const text of ['İstanbul', 'إسطنبول', 'Αθήνα', '😀 ok', '\ud800', 'a\udc00b', '\ud800\udc00', '\udbff\udfff', 'a\ud800', '\ud800a', '\ud800\ue000', '\udbff\udbff\udc00']) expect(Array.from(utf8Bytes(text))).toEqual(Array.from(new TextEncoder().encode(text)));
  });
});
