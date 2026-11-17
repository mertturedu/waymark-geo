import { compareWeekly, failingIds, failurePatterns, quantile, renderQueue, renderWeekly, summarizeText, WEEKLY_LIMITS, type Outcome, type Weekly } from '../../scripts/weekly-lib';

const outcome = (id: string, errorM: number, extra: Partial<Outcome> = {}): Outcome => ({ id, source: 'osm', ops: [], status: 'resolved', precision: 'address', errorM, streetOk: true, hoodOk: true, districtOk: true, ms: 5, ...extra });

const week = (tag: string, g2: Partial<Weekly['sets']['g2']> = {}, extra: Partial<Weekly> = {}): Weekly => ({
  tag, at: '2026-11-11T00:00:00Z', plates: ['34'],
  sets: { g2: { count: 100, found: 99, notFound: 1, ambiguous: 2, within15: 80, within30: 90, within50: 93, median: 3, p90: 25, streetOk: 95, hoodOk: 90, districtOk: 99, ...g2 } },
  engines: {}, speedMs: { p50: 5, p95: 30 }, patterns: [], failing: [], ...extra,
});

describe('summarizeText', () => {
  it('yüzdeleri, ortancayı ve mahalle oranını yalnız mahallesi olanlarda hesaplar', () => {
    const list = [outcome('a', 5), outcome('b', 40), outcome('c', 120, { streetOk: false, hoodOk: false }), outcome('d', 100_000, { status: 'not_found', hoodOk: null, streetOk: false, districtOk: false })];
    const s = summarizeText(list);
    expect(s).toMatchObject({ count: 4, notFound: 25, within15: 25, within30: 25, within50: 50, streetOk: 50, districtOk: 75 });
    expect(s.hoodOk).toBeCloseTo(66.7, 1);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3);
  });
});

describe('failurePatterns', () => {
  it('başarısızları nedene, işlece ve kaynağa göre gruplar, sık olanı öne alır', () => {
    const list = [
      outcome('1', 200, { ops: ['typo'], streetOk: false }),
      outcome('2', 300, { ops: ['typo'], streetOk: false }),
      outcome('3', 100_000, { status: 'not_found', precision: null, source: 'business' }),
      outcome('4', 4),
    ];
    const patterns = failurePatterns(list);
    expect(patterns[0]).toMatchObject({ key: 'sokak yanlış · typo · OSM kapısı · address', count: 2, share: 66.7 });
    expect(patterns[1]?.key).toBe('bulunamadı · işleçsiz · işletme kapısı · sonuçsuz');
    expect(failingIds(list)).toEqual(['1', '2', '3']);
  });
});

describe('compareWeekly', () => {
  it('sınır içindeki oynamayı geçirir', () => {
    expect(compareWeekly(week('a'), week('b', { within30: 89.5, streetOk: 94.5, notFound: 1.3 }))).toEqual([]);
  });

  it('sınırı aşan her düşüşü ve artışı ayrı gerileme sayar', () => {
    const v = compareWeekly(week('a'), week('b', { within30: 85, streetOk: 92, notFound: 3 }), WEEKLY_LIMITS);
    expect(v.map((x) => x.metric)).toEqual(['G2 ≤30 m', 'G2 sokak doğru', 'G2 bulunamadı']);
  });

  it('süre p95 1,5 katı aşarsa gerileme olur', () => {
    const slow = week('b', {}, { speedMs: { p50: 6, p95: 60 } });
    expect(compareWeekly(week('a'), slow).map((x) => x.metric)).toEqual(['geocode süresi p95 (ms)']);
  });

  it('G7 ve G8 düşüşlerini de denetler', () => {
    const a = week('a', {}, {});
    a.sets.g7 = { count: 10, first: 80, top3: 90 };
    a.sets.g8 = { count: 10, street: 70, exact: 40, near: 60 };
    const b = week('b', {}, {});
    b.sets.g7 = { count: 10, first: 70, top3: 85 };
    b.sets.g8 = { count: 10, street: 66, exact: 40, near: 60 };
    expect(compareWeekly(a, b).map((x) => x.metric)).toEqual(['G7 ilk 3te', 'G8 sokak doğru']);
  });
});

describe('rapor', () => {
  it('önceki yoksa başlangıç noktası der; gerileme varsa KALDI yazar', () => {
    expect(renderWeekly(week('a'), null, [])).toContain('GEÇTİ');
    expect(renderWeekly(week('a'), null, [])).toContain('yok (başlangıç noktası)');
    const bad = compareWeekly(week('a'), week('b', { within30: 80 }));
    expect(renderWeekly(week('b', { within30: 80 }), week('a'), bad)).toContain('KALDI (1 gerileme)');
  });

  it('kuyruk yeni ve düzelen başarısızları sayar', () => {
    const a = week('a', {}, { failing: ['1', '2'] });
    const b = week('b', {}, { failing: ['2', '3'], patterns: [{ key: 'k', count: 2, share: 100, example: 'x | y' }] });
    const text = renderQueue(b, a);
    expect(text).toContain('yeni: 1, düzelen: 1');
    expect(text).toContain('- 3');
    expect(text).toContain('| k | 2 | 100 | x / y |');
  });
});
