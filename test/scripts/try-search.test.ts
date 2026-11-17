import type { Search } from '../../src/core/address/search';
import type { Place, ResolveResult } from '../../src/core/address/types';
import { formatPlaces, formatResolve, formatReverse, parseFlags, runSearchCommand } from '../../scripts/try-search';

const place = (extra: Partial<Place> = {}): Place => ({
  id: '34:a:7', label: 'Bahariye Caddesi No:14, Moda Mah., Kadıköy/İstanbul', components: { street: 'Bahariye Caddesi', houseNumber: '14' }, coordinate: [28.6, 40.7], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra,
});

const fake = (overrides: Partial<Search> = {}): Search => ({
  resolve: async () => ({ status: 'resolved', best: place(), candidates: [place()] }),
  lookup: async () => null, admin: async () => null,
  validate: async () => { throw new Error('unused'); },
  autocomplete: async () => [place()],
  reverse: async () => place(),
  nearby: async () => [],
  invalidate: () => undefined,
  hoods: async () => [],
  coverage: async () => null,
  arrival: async (p) => ({ door: p.coordinate }),
  warm: async () => true,
  geometry: async () => null,
  ...overrides,
});

describe('parseFlags', () => {
  it('joins the words and reads the flags', () => {
    expect(parseFlags(['kadikoy', 'moda', '--near', '29.0,41.0', '--city', 'İstanbul', '--district', 'Kadıköy', '--limit', '3', '--lang', 'en', '--json'])).toEqual({
      flags: { text: 'kadikoy moda', near: [29, 41], city: 'İstanbul', district: 'Kadıköy', limit: 3, language: 'en', json: true },
    });
  });

  it('reads a bare text without flags', () => {
    expect(parseFlags(['bahariye', 'cd', '14'])).toEqual({ flags: { text: 'bahariye cd 14', json: false } });
  });

  it('says what is wrong', () => {
    expect(parseFlags(['x', '--foo'])).toEqual({ error: 'bilinmeyen bayrak: --foo' });
    expect(parseFlags(['x', '--near', 'abc'])).toEqual({ error: 'geçersiz --near: abc (boylam,enlem bekleniyor)' });
    expect(parseFlags(['x', '--lang', 'xx'])).toEqual({ error: 'geçersiz --lang: xx (tr, en, de, ar, ru, el)' });
    expect(parseFlags(['x', '--limit', '0'])).toEqual({ error: 'geçersiz --limit: 0' });
    expect(parseFlags(['x', '--city'])).toEqual({ error: '--city bir değer ister' });
    expect(parseFlags([])).toEqual({ error: 'metin gerekli' });
    expect(parseFlags(['  ', '--json'])).toEqual({ error: 'metin gerekli' });
  });
});

describe('formatResolve', () => {
  it('lists the state and the first three candidates with source and precision', () => {
    const result: ResolveResult = { status: 'resolved', best: place(), candidates: [place(), place({ id: '34:a:8' }), place({ id: '34:a:9' }), place({ id: '34:a:10' })] };
    const lines = formatResolve(result);
    expect(lines[0]).toBe('Durum: çözüldü');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('1. Bahariye Caddesi No:14, Moda Mah., Kadıköy/İstanbul  [adres, osm, güven 1.00]  28.600000,40.700000');
  });

  it('says a guess is a guess', () => {
    const guess = place({ precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.82 });
    const lines = formatResolve({ status: 'resolved', best: guess, candidates: [guess] });
    expect(lines[1]).toContain('[tahmini numara, interpolated, güven 0.82]');
    expect(lines).toContain('Not: tahmini nokta, kapı numarası haritada yok.');
  });

  it('tells the other states', () => {
    expect(formatResolve({ status: 'not_found', candidates: [] })).toEqual(['Durum: bulunamadı']);
    expect(formatResolve({ status: 'ambiguous', candidates: [place()] })[0]).toBe('Durum: belirsiz');
    expect(formatResolve({ status: 'region_missing', regions: ['34', '06'] })).toEqual(['Durum: bölge paketi yok: 34, 06']);
    expect(formatResolve({ status: 'resolved', best: place(), candidates: [place()], missing: ['35'] })).toContain('Eksik komşu bölge paketi: 35');
  });
});

describe('formatPlaces and formatReverse', () => {
  it('numbers the suggestions and says when there are none', () => {
    expect(formatPlaces([place(), place({ id: '34:s:1', precision: 'street', approximate: true, source: 'derived' })])).toHaveLength(2);
    expect(formatPlaces([])).toEqual(['Öneri yok']);
  });

  it('shows the answer of a reverse lookup and the empty case', () => {
    expect(formatReverse(place())[0]).toContain('Bahariye Caddesi No:14');
    expect(formatReverse(null)).toEqual(['Sonuç yok: nokta paketlerin dışında ya da ilgili paket yüklü değil']);
  });
});

describe('runSearchCommand', () => {
  it('runs resolve with the options and prints lines or json', async () => {
    let seen: unknown;
    const search = fake({ resolve: async (text, options) => ((seen = { text, options }), { status: 'not_found', candidates: [] }) });
    const out = await runSearchCommand('resolve', ['bahariye', '--near', '29,41', '--city', 'İstanbul', '--district', 'Kadıköy', '--limit', '2'], search);
    expect(out).toEqual({ code: 0, lines: ['Durum: bulunamadı'] });
    expect(seen).toEqual({ text: 'bahariye', options: { near: [29, 41], hints: { city: 'İstanbul', district: 'Kadıköy' }, limit: 2 } });
    const json = await runSearchCommand('resolve', ['x', '--json'], fake());
    expect(JSON.parse(json.lines.join('\n'))).toMatchObject({ status: 'resolved' });
  });

  it('runs search and reverse', async () => {
    expect((await runSearchCommand('search', ['bahar'], fake())).lines).toHaveLength(1);
    let point: unknown;
    const search = fake({ reverse: async (p) => ((point = p), null) });
    expect(await runSearchCommand('reverse', ['28.6,40.7'], search)).toEqual({ code: 0, lines: ['Sonuç yok: nokta paketlerin dışında ya da ilgili paket yüklü değil'] });
    expect(point).toEqual([28.6, 40.7]);
  });

  it('fails with a message and code 2 on bad input', async () => {
    expect(await runSearchCommand('resolve', [], fake())).toEqual({ code: 2, lines: ['metin gerekli'] });
    expect(await runSearchCommand('reverse', ['bahariye'], fake())).toEqual({ code: 2, lines: ['geçersiz nokta: bahariye (boylam,enlem bekleniyor)'] });
    expect(await runSearchCommand('resolve', ['x', '--bogus'], fake())).toEqual({ code: 2, lines: ['bilinmeyen bayrak: --bogus'] });
  });
});
