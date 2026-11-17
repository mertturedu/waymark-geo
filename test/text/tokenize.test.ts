import { tokenize } from '../../src/core/text/tokenize';

const words = (text: string) => tokenize(text).map((token) => token.t);

describe('tokenize', () => {
  it('lowers, drops accents and splits on spaces and punctuation', () => {
    expect(words('Atatürk Cd. No:12, D.4!')).toEqual(['ataturk', 'cd', 'no', '12', 'd', '4']);
  });

  it('starts a new segment at commas, semicolons and line breaks', () => {
    expect(tokenize('Kadıköy, Moda; Bahariye\nCd 14').map((token) => [token.t, token.seg])).toEqual([
      ['kadikoy', 0], ['moda', 1], ['bahariye', 2], ['cd', 3], ['14', 3],
    ]);
  });

  it('does not count empty segments', () => {
    expect(tokenize(',, a ,, b ,,').map((token) => token.seg)).toEqual([0, 1]);
  });

  it('keeps a slash inside a number and splits it between two words', () => {
    expect(words('No 12/3 12/A A/12 3/5')).toEqual(['no', '12/3', '12/a', 'a/12', '3/5']);
    expect(words('Kadıköy/İstanbul')).toEqual(['kadikoy', 'istanbul']);
    expect(words('Kadıköy / İstanbul')).toEqual(['kadikoy', 'istanbul']);
    expect(words('a/b c/')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a hyphen only between digits', () => {
    expect(words('12-14 Marmara-Ereğlisi')).toEqual(['12-14', 'marmara', 'ereglisi']);
    expect(words('12 - 14')).toEqual(['12', '14']);
  });

  it('marks a number that was followed by a dot', () => {
    expect(tokenize('1. Sk. 2 3.').map((token) => [token.t, token.dotted])).toEqual([
      ['1', true], ['sk', false], ['2', false], ['3', true],
    ]);
  });

  it('turns Arabic digits into ASCII and writes Cyrillic in Latin', () => {
    expect(words('شارع ١٢ ул. Ататюрк')).toEqual(['شارع', '12', 'ul', 'ataturk']);
  });

  it('gives nothing for text without letters or digits', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' ,;. !? ')).toEqual([]);
    expect(tokenize('😀')).toEqual([]);
  });

  it('cuts very long input', () => {
    expect(tokenize('a '.repeat(2000)).length).toBeLessThanOrEqual(250);
  });
});
