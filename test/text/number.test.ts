import fc from 'fast-check';
import { houseNumberKey, splitNumbers } from '../../src/core/text/number';

describe('splitNumbers', () => {
  it('splits a list on semicolons and drops blanks', () => {
    expect(splitNumbers('12;14')).toEqual(['12', '14']);
    expect(splitNumbers(' 12; 14;')).toEqual(['12', '14']);
    expect(splitNumbers('5-7')).toEqual(['5-7']);
    expect(splitNumbers('40, 38')).toEqual(['40', '38']);
    expect(splitNumbers('31,33')).toEqual(['31', '33']);
    expect(splitNumbers('10,10A')).toEqual(['10', '10A']);
    expect(splitNumbers('1/1,1/2')).toEqual(['1/1', '1/2']);
    expect(splitNumbers('')).toEqual([]);
    expect(splitNumbers(' ; ')).toEqual([]);
  });
});

describe('houseNumberKey', () => {
  it.each([
    ['14', '14', 14, '', 'even'],
    ['351/32A', '351/32a', 351, '/32a', 'odd'],
    ['12 A', '12a', 12, 'a', 'even'],
    ['12 / 3', '12/3', 12, '/3', 'even'],
    ['12/A', '12/a', 12, '/a', 'even'],
    ['5-7', '5-7', 5, '-7', 'odd'],
    ['٣٤', '34', 34, '', 'even'],
    ['۱۲', '12', 12, '', 'even'],
    ['12А', '12a', 12, 'a', 'even'],
    ['No: 7', 'no7', 7, '', 'odd'],
    ['012', '12', 12, '', 'even'],
    ['351/032A', '351/32a', 351, '/32a', 'odd'],
    ['0', '0', 0, '', 'even'],
    ['12.', '12', 12, '', 'even'],
  ])('reads %j as %j', (raw, key, int, suffix, parity) => {
    expect(houseNumberKey(raw)).toEqual({ raw, key, int, suffix, parity });
  });

  it.each(['-', 'yok', '?', '', '   ', 'A', '1'.repeat(101)])('has no key for %j', (raw) => {
    expect(houseNumberKey(raw)).toBeNull();
  });

  it('keeps a number with no sensible integer part without a parity', () => {
    expect(houseNumberKey('1234567890123')).toMatchObject({ key: '1234567890123', int: null, parity: null });
    expect(houseNumberKey('A12')).toMatchObject({ key: 'a12', int: 12, suffix: '', parity: 'even' });
  });

  it('gives the same key when a key is fed back in', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (text) => {
        const first = houseNumberKey(text);
        if (first) expect(houseNumberKey(first.key)).toMatchObject({ key: first.key, int: first.int, suffix: first.suffix, parity: first.parity });
      }),
      { numRuns: 5000, seed: 31 },
    );
  });

  it('never throws on any text and never returns an empty key', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary', maxLength: 300 }), fc.string({ maxLength: 120 })), (text) => {
        const result = houseNumberKey(text);
        if (result) expect(result.key.length).toBeGreaterThan(0);
      }),
      { numRuns: 5000, seed: 32 },
    );
  });

  it('treats the same number written with Turkish, Arabic and Cyrillic lookalikes alike', () => {
    expect(houseNumberKey('٢٣ ب')?.key).toBe(houseNumberKey('23 ب')?.key);
    expect(houseNumberKey('7К')?.key).toBe(houseNumberKey('7k')?.key);
  });
});

describe('houseNumberKey characters and lengths', () => {
  it.each([
    ['1a', '1a'], ['1z', '1z'], ['1{', '1'], ['1`', '1'], ['1/', '1/'], ['1.', '1'], ['1-', '1-'], ['1:', '1'], ['10', '10'], ['1 9', '1/9'], ['12.1', '12/1'], ['2 205', '2/205'], ['12. 3', '12/3'], ['12 - 14', '12-14'], ['12 A', '12a'],
    ['1\u0621', '1\u0621'], ['1\u064a', '1\u064a'], ['1\u0620', '1'], ['1\u064b', '1'], ['1\u0651', '1'],
  ])('keeps %j as %j', (raw, key) => {
    expect(houseNumberKey(raw)?.key).toBe(key);
  });

  it('accepts one hundred characters and refuses one hundred and one', () => {
    expect(houseNumberKey('a'.repeat(99) + '1')).not.toBeNull();
    expect(houseNumberKey('a'.repeat(100) + '1')).toBeNull();
  });

  it('keeps an integer part up to six digits and drops it from seven', () => {
    expect(houseNumberKey('123456')).toMatchObject({ int: 123456, parity: 'even' });
    expect(houseNumberKey('1234567')).toMatchObject({ int: null, parity: null, key: '1234567' });
  });

  it.each([['00', '0'], ['0', '0'], ['0012', '12'], ['a00', 'a0'], ['1/007', '1/7'], ['x009y', 'x9y'], ['10', '10'], ['100', '100'], ['5-05', '5-5'], ['0/0', '0/0']])('trims leading zeros of %j to %j', (raw, key) => {
    expect(houseNumberKey(raw)?.key).toBe(key);
  });

  it('reads the first run of digits and leaves everything after it as the suffix', () => {
    expect(houseNumberKey('a12b34')).toMatchObject({ int: 12, suffix: 'b34', key: 'a12b34' });
    expect(houseNumberKey('12')).toMatchObject({ int: 12, suffix: '' });
    expect(houseNumberKey('--7')).toMatchObject({ int: 7, suffix: '', key: '--7' });
  });
});
