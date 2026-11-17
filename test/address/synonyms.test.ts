import fc from 'fast-check';
import { MAX_VARIANTS, SYNONYM_CLASSES, synonymVariants } from '../../src/core/address/synonyms';
import { nameKey } from '../../src/core/text/fold';

describe('synonymVariants', () => {
  it('keeps the original first and adds the words of the same class', () => {
    const out = synonymVariants('kadikoy belediye binasi');
    expect(out[0]).toBe('kadikoy belediye binasi');
    expect(out).toEqual(expect.arrayContaining(['kadikoy belediyesi', 'kadikoy belediye', 'kadikoy municipality', 'kadikoy rathaus', `kadikoy ${nameKey('мэрия')}`]));
  });

  it('reads German, English and Russian words as the Turkish place word', () => {
    expect(synonymVariants('devlet krankenhaus')).toContain('devlet hastanesi');
    expect(synonymVariants('devlet hospital')).toContain('devlet hastane');
    expect(synonymVariants(nameKey('государственная больница'))).toContain('gosudarstvennaya hastanesi');
    expect(synonymVariants('akasya alisveris merkezi')).toContain('akasya avm');
  });

  it('leaves words outside the classes alone', () => {
    expect(synonymVariants('bahariye')).toEqual(['bahariye']);
    expect(synonymVariants('gul sokak')).toEqual(['gul sokak']);
    expect(synonymVariants('')).toEqual(['']);
  });

  it('stops at the variant limit', () => {
    const out = synonymVariants('hastane okul eczane cami belediye avm');
    expect(out.length).toBe(MAX_VARIANTS);
    expect(new Set(out).size).toBe(out.length);
  });

  it('is the same every time', () => {
    expect(synonymVariants('devlet hastane')).toEqual(synonymVariants('devlet hastane'));
  });

  it('keeps every class small and apart from the others', () => {
    const seen = new Map<string, number>();
    SYNONYM_CLASSES.forEach((members, index) => {
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(members.length).toBeLessThanOrEqual(MAX_VARIANTS);
      for (const m of members) {
        expect(seen.has(m)).toBe(false);
        seen.set(m, index);
      }
    });
  });

  it('is symmetric and passes from one member to every other', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SYNONYM_CLASSES.map((_, i) => i)), fc.nat(), fc.nat(), (index, a, b) => {
        const members = SYNONYM_CLASSES[index] as string[];
        const from = members[a % members.length] as string;
        const to = members[b % members.length] as string;
        expect(synonymVariants(from)).toContain(to);
        expect(synonymVariants(to)).toContain(from);
      }),
      { numRuns: 500, seed: 43 },
    );
  });
});
