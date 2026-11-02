import fc from 'fast-check';
import { editDistance, kindFactor, nameScore } from '../../src/core/address/names';
import { streetKey } from '../../src/core/text/street';

const score = (query: string, candidate: string): number => nameScore(streetKey(query), streetKey(candidate)).score;

describe('editDistance', () => {
  it.each([
    ['', '', 0], ['a', '', 1], ['', 'abc', 3], ['ataturk', 'ataturk', 0], ['ataturk', 'atatrk', 1], ['ataturk', 'ataturc', 1], ['ataturk', 'atatuurk', 1], ['ataturk', 'tauturk', 2],
    ['abcd', 'abdc', 1], ['kitten', 'sitting', 3],
  ])('%j to %j is %d', (a, b, d) => {
    expect(editDistance(a, b, 5)).toBe(d);
  });

  it('stops counting past the limit', () => {
    expect(editDistance('aaaaaaaa', 'bbbbbbbb', 2)).toBe(3);
    expect(editDistance('abc', 'abcdefgh', 2)).toBe(3);
  });

  it('is symmetric', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), (a, b) => {
        expect(editDistance(a, b, 20)).toBe(editDistance(b, a, 20));
      }),
      { numRuns: 1500, seed: 63 },
    );
  });
});

describe('nameScore', () => {
  it('gives one for the same name however it is written', () => {
    expect(score('Atatürk Caddesi', 'ataturk')).toBe(1);
    expect(score('ataturk cd', 'Atatürk Caddesi')).toBe(1);
    expect(score('Yeni Pınar', 'Yenipınar Sokağı')).toBeGreaterThan(0.95);
    expect(score('улица Ататюрк', 'Atatürk Caddesi')).toBeGreaterThan(0.9);
    expect(score('Παμούκαλε', 'Pamukkale Cd.')).toBeGreaterThan(0.9);
  });

  it('lowers the score by the number of mistakes', () => {
    const one = score('atatrk', 'ataturk');
    const two = score('ataturr', 'atatrk');
    expect(one).toBeGreaterThan(0.8);
    expect(one).toBeLessThan(1);
    expect(two).toBeGreaterThan(0.5);
    expect(two).toBeLessThan(one);
    expect(score('bahariye', 'bahariyc')).toBeGreaterThan(0.8);
  });

  it('does not let a short name drift: a mistake in a short name weighs more', () => {
    expect(score('gul', 'gum')).toBeLessThan(score('gulsen', 'gulsem'));
    expect(score('gul', 'gulsen')).toBeLessThan(0.5);
  });

  it('never matches names whose numbers differ', () => {
    expect(score('1707 Sokak', '1708 Sokak')).toBe(0);
    expect(score('4. Levent', '5. Levent')).toBe(0);
    expect(score('1 Sokak', '11 Sokak')).toBe(0);
    expect(score('30 Ağustos Zafer', 'Zafer')).toBe(0);
  });

  it('matches a numbered street by its number and takes a little off for another street word', () => {
    expect(score('5. Sokak', '5 sk')).toBe(1);
    expect(score('5. Cadde', '5. Sokak')).toBeLessThan(1);
    expect(score('5. Cadde', '5. Sokak')).toBeGreaterThan(0.85);
    expect(score('1707. Sk.', '1707 Sokak')).toBe(1);
  });

  it('returns exact only for equal keys', () => {
    expect(nameScore(streetKey('Atatürk Cd'), streetKey('Atatürk Sk')).exact).toBe(true);
    expect(nameScore(streetKey('Atatürk'), streetKey('Atatrk')).exact).toBe(false);
  });

  it('is zero for names with nothing in common and for an empty name', () => {
    expect(score('Bahariye', 'Zeytinburnu')).toBe(0);
    expect(score('', 'Bahariye')).toBe(0);
    expect(score('Bahariye', '')).toBe(0);
  });

  it('gives a score of one to a name against itself and stays inside 0 to 1', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.string({ maxLength: 30 }), (a, b) => {
        const ka = streetKey(a);
        const kb = streetKey(b);
        if (ka.key !== '') expect(nameScore(ka, ka).score).toBe(1);
        const value = nameScore(ka, kb).score;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }),
      { numRuns: 2000, seed: 64 },
    );
  });

  it('is zero whenever the number sets differ, whatever else is in the names', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 }), fc.constantFrom('', 'Gül', 'Yeni Mahalle'), (a, b, name) => {
        fc.pre(a !== b);
        expect(score(`${name} ${a} Sokak`.trim(), `${name} ${b} Sokak`.trim())).toBe(0);
      }),
      { numRuns: 1500, seed: 65 },
    );
  });
});

describe('kindFactor', () => {
  it('takes a little off when both street words are known and differ, more for numbered streets', () => {
    expect(kindFactor('cadde', 'cadde', false)).toBe(1);
    expect(kindFactor('cadde', null, false)).toBe(1);
    expect(kindFactor(null, 'sokak', false)).toBe(1);
    expect(kindFactor('cadde', 'bulvar', false)).toBe(0.97);
    expect(kindFactor('cadde', 'sokak', true)).toBe(0.9);
  });
});
