import { commands, runTry } from '../../scripts/try';
import { formatParsed } from '../../scripts/try-parse';
import { parseAddress } from '../../src/core/text/parse';

describe('formatParsed', () => {
  it('writes one line per part that was found', () => {
    const lines = formatParsed(parseAddress('balikesir karesi pasaalani mah 1. sk no 12 d 3'));
    expect(lines).toEqual([
      'Giriş:   balikesir karesi pasaalani mah 1. sk no 12 d 3',
      'Dil:     tr',
      'İl:      Balıkesir (10)',
      'İlçe:    Karesi',
      'Mahalle: pasaalani',
      'Sokak:   1 (sokak)',
      'Numara:  12',
      'Daire:   3',
    ]);
  });

  it('marks an open district', () => {
    expect(formatParsed(parseAddress('Merkez'))).toContain('İlçe:    Merkez (birden çok ilde var)');
  });

  it('lists leftover words', () => {
    expect(formatParsed(parseAddress('zzzz qqqq'))).toContain('Kalan:   zzzz qqqq');
  });

  it('says so when nothing was found', () => {
    expect(formatParsed(parseAddress(''))).toEqual(['Giriş:   ', 'Hiçbir parça bulunamadı.']);
  });
});

describe('try parse', () => {
  it('is registered and prints the lines', async () => {
    expect(Object.keys(commands)).toContain('parse');
    const printed: string[] = [];
    const original = console.log;
    console.log = (line: string) => void printed.push(line);
    try {
      const result = await runTry(['parse', 'Kadıköy, Moda Mah., Bahariye Cd. 14'], commands);
      expect(result.code).toBe(0);
    } finally {
      console.log = original;
    }
    expect(printed.join('\n')).toContain('Mahalle: moda');
    expect(printed.join('\n')).toContain('Numara:  14');
  });

  it('prints raw JSON with --json', async () => {
    const printed: string[] = [];
    const original = console.log;
    console.log = (line: string) => void printed.push(line);
    try {
      await runTry(['parse', '--json', 'Bahariye Cd. 14'], commands);
    } finally {
      console.log = original;
    }
    expect(JSON.parse(printed.join('\n'))).toMatchObject({ houseNumber: '14', street: { key: 'bahariye' } });
  });

  it('joins several words into one sentence', async () => {
    const printed: string[] = [];
    const original = console.log;
    console.log = (line: string) => void printed.push(line);
    try {
      await runTry(['parse', 'Bahariye', 'Cd.', '14'], commands);
    } finally {
      console.log = original;
    }
    expect(printed.join('\n')).toContain('Giriş:   Bahariye Cd. 14');
  });
});
