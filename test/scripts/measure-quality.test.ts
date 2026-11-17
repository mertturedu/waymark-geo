import type { Place } from '../../src/core/address/types';
import { rngOf } from '../../scripts/build-address-golden';
import { classifyOracle, regionsAllVerdict, labelProblem, mutate, oddText, percentile, predictVerdict, topStreet } from '../../scripts/measure-quality';

const place = (extra: Partial<Place> = {}): Place => ({
  id: '34:a:7', label: 'x', components: { street: 'Bahariye Caddesi', houseNumber: '14' }, coordinate: [28.6, 40.7], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra,
});

describe('percentile', () => {
  it('reads the value at the share asked for and copes with short lists', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBe(0);
  });
});

describe('predictVerdict', () => {
  const row = (plate: string, mine: [number, number], base: [number, number]) => ({ plate, mine: { count: 10, median: mine[0], p90: mine[1] }, base: { count: 10, median: base[0], p90: base[1] } });

  it('passes when no province is worse than the baseline and the pooled median is at most twenty metres', () => {
    expect(predictVerdict([row('34', [5, 50], [20, 700]), row('06', [4, 40], [4, 40])], 20)).toEqual({ pass: true, worse: [] });
  });

  it('names a province that is worse in the median or in the ninetieth percentile', () => {
    expect(predictVerdict([row('34', [21, 50], [20, 700])], 10).worse).toEqual(['34']);
    expect(predictVerdict([row('34', [5, 701], [20, 700])], 10)).toEqual({ pass: false, worse: ['34'] });
  });

  it('fails above twenty metres pooled and passes at exactly twenty', () => {
    expect(predictVerdict([row('34', [5, 50], [20, 700])], 20.01).pass).toBe(false);
    expect(predictVerdict([row('34', [5, 50], [20, 700])], 20).pass).toBe(true);
  });

  it('never passes with nothing measured', () => {
    expect(predictVerdict([], 0).pass).toBe(false);
  });
});

describe('labelProblem', () => {
  const row = { number: '14', lng: 28.6, lat: 40.7 };

  it('accepts a door that is a row of the pack with its number and point', () => {
    expect(labelProblem(place(), row)).toBeNull();
  });

  it('refuses a door that has no row, another number or another point', () => {
    expect(labelProblem(place(), null)).toMatch(/satırı yok/);
    expect(labelProblem(place(), { ...row, number: '16' })).toMatch(/numara/);
    expect(labelProblem(place(), { ...row, lng: 28.7 })).toMatch(/nokta/);
  });

  it('refuses a door that is flagged approximate or comes from a guess', () => {
    expect(labelProblem(place({ approximate: true }), row)).toMatch(/approximate/);
    expect(labelProblem(place({ source: 'interpolated' }), row)).toMatch(/kaynak/);
  });

  it('refuses a guess or an area that is not flagged approximate and accepts one that is', () => {
    for (const precision of ['interpolated', 'street', 'neighbourhood', 'district', 'province'] as const) {
      expect(labelProblem(place({ precision, approximate: false, source: 'derived' }), null)).toMatch(/approximate/);
      expect(labelProblem(place({ precision, approximate: true, source: 'derived' }), null)).toBeNull();
    }
  });

  it('wants a named place to be a real place', () => {
    expect(labelProblem(place({ precision: 'poi', approximate: false }), null)).toBeNull();
    expect(labelProblem(place({ precision: 'poi', approximate: true }), null)).toMatch(/approximate/);
  });
});

describe('mutate and oddText', () => {
  it('make the same thing for the same seed and something else for another', () => {
    const a = Array.from({ length: 30 }, (_, i) => mutate('Moda Mah. Bahariye Caddesi No: 14', rngOf(i)));
    const b = Array.from({ length: 30 }, (_, i) => mutate('Moda Mah. Bahariye Caddesi No: 14', rngOf(i)));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(15);
    expect(a.some((x) => x !== 'Moda Mah. Bahariye Caddesi No: 14')).toBe(true);
  });

  it('draws odd text in many shapes and the same each time', () => {
    const next = rngOf(9);
    const first = Array.from({ length: 300 }, () => oddText(next));
    const again = rngOf(9);
    expect(Array.from({ length: 300 }, () => oddText(again))).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(200);
    expect(first.some((x) => x.length > 1000)).toBe(true);
    expect(first.some((x) => /\p{Extended_Pictographic}/u.test(x))).toBe(true);
    expect(first.some((x) => x === '')).toBe(true);
  });
});

describe('topStreet', () => {
  it('takes the highest score and the smaller id on a tie', () => {
    expect(topStreet(new Map([[5, 0.9], [3, 0.95], [2, 0.95]]))).toBe(2);
    expect(topStreet(new Map())).toBeNull();
  });
});

describe('classifyOracle', () => {
  const scores = (entries: [number, number][]) => new Map(entries);

  it('calls two equal tops the same, also when the scores tie on another id', () => {
    expect(classifyOracle(scores([[1, 0.9], [2, 0.8]]), scores([[1, 0.9], [2, 0.8], [3, 0.7]]))).toBe('same');
    expect(classifyOracle(scores([[4, 0.9]]), scores([[3, 0.9], [4, 0.9]]))).toBe('same');
  });

  it('does not count a difference the search would never show', () => {
    expect(classifyOracle(scores([[1, 0]]), scores([[2, 0.5]]))).toBe('below');
    expect(classifyOracle(new Map(), scores([[2, 0.549]]))).toBe('below');
    expect(classifyOracle(new Map(), new Map())).toBe('same');
  });

  it('tells a missed candidate from a different score', () => {
    expect(classifyOracle(scores([[1, 0.6]]), scores([[1, 0.6], [2, 0.95]]))).toBe('limit');
    expect(classifyOracle(new Map(), scores([[2, 0.55]]))).toBe('limit');
    expect(classifyOracle(scores([[1, 0.7], [2, 0.6]]), scores([[1, 0.6], [2, 0.8]]))).toBe('score');
  });
});

describe('regionsAllVerdict', () => {
  const row = (plate: string, asked: number, right: number, extra: Partial<{ opened: boolean; thrown: number }> = {}) => ({ plate, opened: true, asked, right, thrown: 0, ...extra });

  it('passes when every pack opens, the big ones answer at least 95 percent right and nothing throws', () => {
    expect(regionsAllVerdict([row('34', 20, 19), row('06', 20, 20), row('69', 0, 0)])).toEqual({ pass: true, bad: [] });
  });

  it('names a pack that fails to open, answers under 95 percent or throws', () => {
    expect(regionsAllVerdict([row('34', 20, 18)]).bad).toEqual(['34']);
    expect(regionsAllVerdict([row('01', 0, 0, { opened: false })]).bad).toEqual(['01']);
    expect(regionsAllVerdict([row('02', 20, 20, { thrown: 1 })]).bad).toEqual(['02']);
  });

  it('never passes with nothing measured', () => {
    expect(regionsAllVerdict([]).pass).toBe(false);
  });
});
