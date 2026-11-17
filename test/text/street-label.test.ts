import fc from 'fast-check';
import { streetKey, streetLabel } from '../../src/core/text/street';
import type { WordKind } from '../../src/core/text/types';

describe('streetLabel', () => {
  it('writes the folded words with capitals and the kind in its usual form', () => {
    expect(streetLabel({ key: 'olmayan', kind: 'sokak' })).toBe('Olmayan Sokak');
    expect(streetLabel({ key: 'gul agaci', kind: 'cadde' })).toBe('Gul Agaci Caddesi');
    expect(streetLabel({ key: 'ataturk', kind: 'bulvar' })).toBe('Ataturk Bulvarı');
    expect(streetLabel({ key: 'sanayi', kind: 'yol' })).toBe('Sanayi Yolu');
    expect(streetLabel({ key: 'kucuk', kind: 'cikmaz' })).toBe('Kucuk Çıkmaz');
    expect(streetLabel({ key: 'cumhuriyet', kind: 'meydan' })).toBe('Cumhuriyet Meydanı');
    expect(streetLabel({ key: '1707', kind: 'sokak' })).toBe('1707 Sokak');
  });

  it('leaves the kind out when there is none or it is not a street kind', () => {
    expect(streetLabel({ key: 'gul agaci', kind: null })).toBe('Gul Agaci');
    expect(streetLabel({ key: 'moda', kind: 'mahalle' })).toBe('Moda');
  });

  it('gives an empty text for an empty key', () => {
    expect(streetLabel({ key: '', kind: 'sokak' })).toBe('');
  });

  it('reads back to the same key and kind', () => {
    const kinds: (WordKind | null)[] = [null, 'sokak', 'cadde', 'bulvar', 'yol', 'cikmaz', 'meydan'];
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{3,9}$/), { minLength: 1, maxLength: 3 }), fc.constantFrom(...kinds), (words, kind) => {
        const key = words.join(' ');
        const original = streetKey(`${key}${kind ? ` ${kind === 'cadde' ? 'caddesi' : kind === 'sokak' ? 'sokagi' : kind}` : ''}`);
        const again = streetKey(streetLabel({ key: original.key, kind: original.kind }));
        expect({ key: again.key, kind: again.kind }).toEqual({ key: original.key, kind: original.kind });
      }),
      { numRuns: 300 },
    );
  });

  it('reads back for names that are numbers', () => {
    for (const name of ['1707. Sokak', '12 Nolu Cadde', '3. Bulvar']) {
      const original = streetKey(name);
      const again = streetKey(streetLabel({ key: original.key, kind: original.kind }));
      expect({ key: again.key, kind: again.kind }).toEqual({ key: original.key, kind: original.kind });
    }
  });
});
